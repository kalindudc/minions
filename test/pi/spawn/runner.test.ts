import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchCoordinator } from "../../../extensions/pi/spawn/batch.js";
import { runSingleMinion } from "../../../extensions/pi/spawn/runner.js";
import { SubsessionManager } from "../../../extensions/pi/subsessions/manager.js";
import type { BatchMinionItem } from "../../../extensions/pi/tools/spawn.js";
import { AgentTree } from "../../../extensions/pi/tree.js";
import { emptyUsage } from "../../../extensions/pi/types.js";

vi.mock("../../../src/agents.js", () => ({
  discoverAgents: vi.fn(),
}));
vi.mock("../../../extensions/pi/spawn.js", () => ({
  runMinionSession: vi.fn(),
}));

import { runMinionSession } from "../../../extensions/pi/spawn.js";
import { discoverAgents } from "../../../src/agents.js";

const mockAgent = {
  name: "scout",
  description: "Fast recon",
  systemPrompt: "You are a scout.",
  source: "user" as const,
  filePath: "/tmp/scout.md",
};

function createCtx() {
  return {
    cwd: "/tmp",
    modelRegistry: {},
    model: undefined,
    ui: { setWorkingMessage: vi.fn() },
    getSystemPrompt: () => "",
    sessionManager: {
      getSessionFile: vi.fn().mockReturnValue("/tmp/parent.jsonl"),
    },
  } as any;
}

function makeMinion(overrides: Partial<BatchMinionItem> = {}): BatchMinionItem {
  return {
    id: "m1",
    name: "alpha",
    agentName: "ephemeral",
    task: "do something",
    status: "running",
    usage: emptyUsage(),
    finalOutput: "",
    ...overrides,
  };
}

function makeCoordinator(m: BatchMinionItem, onUpdate = vi.fn()) {
  return new BatchCoordinator({
    minions: [m],
    isSingleMinion: true,
    batchId: "batch-1",
    batchTask: "test",
    outputPreviewLines: 3,
    spinnerFrames: ["-"],
    onUpdate,
  });
}

beforeEach(() => {
  vi.mocked(discoverAgents).mockReturnValue({
    agents: [mockAgent],
    projectAgentsDir: null,
    warnings: [],
  });
  vi.mocked(runMinionSession).mockResolvedValue({
    exitCode: 0,
    finalOutput: "done",
    usage: { ...emptyUsage(), turns: 1 },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runSingleMinion", () => {
  it("marks the tree node and minion item completed after a successful foreground session", async () => {
    const tree = new AgentTree();
    const ctx = createCtx();
    const m = makeMinion();
    tree.add(m.id, m.name, m.task);

    const result = await runSingleMinion({
      spec: { task: m.task, agent: "scout" },
      m,
      isSingleMinion: true,
      toolCallId: "tc1",
      controller: new AbortController(),
      tree,
      ctx,
      piConfig: { toolSync: { enabled: false, maxWait: 30 } },
      parentToolNames: [],
      subsessionManager: new SubsessionManager("/tmp", "/tmp/parent.jsonl"),
      coordinator: makeCoordinator(m),
    });

    expect(result.success).toBe(true);
    expect(result.result?.finalOutput).toBe("done");
    expect(m.status).toBe("completed");
    expect(tree.get(m.id)?.status).toBe("completed");
  });

  it("forwards usage updates to the tree and coordinator minion", async () => {
    const tree = new AgentTree();
    const ctx = createCtx();
    const m = makeMinion();
    tree.add(m.id, m.name, m.task);
    const onUpdate = vi.fn();

    vi.mocked(runMinionSession).mockImplementation(async (_config, _task, opts) => {
      opts.onUsageUpdate?.({
        input: 50,
        output: 25,
        cacheRead: 1,
        cacheWrite: 1,
        cost: 0.05,
      });
      return {
        exitCode: 0,
        finalOutput: "done",
        usage: {
          input: 50,
          output: 25,
          cacheRead: 1,
          cacheWrite: 1,
          cost: 0.05,
          contextTokens: 0,
          turns: 0,
        },
      };
    });

    await runSingleMinion({
      spec: { task: m.task },
      m,
      isSingleMinion: true,
      toolCallId: "tc1",
      controller: new AbortController(),
      tree,
      ctx,
      piConfig: { toolSync: { enabled: false, maxWait: 30 } },
      parentToolNames: [],
      subsessionManager: new SubsessionManager("/tmp", "/tmp/parent.jsonl"),
      coordinator: makeCoordinator(m, onUpdate),
    });

    expect(tree.get(m.id)?.usage.input).toBe(50);
    expect(m.usage.input).toBe(50);
    expect(m.usage.output).toBe(25);
    expect(onUpdate).toHaveBeenCalled();
  });

  it("marks failed sessions as failed and returns an error result", async () => {
    const tree = new AgentTree();
    const ctx = createCtx();
    const m = makeMinion();
    tree.add(m.id, m.name, m.task);
    vi.mocked(runMinionSession).mockResolvedValueOnce({
      exitCode: 1,
      finalOutput: "boom",
      usage: emptyUsage(),
      error: "boom",
    });

    const result = await runSingleMinion({
      spec: { task: m.task },
      m,
      isSingleMinion: true,
      toolCallId: "tc1",
      controller: new AbortController(),
      tree,
      ctx,
      piConfig: { toolSync: { enabled: false, maxWait: 30 } },
      parentToolNames: [],
      subsessionManager: new SubsessionManager("/tmp", "/tmp/parent.jsonl"),
      coordinator: makeCoordinator(m),
    });

    expect(result.success).toBe(false);
    expect(m.status).toBe("failed");
    expect(tree.get(m.id)?.error).toBe("boom");
  });
});
