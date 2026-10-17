import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHaltHandler } from "../../../extensions/pi/commands/halt.js";
import type { SubsessionManager } from "../../../extensions/pi/subsessions/manager.js";
import { AgentTree } from "../../../extensions/pi/tree.js";

function createCtx(notifyFn = vi.fn()) {
  return { ui: { notify: notifyFn }, cwd: "/tmp" } as any;
}

function createMockSubsessionManager(sessions: Map<string, any> = new Map()) {
  const abortSession = vi.fn().mockImplementation((id: string) => {
    const session = sessions.get(id);
    if (session) {
      session.abort();
      return true;
    }
    return false;
  });
  return {
    getSession: vi.fn().mockImplementation((id: string) => sessions.get(id)),
    getSessionHandle: vi.fn().mockImplementation((id: string) => {
      const session = sessions.get(id);
      if (!session) return undefined;
      return {
        id,
        path: `/mock/path/${id}.jsonl`,
        steer: vi.fn(),
        abort: () => session.abort(),
      };
    }),
    abortSession,
    updateStatus: vi.fn(),
  } as unknown as SubsessionManager;
}

function mockSession() {
  return {
    abort: vi.fn(),
    steer: vi.fn().mockResolvedValue(undefined),
    state: { messages: [] },
    getSessionStats: vi.fn().mockReturnValue({
      tokens: {
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        total: 150,
      },
      cost: 0.001,
    }),
  };
}

describe("createHaltHandler", () => {
  let tree: AgentTree;
  let sessions: Map<string, any>;
  let subsessionManager: SubsessionManager;

  beforeEach(() => {
    tree = new AgentTree();
    sessions = new Map();
    subsessionManager = createMockSubsessionManager(sessions);
  });

  it("shows usage error when args is empty", async () => {
    const notify = vi.fn();
    const handler = createHaltHandler(tree, subsessionManager);
    await handler("", createCtx(notify));
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Usage"), "error");
  });

  it("shows usage error when args is whitespace", async () => {
    const notify = vi.fn();
    const handler = createHaltHandler(tree, subsessionManager);
    await handler("   ", createCtx(notify));
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Usage"), "error");
  });

  it("notifies 'No running minions' when 'all' and none running", async () => {
    const notify = vi.fn();
    const handler = createHaltHandler(tree, subsessionManager);
    await handler("all", createCtx(notify));
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/[Nn]o.*minion/), "info");
  });

  it("halts all running agents when 'all'", async () => {
    tree.add("a", "bob", "t1");
    tree.add("b", "kevin", "t2");
    sessions.set("a", mockSession());
    sessions.set("b", mockSession());
    const notify = vi.fn();
    const handler = createHaltHandler(tree, subsessionManager);

    await handler("all", createCtx(notify));

    expect(tree.get("a")?.status).toBe("aborted");
    expect(tree.get("b")?.status).toBe("aborted");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("2"), "info");
  });

  it("halts specific agent by id", async () => {
    tree.add("abc123", "bob", "task");
    sessions.set("abc123", mockSession());
    const notify = vi.fn();
    const handler = createHaltHandler(tree, subsessionManager);

    await handler("abc123", createCtx(notify));

    expect(tree.get("abc123")?.status).toBe("aborted");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("abc123"), "info");
  });

  it("shows error for unknown id", async () => {
    const notify = vi.fn();
    const handler = createHaltHandler(tree, subsessionManager);
    await handler("notreal", createCtx(notify));
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("notreal"), "error");
  });

  it("shows info (not error) when agent already completed", async () => {
    tree.add("done1", "bob", "task");
    tree.updateStatus("done1", "completed", 0);
    const notify = vi.fn();
    const handler = createHaltHandler(tree, subsessionManager);

    await handler("done1", createCtx(notify));

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("completed"), "info");
  });
});
