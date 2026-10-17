import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubsessionManager } from "../../../extensions/pi/subsessions/manager.js";
import { abortAgents, halt } from "../../../extensions/pi/tools/halt.js";
import { AgentTree } from "../../../extensions/pi/tree.js";

function createCtx() {
  return { cwd: "/tmp" } as any;
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

describe("abortAgents", () => {
  it("calls abortSession on subsessionManager and marks tree as aborted", async () => {
    const tree = new AgentTree();
    const sessions = new Map<string, any>();
    tree.add("id1", "bob", "task");
    const session = mockSession();
    sessions.set("id1", session);
    const subsessionManager = createMockSubsessionManager(sessions);

    await abortAgents(["id1"], tree, subsessionManager);

    expect(subsessionManager.abortSession).toHaveBeenCalledWith("id1");
    expect(tree.get("id1")?.status).toBe("aborted");
  });

  it("still aborts tree node when no session exists", async () => {
    const tree = new AgentTree();
    const sessions = new Map<string, any>();
    tree.add("id1", "bob", "task");
    // No session set
    const subsessionManager = createMockSubsessionManager(sessions);

    await abortAgents(["id1"], tree, subsessionManager);

    expect(subsessionManager.abortSession).not.toHaveBeenCalled();
    expect(tree.get("id1")?.status).toBe("aborted");
  });

  it("returns count of aborted agents", async () => {
    const tree = new AgentTree();
    const sessions = new Map<string, any>();
    tree.add("a", "bob", "t1");
    tree.add("b", "kevin", "t2");
    sessions.set("a", mockSession());
    sessions.set("b", mockSession());
    const subsessionManager = createMockSubsessionManager(sessions);

    const count = await abortAgents(["a", "b"], tree, subsessionManager);
    expect(count).toBe(2);
  });
});

describe("halt", () => {
  let tree: AgentTree;
  let sessions: Map<string, any>;
  let subsessionManager: SubsessionManager;

  beforeEach(() => {
    tree = new AgentTree();
    sessions = new Map();
    subsessionManager = createMockSubsessionManager(sessions);
  });

  it("halts a specific running agent by id", async () => {
    tree.add("id1", "bob", "task");
    sessions.set("id1", mockSession());
    const execute = halt(tree, subsessionManager);

    const result = await execute("tc", { id: "id1" }, undefined, undefined, createCtx());

    expect(tree.get("id1")?.status).toBe("aborted");
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("id1");
  });

  it("halts all running agents when id is 'all'", async () => {
    tree.add("a", "bob", "t1");
    tree.add("b", "kevin", "t2");
    sessions.set("a", mockSession());
    sessions.set("b", mockSession());
    const execute = halt(tree, subsessionManager);

    const result = await execute("tc", { id: "all" }, undefined, undefined, createCtx());

    expect(tree.get("a")?.status).toBe("aborted");
    expect(tree.get("b")?.status).toBe("aborted");
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("2");
  });

  it("throws for unknown agent id", async () => {
    const execute = halt(tree, subsessionManager);

    await expect(execute("tc", { id: "nope" }, undefined, undefined, createCtx())).rejects.toThrow(
      /nope/,
    );
  });

  it("returns info (not error) for already-completed agent", async () => {
    tree.add("id1", "bob", "task");
    tree.updateStatus("id1", "completed", 0);
    const execute = halt(tree, subsessionManager);

    const result = await execute("tc", { id: "id1" }, undefined, undefined, createCtx());

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("completed");
  });

  it("returns info when 'all' but nothing is running", async () => {
    const execute = halt(tree, subsessionManager);

    const result = await execute("tc", { id: "all" }, undefined, undefined, createCtx());

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("No");
  });
});
