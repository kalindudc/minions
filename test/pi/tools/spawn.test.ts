import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createAgentSession, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Value } from "@sinclair/typebox/value";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubsessionManager } from "../../../extensions/pi/subsessions/manager.js";
import {
  type SpawnToolDetails,
  SpawnToolParams,
  spawn,
} from "../../../extensions/pi/tools/spawn.js";
import { AgentTree } from "../../../extensions/pi/tree.js";
import { createMockSession } from "../helpers/mock-session.js";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    createAgentSession: vi.fn(),
    DefaultResourceLoader: class {
      async reload() {}
    },
  };
});

type SessionResult = Awaited<ReturnType<typeof createAgentSession>>;

const baseConfig = {
  minionNames: ["kevin", "stuart", "bob"],
  allowEphemeral: true,
  display: {
    outputPreviewLines: 20,
    observabilityLines: 6,
    showStatusHints: true,
    spinnerFrames: ["-"],
  },
  toolSync: {
    enabled: false,
    maxWait: 5,
  },
};

describe("spawn input contract", () => {
  it("exposes tasks as the only top-level parameter and requires it", () => {
    expect(Object.keys(SpawnToolParams.properties)).toEqual(["tasks"]);
    expect(SpawnToolParams.required).toEqual(["tasks"]);
  });

  it.each([
    { tasks: [{ task: "summarize" }] },
    { tasks: [{ task: "find auth", agent: "scout", model: "haiku" }] },
    { tasks: [{ task: "one" }, { task: "two", agent: "scout" }] },
  ])("accepts task descriptors with per-item options: %j", (params) => {
    expect(Value.Check(SpawnToolParams, params)).toBe(true);
  });

  it.each([
    {},
    { task: "legacy" },
    { tasks: [] },
    { tasks: "not an array" },
    { tasks: [{}] },
    { tasks: ["not a descriptor"] },
    { tasks: [{ task: 123 }] },
    { tasks: [{ task: "work", agent: 123 }] },
    { tasks: [{ task: "work", model: 123 }] },
    { task: "legacy", tasks: [{ task: "work" }] },
    { agent: "scout", tasks: [{ task: "work" }] },
    { model: "haiku", tasks: [{ task: "work" }] },
  ])("rejects inputs outside the tasks-only contract: %j", (params) => {
    expect(Value.Check(SpawnToolParams, params)).toBe(false);
  });
});

