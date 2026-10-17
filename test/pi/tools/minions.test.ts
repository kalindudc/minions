import { describe, expect, it, vi } from "vitest";
import {
  buildShowMinionText,
  listMinions,
  showMinion,
} from "../../../extensions/pi/tools/minions.js";
import { AgentTree } from "../../../extensions/pi/tree.js";
import { emptyUsage } from "../../../extensions/pi/types.js";

vi.mock("../../../extensions/pi/subsessions/observability.js", () => ({
  getMinionHistory: vi.fn().mockReturnValue([]),
}));

function createCtx() {
  return {
    cwd: "/tmp",
    modelRegistry: {},
    model: undefined,
    ui: { setWorkingMessage: vi.fn() },
  } as any;
}

describe("listMinions", () => {
  it("returns 'No active minions.' when the tree is empty", async () => {
    const execute = listMinions(new AgentTree());

    const result = await execute("tc-1", {}, undefined, undefined, createCtx());

    expect((result.content[0] as any).text).toBe("No active minions.");
    expect(result.details).toEqual({ minions: [] });
  });

  it("lists foreground minions from tree state with status, task, model, and activity", async () => {
    const tree = new AgentTree();
    tree.add("a1", "alice", "analyze code", undefined, "scout", "haiku");
    tree.updateActivity("a1", "→ rg TODO");

    const result = await listMinions(tree)("tc-1", {}, undefined, undefined, createCtx());
    const text = (result.content[0] as any).text as string;

    expect(text).toContain("Minions (1):");
    expect(text).toContain("alice (a1) [running] [haiku]: analyze code -- → rg TODO");
    expect(result.details).toEqual({
      minions: [
        {
          id: "a1",
          name: "alice",
          task: "analyze code",
          status: "running",
          agentName: "scout",
          model: "haiku",
          lastActivity: "→ rg TODO",
        },
      ],
    });
  });

  it("includes completed minions retained in the tree", async () => {
    const tree = new AgentTree();
    tree.add("a1", "alice", "analyze code");
    tree.updateStatus("a1", "completed", 0);

    const result = await listMinions(tree)("tc-1", {}, undefined, undefined, createCtx());

    expect((result.content[0] as any).text).toContain("alice (a1) [completed]: analyze code");
  });
});

describe("showMinion", () => {
  it("throws for an unknown minion", async () => {
    const execute = showMinion(new AgentTree());

    await expect(
      execute("tc-1", { target: "nope" }, undefined, undefined, createCtx()),
    ).rejects.toThrow(/not found/);
  });

  it("shows running minion activity by name", async () => {
    const tree = new AgentTree();
    tree.add("a", "kevin", "analyze code", undefined, "scout", "sonnet");
    tree.updateActivity("a", "→ rg TODO");

    const result = await showMinion(tree)(
      "tc-1",
      { target: "kevin" },
      undefined,
      undefined,
      createCtx(),
    );
    const text = (result.content[0] as any).text as string;

    expect(text).toContain("scout kevin (a)");
    expect(text).toContain("Status: running");
    expect(text).toContain("Task: analyze code");
    expect(text).toContain("Model: sonnet");
    expect(text).toContain("Activity: → rg TODO");
    expect(text).toContain("/minions show kevin");
  });

  it("shows completed minion status, duration, usage, and history from tree state", () => {
    const tree = new AgentTree();
    tree.add("a", "kevin", "analyze code");
    tree.updateUsage("a", { ...emptyUsage(), input: 10, output: 5, turns: 1 });
    tree.logActivity("a", "→ rg TODO");
    tree.updateStatus("a", "completed", 0);

    const text = buildShowMinionText(tree, "a");

    expect(text).toContain("kevin (a)");
    expect(text).toContain("Status: completed");
    expect(text).toContain("Duration:");
    expect(text).toContain("Usage:");
    expect(text).toContain("Recent activity:");
    expect(text).toContain("→ rg TODO");
  });
});
