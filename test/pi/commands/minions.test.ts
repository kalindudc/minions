import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMinionsHandler, parseMinionArgs } from "../../../extensions/pi/commands/minions.js";
import { getMinionsSkill } from "../../../extensions/pi/skill.js";
import { EventBus } from "../../../extensions/pi/subsessions/event-bus.js";
import { AgentTree } from "../../../extensions/pi/tree.js";

vi.mock("../../../extensions/pi/subsessions/observability.js", () => ({
  showMinionObservability: vi.fn().mockResolvedValue({ action: "close" }),
  getMinionHistory: vi.fn().mockReturnValue([]),
}));

vi.mock("../../../src/agents.js", () => ({
  discoverAgents: vi.fn().mockReturnValue({ agents: [], projectAgentsDir: null, warnings: [] }),
}));

vi.mock("../../../extensions/pi/version.js", () => ({
  VERSION: "0.0.0-test",
}));

import { showMinionObservability } from "../../../extensions/pi/subsessions/observability.js";
import { discoverAgents } from "../../../src/agents.js";

function createMockContext(): ExtensionCommandContext {
  return {
    cwd: "/tmp",
    ui: {
      notify: vi.fn(),
    },
  } as unknown as ExtensionCommandContext;
}

function createHandler(tree = new AgentTree()) {
  return createMinionsHandler(tree, new EventBus());
}

describe("parseMinionArgs", () => {
  it("maps supported foreground commands", () => {
    expect(parseMinionArgs("")).toEqual({ action: "show-running" });
    expect(parseMinionArgs("list")).toEqual({ action: "list" });
    expect(parseMinionArgs("learn")).toEqual({ action: "learn" });
    expect(parseMinionArgs("skill")).toEqual({ action: "skill" });
    expect(parseMinionArgs("version")).toEqual({ action: "version" });
    expect(parseMinionArgs("help")).toEqual({ action: "help" });
    expect(parseMinionArgs("h")).toEqual({ action: "help" });
    expect(parseMinionArgs("show kevin")).toEqual({ action: "show", target: "kevin" });
    expect(parseMinionArgs("s abc123")).toEqual({ action: "show", target: "abc123" });
  });

  it("rejects removed and unknown subcommands", () => {
    expect(parseMinionArgs("show")).toHaveProperty("error");
    expect(parseMinionArgs("bg kevin")).toHaveProperty("error");
    expect(parseMinionArgs("fg kevin")).toHaveProperty("error");
    expect(parseMinionArgs("steer kevin focus")).toHaveProperty("error");
    expect(parseMinionArgs("changelog")).toHaveProperty("error");
  });
});

describe("/minions command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists available minion types", async () => {
    vi.mocked(discoverAgents).mockReturnValueOnce({
      agents: [
        {
          name: "scout",
          description: "Fast recon",
          source: "project",
          model: "haiku",
          systemPrompt: "Scout",
          filePath: "/tmp/scout.md",
        },
      ],
      projectAgentsDir: null,
      warnings: [],
    });
    const ctx = createMockContext();

    await createHandler()("list", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("scout (project): Fast recon [model: haiku]"),
      "info",
    );
  });

  it("shows the built-in skill text for learn and skill aliases", async () => {
    const ctx = createMockContext();
    const handler = createHandler();

    await handler("learn", ctx);
    await handler("skill", ctx);

    expect(ctx.ui.notify).toHaveBeenNthCalledWith(1, getMinionsSkill(), "info");
    expect(ctx.ui.notify).toHaveBeenNthCalledWith(2, getMinionsSkill(), "info");
  });

  it("opens observability for the first running minion by default", async () => {
    const tree = new AgentTree();
    tree.add("b", "beta", "second");
    tree.add("a", "alpha", "first");
    const ctx = createMockContext();

    await createHandler(tree)("", ctx);

    expect(showMinionObservability).toHaveBeenCalledWith(
      ctx,
      tree,
      expect.any(EventBus),
      "a",
      expect.any(Function),
    );
  });

  it("notifies when no minions are running", async () => {
    const ctx = createMockContext();

    await createHandler()("", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "No active minions. Spawn one with /spawn or the spawn tool.",
      "info",
    );
  });

  it("opens observability for a specific minion by name or id", async () => {
    const tree = new AgentTree();
    tree.add("abc123", "kevin", "inspect");
    const ctx = createMockContext();
    const handler = createHandler(tree);

    await handler("show kevin", ctx);
    await handler("s abc123", ctx);

    expect(showMinionObservability).toHaveBeenNthCalledWith(
      1,
      ctx,
      tree,
      expect.any(EventBus),
      "abc123",
      expect.any(Function),
    );
    expect(showMinionObservability).toHaveBeenNthCalledWith(
      2,
      ctx,
      tree,
      expect.any(EventBus),
      "abc123",
      expect.any(Function),
    );
  });

  it("shows help without removed commands", async () => {
    const ctx = createMockContext();

    await createHandler()("help", ctx);

    const helpText = vi.mocked(ctx.ui.notify).mock.calls[0]?.[0] as string;
    expect(helpText).toContain("learn");
    expect(helpText).toContain("skill");
    expect(helpText).toContain("show");
    expect(helpText).not.toContain("bg <");
    expect(helpText).not.toContain("fg <");
    expect(helpText).not.toContain("steer");
    expect(helpText).not.toContain("changelog");
  });

  it("shows version", async () => {
    const ctx = createMockContext();

    await createHandler()("version", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith("pi-minions v0.0.0-test", "info");
  });
});