describe("foreground delegation", () => {
  let cwd: string;

  function createDeps() {
    const tree = new AgentTree();
    const pi = {
      getAllTools: () => [
        { name: "read", description: "Read files" },
        { name: "bash", description: "Run bash" },
        { name: "spawn", description: "Spawn minions" },
      ],
    } as unknown as ExtensionAPI;
    const parentSessionPath = join(cwd, "parent.jsonl");
    const ctx = {
      cwd,
      modelRegistry: {
        getAll: () => [
          { provider: "test", id: "scout-default" },
          { provider: "test", id: "haiku" },
        ],
        hasConfiguredAuth: () => true,
      },
      sessionManager: { getSessionFile: () => parentSessionPath },
    } as unknown as ExtensionContext;
    const subsessionManager = new SubsessionManager(cwd, parentSessionPath);
    return { tree, pi, ctx, subsessionManager };
  }

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "pi-minions-spawn-tool-"));
    vi.stubEnv("HOME", cwd);
    vi.stubEnv("PI_CODING_AGENT_DIR", join(cwd, "global"));
    vi.stubEnv("PI_MINIONS_TIMEOUT", "");
    expect(getAgentDir()).toBe(join(cwd, "global"));
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ "pi-minions": baseConfig }));
    writeFileSync(
      join(cwd, ".pi", "agents", "scout.md"),
      "---\nname: scout\ndescription: Fast recon\nmodel: scout-default\n---\nYou are a scout.\n",
    );
    vi.mocked(createAgentSession).mockImplementation(
      async () =>
        ({
          session: createMockSession({ totalTurns: 1, turnDelayMs: 0, finalMessage: "done" })
            .session,
        }) as unknown as SessionResult,
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    rmSync(cwd, { recursive: true, force: true });
  });

  describe("one-item tasks arrays", () => {
    it("runs a named minion to completion and updates tree state", async () => {
      const { tree, pi, ctx, subsessionManager } = createDeps();

      const result = await spawn(tree, pi, subsessionManager)(
        "tc",
        { tasks: [{ agent: "scout", task: "find auth" }] },
        undefined,
        undefined,
        ctx,
      );

      expect(tree.getRoots()).toHaveLength(1);
      const node = tree.getRoots()[0];
      expect(node).toMatchObject({ status: "completed", task: "find auth", agentName: "scout" });
      expect(result.details).toMatchObject({
        id: node.id,
        name: node.name,
        agentName: "scout",
        task: "find auth",
        status: "completed",
        model: "scout-default",
        isBatch: false,
        finalOutput: "done",
      });
      expect(result.content).toEqual([
        { type: "text", text: `Minion ${node.name} (${node.id}) completed.\n\ndone` },
      ]);
    });

    it("streams and returns a single ephemeral minion without batch wrapping", async () => {
      const { tree, pi, ctx, subsessionManager } = createDeps();
      const updates: SpawnToolDetails[] = [];

      const result = await spawn(tree, pi, subsessionManager)(
        "tc",
        { tasks: [{ task: "summarize" }] },
        undefined,
        (update) => updates.push(structuredClone(update.details)),
        ctx,
      );

      expect(tree.getRoots()).toHaveLength(1);
      const node = tree.getRoots()[0];
      expect(baseConfig.minionNames).toContain(node.name);
      expect(node.agentName).toBe("ephemeral");
      expect(result.details.isBatch).toBe(false);
      expect(result.details.minions).toHaveLength(1);
      expect(result.details.finalOutput).toBe("done");
      expect(updates.length).toBeGreaterThan(0);
      for (const update of updates) {
        expect(update).toMatchObject({ id: node.id, name: node.name, isBatch: false });
        expect(update.minions).toHaveLength(1);
      }
      expect(updates.some((update) => update.status === "running")).toBe(true);
      expect(updates.some((update) => update.minions?.[0]?.activity === "done")).toBe(true);
      expect(updates.at(-1)).toMatchObject({ status: "completed", finalOutput: "done" });
    });

    it.each([
      undefined,
      "scout",
    ])("reports per-item model overrides for agent %s", async (agent) => {
      const { tree, pi, ctx, subsessionManager } = createDeps();

      const result = await spawn(tree, pi, subsessionManager)(
        "tc",
        { tasks: [{ task: "summarize", agent, model: "haiku" }] },
        undefined,
        undefined,
        ctx,
      );

      expect(result.details.model).toBe("haiku");
      expect(result.details.minions?.[0]?.model).toBe("haiku");
      expect(tree.getRoots()[0]?.model).toBe("haiku");
      expect(createAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({ model: expect.objectContaining({ id: "haiku" }) }),
      );
    });

    it("reports available agents without starting a minion when the named agent is unknown", async () => {
      const { tree, pi, ctx, subsessionManager } = createDeps();

      await expect(
        spawn(tree, pi, subsessionManager)(
          "tc",
          { tasks: [{ agent: "missing", task: "work" }] },
          undefined,
          undefined,
          ctx,
        ),
      ).rejects.toThrow('Agent "missing" not found. Available: scout');
      expect(tree.getRoots()).toHaveLength(0);
      expect(createAgentSession).not.toHaveBeenCalled();
    });

    it("fails a spawn that names a persona whose file was skipped, citing the file and reason", async () => {
      writeFileSync(
        join(cwd, ".pi", "agents", "broken.md"),
        "---\ndescription: Broken\nreasoning: extreme\n---\nBroken.\n",
      );
      const { tree, pi, ctx, subsessionManager } = createDeps();

      await expect(
        spawn(tree, pi, subsessionManager)(
          "tc",
          { tasks: [{ agent: "broken", task: "work" }] },
          undefined,
          undefined,
          ctx,
        ),
      ).rejects.toThrow(/Agent "broken" was skipped: .*broken\.md: invalid reasoning "extreme"/);
      expect(tree.getRoots()).toHaveLength(0);
      expect(createAgentSession).not.toHaveBeenCalled();
    });

    it("still spawns a valid named persona when another persona file is broken", async () => {
      writeFileSync(
        join(cwd, ".pi", "agents", "broken.md"),
        "---\ndescription: [unclosed\n---\nBroken.\n",
      );
      const { tree, pi, ctx, subsessionManager } = createDeps();

      const result = await spawn(tree, pi, subsessionManager)(
        "tc",
        { tasks: [{ agent: "scout", task: "find auth" }] },
        undefined,
        undefined,
        ctx,
      );

      expect(result.details).toMatchObject({ agentName: "scout", status: "completed" });
    });

    it("rejects ephemeral minions when config disables them", async () => {
      writeFileSync(
        join(cwd, ".pi", "settings.json"),
        JSON.stringify({ "pi-minions": { ...baseConfig, allowEphemeral: false } }),
      );
      const { tree, pi, ctx, subsessionManager } = createDeps();

      await expect(
        spawn(tree, pi, subsessionManager)(
          "tc",
          { tasks: [{ task: "work" }] },
          undefined,
          undefined,
          ctx,
        ),
      ).rejects.toThrow("Ephemeral minions are disabled");
      expect(tree.getRoots()).toHaveLength(0);
      expect(createAgentSession).not.toHaveBeenCalled();
    });

    it("reports a single-minion error rather than a batch error when the session fails", async () => {
      vi.mocked(createAgentSession).mockRejectedValueOnce(new Error("boom"));
      const { tree, pi, ctx, subsessionManager } = createDeps();

      await expect(
        spawn(tree, pi, subsessionManager)(
          "tc",
          { tasks: [{ task: "work" }] },
          undefined,
          undefined,
          ctx,
        ),
      ).rejects.toThrow(/^Minion .+ failed:/);
      expect(tree.getRoots()[0]).toMatchObject({ status: "failed", error: "boom" });
    });
  });

  describe("multiple task entries", () => {
    it("aggregates minion output and streams batch details", async () => {
      const { tree, pi, ctx, subsessionManager } = createDeps();
      const updates: SpawnToolDetails[] = [];

      const result = await spawn(tree, pi, subsessionManager)(
        "tc",
        {
          tasks: [
            { task: "one", model: "haiku" },
            { task: "two", agent: "scout" },
          ],
        },
        undefined,
        (update) => updates.push(structuredClone(update.details)),
        ctx,
      );

      expect(tree.getRoots()).toHaveLength(2);
      expect(tree.getRoots().every((node) => node.status === "completed")).toBe(true);
      expect(result.details).toMatchObject({
        isBatch: true,
        agentName: "batch",
        status: "completed",
      });
      expect(result.details.minions).toMatchObject([
        { task: "one", agentName: "ephemeral", model: "haiku" },
        { task: "two", agentName: "scout", model: "scout-default" },
      ]);
      expect(result.details.usage.turns).toBe(2);
      const text = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      expect(text).toContain("Batch complete: 2 completed");
      for (const minion of result.details.minions ?? []) {
        expect(text).toContain(`=== ${minion.name} ===\ndone`);
      }
      expect(updates.length).toBeGreaterThan(0);
      expect(updates.every((update) => update.isBatch && update.minions?.length === 2)).toBe(true);
    });

    it("fails the batch with inline error text if any minion fails", async () => {
      vi.mocked(createAgentSession).mockRejectedValueOnce(new Error("bad"));
      const { tree, pi, ctx, subsessionManager } = createDeps();

      await expect(
        spawn(tree, pi, subsessionManager)(
          "tc",
          { tasks: [{ task: "one" }, { task: "two" }] },
          undefined,
          undefined,
          ctx,
        ),
      ).rejects.toThrow(/Batch spawn failed \(1\/2 failed\).*bad/);
      expect(tree.getRoots().map((node) => node.status)).toEqual(["failed", "completed"]);
    });
  });

  describe("missing or empty tasks", () => {
    it.each([
      {},
      { task: "legacy" },
      { tasks: [] },
      { tasks: null },
      { tasks: "work" },
    ])("rejects %j before starting any minions", async (params) => {
      const { tree, pi, ctx, subsessionManager } = createDeps();

      await expect(
        spawn(tree, pi, subsessionManager)(
          "tc",
          params as unknown as SpawnToolParams,
          undefined,
          undefined,
          ctx,
        ),
      ).rejects.toThrow("Must specify a non-empty 'tasks' array.");
      expect(tree.getRoots()).toHaveLength(0);
      expect(createAgentSession).not.toHaveBeenCalled();
    });
  });
});
