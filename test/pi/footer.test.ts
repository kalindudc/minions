import { beforeEach, describe, expect, it } from "vitest";
import { buildFooterFactory } from "../../extensions/pi/footer.js";
import { AgentTree } from "../../extensions/pi/tree.js";

// Minimal theme stub that returns text as-is (no ANSI codes)
const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as any;

// FooterData stub with no git branch, no extension statuses
const footerData = {
  getGitBranch: () => null,
  getExtensionStatuses: () => new Map<string, string>(),
  getAvailableProviderCount: () => 1,
} as any;

function makeEntry(input: number, output: number, cost: number) {
  return {
    type: "message",
    id: "e1",
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      usage: {
        input,
        output,
        cacheRead: 0,
        cacheWrite: 0,
        cost: { total: cost },
      },
    },
  };
}

function makeCtx(
  entries: any[] = [],
  contextUsage?: { percent: number; tokens: number; contextWindow: number },
) {
  return {
    sessionManager: {
      getEntries: () => entries,
      getCwd: () => "/home/testuser/project",
      getSessionName: () => undefined,
    },
    getContextUsage: () =>
      contextUsage
        ? {
            tokens: contextUsage.tokens,
            contextWindow: contextUsage.contextWindow,
            percent: contextUsage.percent,
          }
        : undefined,
    modelRegistry: {
      isUsingOAuth: () => false,
    },
    model: {
      id: "claude-test",
      name: "Claude Test",
      provider: "anthropic",
      reasoning: false,
      contextWindow: 200000,
    },
  } as any;
}

describe("buildFooterFactory", () => {
  let tree: AgentTree;

  beforeEach(() => {
    tree = new AgentTree();
  });

  it("returns a Component with render()", () => {
    const factory = buildFooterFactory({
      getCtx: () => makeCtx(),
      getModel: () => undefined,
      getThinkingLevel: () => "off",
      tree,
    });

    const component = factory({} as any, theme, footerData);
    expect(typeof component.render).toBe("function");
    expect(typeof component.invalidate).toBe("function");

    const lines = component.render(120);
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it("returns [] when ctx is null", () => {
    const factory = buildFooterFactory({
      getCtx: () => null,
      getModel: () => undefined,
      getThinkingLevel: () => "off",
      tree,
    });

    const component = factory({} as any, theme, footerData);
    const lines = component.render(120);
    expect(lines).toEqual([]);
  });

  it("combines session and minion token counts", () => {
    // Session entry: input 1000
    const entries = [makeEntry(1000, 0, 0.001)];

    // Minion with input 500, cost 0.0005
    tree.add("a", "bob", "task");
    tree.updateUsage("a", { input: 500, cost: 0.0005 });

    const factory = buildFooterFactory({
      getCtx: () => makeCtx(entries),
      getModel: () => undefined,
      getThinkingLevel: () => "off",
      tree,
    });

    const component = factory({} as any, theme, footerData);
    const lines = component.render(120);
    const text = lines.join("\n");

    // 1000 + 500 = 1500 → "1.5k"
    expect(text).toContain("1.5k");
    // 0.001 + 0.0005 = 0.0015 → toFixed(3) = "0.002"
    expect(text).toContain("$0.002");
  });

  it("shows session-only totals when no minions ran", () => {
    const entries = [makeEntry(2000, 0, 0)];

    const factory = buildFooterFactory({
      getCtx: () => makeCtx(entries),
      getModel: () => undefined,
      getThinkingLevel: () => "off",
      tree,
    });

    const component = factory({} as any, theme, footerData);
    const lines = component.render(120);
    const text = lines.join("\n");

    // 2000 → "2.0k"
    expect(text).toContain("2.0k");
  });

  it("renders extension statuses as third line", () => {
    const footerDataWithStatus = {
      getGitBranch: () => null,
      getExtensionStatuses: () => new Map([["minions-bg", "background minions: 2"]]),
      getAvailableProviderCount: () => 1,
    } as any;

    const factory = buildFooterFactory({
      getCtx: () => makeCtx(),
      getModel: () => undefined,
      getThinkingLevel: () => "off",
      tree,
    });

    const component = factory({} as any, theme, footerDataWithStatus);
    const lines = component.render(120);

    expect(lines.length).toBe(3);
    expect(lines[2]).toContain("background minions: 2");
  });

  it("excludes user message entries from totals", () => {
    // A user entry with large input that should NOT be counted
    const userEntry = {
      type: "message",
      id: "u1",
      parentId: null,
      timestamp: new Date().toISOString(),
      message: {
        role: "user",
        usage: {
          input: 9999,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: { total: 0 },
        },
      },
    };

    const factory = buildFooterFactory({
      getCtx: () => makeCtx([userEntry]),
      getModel: () => undefined,
      getThinkingLevel: () => "off",
      tree,
    });

    const component = factory({} as any, theme, footerData);
    const lines = component.render(120);
    const text = lines.join("\n");

    // 9999 → "10.0k" — should NOT appear since user entries are excluded
    expect(text).not.toContain("10.0k");
    // Should show "0" input tokens
    expect(text).toContain("↑0");
  });
});
