import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { matchModel, spawnBatch } from "../../extensions/bb/spawn.js";
import {
  addMinion,
  addThread,
  createBbHost,
  makeWorld,
  PARENT_ID,
  spawnCalls,
  type World,
} from "./helpers/bb-world.js";

let home: string;
let project: string;
let world: World;

function writePersona(dir: string, name: string, frontmatter: string, body = `You are ${name}.`) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.md`),
    `---\ndescription: ${name} persona\n${frontmatter}---\n${body}\n`,
  );
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pm-bb-home-"));
  project = join(home, "project");
  mkdirSync(join(project, ".git"), { recursive: true });
  vi.stubEnv("HOME", home);
  vi.stubEnv("PI_CODING_AGENT_DIR", join(home, "pi-agent"));
  const personas = join(home, ".agents", "agents");
  writePersona(
    personas,
    "researcher",
    "displayName: Rex\nprovider: codex\nmodel: gpt-5.2\nreasoning: high\n",
  );
  writePersona(personas, "thinker", "thinking: minimal\n");
  writePersona(personas, "coder", "provider: codex\n");
  writePersona(personas, "deep", "reasoning: max\n");
  writePersona(personas, "locked", "permission: full\n");
  writePersona(personas, "planner", "delegate: true\n");
  writePersona(personas, "verbose", "", "V".repeat(5000));
  writePersona(join(project, ".pi", "agents"), "scout", "model: claude-x\n");
  world = makeWorld(project);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe("spawning minions as bb child threads", () => {
  it("spawns a named persona as a nested child with the persona's provider, model and reasoning", async () => {
    const { bb, harness } = createBbHost(world);

    const outcomes = await spawnBatch(bb, PARENT_ID, [
      { task: "Find the auth bug", agent: "researcher" },
    ]);

    expect(outcomes).toEqual([
      {
        ok: true,
        id: "th_child_1",
        persona: "researcher",
        model: "gpt-5.2",
        environment: "shared",
      },
    ]);
    const [call] = spawnCalls(harness);
    expect(call).toMatchObject({
      projectId: "project-1",
      parentThreadId: PARENT_ID,
      lifecycleOwnerThreadId: PARENT_ID,
      providerId: "codex",
      model: "gpt-5.2",
      reasoningLevel: "high",
      environment: { type: "reuse", environmentId: "env_1" },
      title: "Rex · Find the auth bug",
      pluginMetadata: {
        persona: "researcher",
        personaPath: join(home, ".agents", "agents", "researcher.md"),
        depth: 1,
        delegate: false,
        providerId: "codex",
        model: "gpt-5.2",
        task: "Find the auth bug",
        environment: "shared",
      },
    });
    expect(call.prompt).toContain("Find the auth bug");
    expect(call.prompt).toMatch(/complete final answer/);
    expect(call.prompt).not.toContain("You are researcher.");
    expect(call).not.toHaveProperty("permissionMode");
  });

  it("runs a task without a persona on the caller's provider, model and reasoning", async () => {
    const { bb, harness } = createBbHost(world);

    const outcomes = await spawnBatch(bb, PARENT_ID, [{ task: "Summarize\nthe   changelog" }]);

    expect(outcomes).toEqual([
      {
        ok: true,
        id: "th_child_1",
        persona: "minion",
        model: "openai/gpt-6-luna",
        environment: "shared",
      },
    ]);
    expect(spawnCalls(harness)[0]).toMatchObject({
      providerId: "pi",
      model: "openai/gpt-6-luna",
      reasoningLevel: "medium",
      title: "minion · Summarize the changelog",
      pluginMetadata: { persona: "minion", personaPath: null, delegate: false },
    });
  });

  it("discovers project personas from the caller's checkout", async () => {
    const { bb, harness } = createBbHost(world);

    await spawnBatch(bb, PARENT_ID, [{ task: "Scout", agent: "scout" }]);

    expect(spawnCalls(harness)[0]).toMatchObject({ providerId: "pi", model: "anthropic/claude-x" });
  });

  it("fails a task that names a persona whose file was skipped, and logs that file once", async () => {
    writePersona(join(home, ".agents", "agents"), "broken", "reasoning: extreme\n");
    const { bb, harness } = createBbHost(world);

    const first = await spawnBatch(bb, PARENT_ID, [
      { task: "Broken", agent: "broken" },
      { task: "Research", agent: "researcher" },
    ]);
    await spawnBatch(bb, PARENT_ID, [{ task: "Broken again", agent: "broken" }]);

    expect(first).toMatchObject([
      {
        ok: false,
        task: "Broken",
        error: expect.stringMatching(
          /Persona "broken" was skipped: .*broken\.md: invalid reasoning "extreme"/,
        ),
      },
      { ok: true, persona: "researcher" },
    ]);
    expect(harness.inspection.logEntries.filter((entry) => entry.level === "warn")).toEqual([
      { level: "warn", message: expect.stringMatching(/broken\.md: invalid reasoning "extreme"/) },
    ]);
  });

  it("offers only user personas when the caller's checkout is not readable from the server", async () => {
    world.environment = { ...world.environment!, path: join(home, "remote", "checkout") };
    const { bb } = createBbHost(world);

    const outcomes = await spawnBatch(bb, PARENT_ID, [
      { task: "Scout", agent: "scout" },
      { task: "Research", agent: "researcher" },
    ]);

    expect(outcomes).toMatchObject([
      { ok: false, error: expect.stringContaining('Unknown persona "scout"') },
      { ok: true, persona: "researcher" },
    ]);
  });

  it("lets a task model override the persona model by a unique suffix after the provider", async () => {
    const { bb, harness } = createBbHost(world);

    const outcomes = await spawnBatch(bb, PARENT_ID, [
      { task: "Scout", agent: "scout", model: "gpt-6-luna" },
    ]);

    expect(outcomes[0]).toMatchObject({ ok: true, model: "openai/gpt-6-luna" });
    expect(spawnCalls(harness)[0]).toMatchObject({ providerId: "pi", model: "openai/gpt-6-luna" });
  });

  it("uses the persona provider's default model and that model's default reasoning when neither the task nor the persona names them", async () => {
    const { bb, harness } = createBbHost(world);

    const outcomes = await spawnBatch(bb, PARENT_ID, [{ task: "Code", agent: "coder" }]);

    expect(outcomes[0]).toMatchObject({ ok: true, model: "gpt-5.2" });
    expect(spawnCalls(harness)[0]).toMatchObject({
      providerId: "codex",
      model: "gpt-5.2",
      reasoningLevel: "high",
    });
  });

  it("maps a persona's pi thinking level to bb reasoning when it sets no reasoning", async () => {
    const { bb, harness } = createBbHost(world);

    await spawnBatch(bb, PARENT_ID, [{ task: "Think", agent: "thinker" }]);

    expect(spawnCalls(harness)[0]).toMatchObject({ reasoningLevel: "low" });
  });

  it("uses the model's default reasoning when the caller's level is not one the model supports", async () => {
    world.defaults = { ...world.defaults!, reasoningLevel: "xhigh" };
    const { bb, harness } = createBbHost(world);

    await spawnBatch(bb, PARENT_ID, [{ task: "Summarize" }]);

    expect(spawnCalls(harness)[0]).toMatchObject({ reasoningLevel: "low" });
  });

  it("uses the model's default reasoning when the caller's defaults cannot be read", async () => {
    world.defaults = null;
    const { bb, harness } = createBbHost(world);

    await spawnBatch(bb, PARENT_ID, [{ task: "Scout", agent: "scout" }]);

    expect(spawnCalls(harness)[0]).toMatchObject({
      model: "anthropic/claude-x",
      reasoningLevel: "high",
    });
  });

  it("fails only the task whose persona, model or reasoning is invalid, listing the choices", async () => {
    world.catalogs.pi!.models.push({ id: "other/gpt-6-luna" });
    const { bb, harness } = createBbHost(world);

    const outcomes = await spawnBatch(bb, PARENT_ID, [
      { task: "Ghost", agent: "ghost" },
      { task: "Ambiguous", model: "gpt-6-luna" },
      { task: "Missing", model: "nope" },
      { task: "Deep", agent: "deep", model: "openai/gpt-6-luna" },
      { task: "Fine" },
    ]);

    expect(outcomes).toMatchObject([
      { ok: false, task: "Ghost", error: expect.stringMatching(/ghost.*researcher/s) },
      {
        ok: false,
        task: "Ambiguous",
        error: expect.stringMatching(/ambiguous.*other\/gpt-6-luna/s),
      },
      { ok: false, task: "Missing", error: expect.stringMatching(/nope.*anthropic\/claude-x/s) },
      { ok: false, task: "Deep", error: expect.stringMatching(/max.*low, medium, high/s) },
      { ok: true, persona: "minion" },
    ]);
    expect(spawnCalls(harness)).toHaveLength(1);
  });

  it("reports a per-task failure when the persona's provider catalog cannot load", async () => {
    world.catalogs.codex = {
      models: [],
      modelLoadError: { code: "auth_required", detail: "Sign in to Codex", providerId: "codex" },
    };
    const { bb } = createBbHost(world);

    const outcomes = await spawnBatch(bb, PARENT_ID, [
      { task: "Research", agent: "researcher" },
      { task: "Fine" },
    ]);

    expect(outcomes).toMatchObject([
      { ok: false, error: expect.stringContaining("Sign in to Codex") },
      { ok: true },
    ]);
  });

  it("reports a per-task failure when the caller's default model is unavailable", async () => {
    world.defaults = null;
    const { bb } = createBbHost(world);

    const outcomes = await spawnBatch(bb, PARENT_ID, [{ task: "Summarize" }]);

    expect(outcomes).toMatchObject([
      { ok: false, error: expect.stringContaining("default model") },
    ]);
  });

  it("leaves permission to bb unless the persona sets one, and never above the host ceiling", async () => {
    const { bb, harness } = createBbHost(world);

    await spawnBatch(bb, PARENT_ID, [{ task: "Locked", agent: "locked" }]);
    world.catalogs.pi!.permissionCeiling = "auto";
    const capped = await spawnBatch(bb, PARENT_ID, [{ task: "Locked", agent: "locked" }]);

    expect(spawnCalls(harness)[0]).toMatchObject({ permissionMode: "full" });
    expect(capped).toMatchObject([{ ok: false, error: expect.stringContaining("ceiling") }]);
    expect(spawnCalls(harness)).toHaveLength(1);
  });

  it("creates a managed worktree from the caller's branch on the caller's host", async () => {
    const { bb, harness } = createBbHost(world);

    const outcomes = await spawnBatch(bb, PARENT_ID, [{ task: "Edit", environment: "worktree" }]);
    world.environment = { ...world.environment!, branchName: null };
    await spawnBatch(bb, PARENT_ID, [{ task: "Edit", environment: "worktree" }]);

    expect(outcomes[0]).toMatchObject({ ok: true, environment: "worktree" });
    expect(spawnCalls(harness).map((call) => call.environment)).toEqual([
      {
        type: "host",
        hostId: "host_1",
        workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "main" } },
      },
      {
        type: "host",
        hostId: "host_1",
        workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
      },
    ]);
  });

  it("puts a project persona's body in a worktree minion's prompt, since its worktree cannot vouch for the caller's checkout", async () => {
    const { bb, harness } = createBbHost(world);

    await spawnBatch(bb, PARENT_ID, [
      { task: "Scout it", agent: "scout", environment: "worktree" },
    ]);

    const [call] = spawnCalls(harness);
    expect(call.prompt.startsWith("You are scout.")).toBe(true);
    expect(call.prompt).toContain("Scout it");
    expect(call.pluginMetadata).toMatchObject({ persona: "scout", personaPath: null });
  });

  it("keeps a user persona's body in a worktree minion's instructions", async () => {
    const { bb, harness } = createBbHost(world);

    await spawnBatch(bb, PARENT_ID, [
      { task: "Research", agent: "researcher", environment: "worktree" },
    ]);

    const [call] = spawnCalls(harness);
    expect(call.prompt).not.toContain("You are researcher.");
    expect(call.pluginMetadata).toMatchObject({
      personaPath: join(home, ".agents", "agents", "researcher.md"),
    });
  });

  it("refuses a worktree outside a Git project", async () => {
    world.environment = { ...world.environment!, isGitRepo: false };
    const { bb } = createBbHost(world);

    const outcomes = await spawnBatch(bb, PARENT_ID, [{ task: "Edit", environment: "worktree" }]);

    expect(outcomes).toMatchObject([{ ok: false, error: expect.stringContaining("Git") }]);
  });

  it("puts a persona body that would overflow the instruction limit at the start of the prompt", async () => {
    const { bb, harness } = createBbHost(world);

    await spawnBatch(bb, PARENT_ID, [{ task: "Be verbose", agent: "verbose" }]);

    const prompt: string = spawnCalls(harness)[0].prompt;
    expect(prompt.startsWith("V".repeat(5000))).toBe(true);
    expect(prompt).toContain("Be verbose");
  });

  it("keeps spawning later tasks after one spawn call fails, without retrying it", async () => {
    world.failSpawnsFor.add("first task");
    const { bb, harness } = createBbHost(world);

    const outcomes = await spawnBatch(bb, PARENT_ID, [
      { task: "first task" },
      { task: "second task" },
    ]);

    expect(outcomes).toMatchObject([
      { ok: false, task: "first task", error: "spawn exploded" },
      { ok: true, id: "th_child_1" },
    ]);
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(2);
  });

  it.each([0, 9])("refuses a batch of %i tasks", async (count) => {
    const { bb, harness } = createBbHost(world);
    const tasks = Array.from({ length: count }, (_, index) => ({ task: `task ${index}` }));

    await expect(spawnBatch(bb, PARENT_ID, tasks)).rejects.toThrow(/one to eight/);
    expect(spawnCalls(harness)).toHaveLength(0);
  });
});

describe("delegation limits", () => {
  it("refuses to spawn from a minion whose persona does not delegate", async () => {
    addMinion(world, "th_minion", {
      metadata: { delegate: false, depth: 1 },
      thread: { environmentId: "env_1" },
    });
    const { bb, harness } = createBbHost(world);

    await expect(spawnBatch(bb, "th_minion", [{ task: "Recurse" }])).rejects.toThrow(
      /may not spawn minions: its persona does not set delegate: true/,
    );
    expect(spawnCalls(harness)).toHaveLength(0);
  });

  it("refuses to spawn from a minion whose parent is also a minion, whatever its metadata claims", async () => {
    addMinion(world, "th_first", { metadata: { delegate: true, depth: 1 } });
    addMinion(world, "th_second", {
      parent: "th_first",
      metadata: { delegate: true, depth: 1 },
      thread: { environmentId: "env_1" },
    });
    const { bb, harness } = createBbHost(world);

    await expect(spawnBatch(bb, "th_second", [{ task: "Recurse" }])).rejects.toThrow(
      /two levels deep/,
    );
    expect(spawnCalls(harness)).toHaveLength(0);
  });

  it.each([
    ["removed", {}],
    ["malformed", { persona: 42 }],
  ])("refuses to spawn from a minion whose metadata was %s", async (_label, metadata) => {
    addMinion(world, "th_minion", { thread: { environmentId: "env_1" } });
    world.metadata.set("th_minion", metadata);
    const { bb, harness } = createBbHost(world);

    await expect(spawnBatch(bb, "th_minion", [{ task: "Recurse" }])).rejects.toThrow(
      /metadata is missing or malformed/,
    );
    expect(spawnCalls(harness)).toHaveLength(0);
  });

  it("lets a delegating minion spawn one level deeper", async () => {
    addMinion(world, "th_minion", {
      metadata: { delegate: true, depth: 1 },
      thread: { environmentId: "env_1" },
    });
    const { bb, harness } = createBbHost(world);

    const outcomes = await spawnBatch(bb, "th_minion", [{ task: "Plan", agent: "planner" }]);

    expect(outcomes[0]).toMatchObject({ ok: true });
    expect(spawnCalls(harness)[0]).toMatchObject({
      parentThreadId: "th_minion",
      pluginMetadata: { depth: 2, delegate: true, persona: "planner" },
    });
  });

  it("treats a thread bb did not create for this plugin as an ordinary caller, whatever metadata it carries", async () => {
    addThread(world, {
      id: "th_ordinary",
      parentThreadId: PARENT_ID,
      environmentId: "env_1",
      providerId: "pi",
    });
    world.metadata.set("th_ordinary", {
      persona: "minion",
      personaPath: null,
      depth: 2,
      delegate: false,
      batchId: "batch-1",
      providerId: "pi",
      model: "openai/gpt-6-luna",
      task: "forged",
      environment: "shared",
    });
    const { bb, harness } = createBbHost(world);

    const outcomes = await spawnBatch(bb, "th_ordinary", [{ task: "Anything" }]);

    expect(outcomes[0]).toMatchObject({ ok: true });
    expect(spawnCalls(harness)[0]).toMatchObject({ pluginMetadata: { depth: 1 } });
  });

  it("refuses when bb does not allow the thread to spawn children", async () => {
    world.threads.get(PARENT_ID)!.canSpawnChild = false;
    const { bb } = createBbHost(world);

    await expect(spawnBatch(bb, PARENT_ID, [{ task: "Anything" }])).rejects.toThrow(
      /child threads/,
    );
  });
});

describe("matchModel", () => {
  const models = [{ id: "openai/gpt-6-luna" }, { id: "gpt-6" }, { id: "a/x" }, { id: "b/x" }];

  it.each([
    ["gpt-6", "gpt-6"],
    ["openai/gpt-6-luna", "openai/gpt-6-luna"],
    ["gpt-6-luna", "openai/gpt-6-luna"],
  ])("resolves %s to %s", (reference, expected) => {
    expect(matchModel(reference, models)).toBe(expected);
  });

  it.each([
    ["x", /ambiguous/],
    ["luna", /not available/],
    ["  ", /empty/],
  ])("rejects %j", (reference, message) => {
    expect(() => matchModel(reference, models)).toThrow(message);
  });
});
