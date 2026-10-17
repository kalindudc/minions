import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatTokens,
  formatToolCall,
  formatUsage,
  renderCall,
  renderResult,
} from "../../extensions/pi/render.js";
import type { SpawnToolDetails } from "../../extensions/pi/tools/spawn.js";
import type { UsageStats } from "../../extensions/pi/types.js";
import { emptyUsage } from "../../extensions/pi/types.js";

describe("formatTokens", () => {
  it("formats small numbers as-is", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(999)).toBe("999");
  });

  it("formats thousands with k suffix", () => {
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(9999)).toBe("10.0k");
    expect(formatTokens(50000)).toBe("50k");
  });

  it("formats millions with M suffix", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });
});

describe("formatDuration", () => {
  it("formats sub-second as ms", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("formats seconds under a minute", () => {
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(3500)).toBe("3s");
    expect(formatDuration(59999)).toBe("59s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(61000)).toBe("1m 1s");
    expect(formatDuration(90000)).toBe("1m 30s");
  });
});

describe("formatToolCall", () => {
  it("formats bash as $ <cmd>", () => {
    expect(formatToolCall("bash", { command: "ls -la" })).toBe("$ ls -la");
  });

  it("truncates long bash commands", () => {
    const long = "a".repeat(80);
    const result = formatToolCall("bash", { command: long });
    expect(result.length).toBeLessThan(80);
    expect(result).toMatch(/\.\.\.$/);
  });

  it("formats read with path", () => {
    const result = formatToolCall("read", { path: "/home/user/file.ts" });
    expect(result).toBe("read /home/user/file.ts");
  });

  it("formats unknown tool with name and args preview", () => {
    const result = formatToolCall("my_tool", { foo: "bar" });
    expect(result).toContain("my_tool");
    expect(result).toContain("foo");
  });
});

describe("formatUsage", () => {
  it("returns non-empty string for populated stats", () => {
    const usage: UsageStats = {
      input: 1000,
      output: 200,
      cacheRead: 50,
      cacheWrite: 10,
      cost: 0.002,
      contextTokens: 1260,
      turns: 3,
    };
    const result = formatUsage(usage);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("3"); // turns
  });

  it("includes model when provided", () => {
    const usage: UsageStats = {
      input: 100,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 120,
      turns: 1,
    };
    expect(formatUsage(usage, "haiku")).toContain("haiku");
  });

  it("handles zero usage without throwing", () => {
    const usage: UsageStats = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 0,
      turns: 0,
    };
    expect(() => formatUsage(usage)).not.toThrow();
  });
});

describe("renderCall", () => {
  // Minimal theme stub that returns text as-is (no ANSI codes)
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as any;

  it("renders the task descriptor preview for a one-item array with an agent", () => {
    const result = renderCall({ tasks: [{ agent: "scout", task: "find bugs" }] }, theme, {});
    const text = result.render(100).join("\n");
    expect(text).toContain("spawn");
    expect(text).toContain("find bugs");
  });

  it("renders a one-item array as a single call without a batch header", () => {
    const result = renderCall({ tasks: [{ task: "fix the bug" }] }, theme, {});
    const text = result.render(100).join("\n");
    expect(text).toContain("spawn");
    expect(text).toContain("fix the bug");
    expect(text).not.toContain("[object Object]");
    expect(text).not.toContain("[1 minion]");
  });

  it("renders the model from the single task descriptor", () => {
    const result = renderCall({ tasks: [{ task: "t", model: "claude-4" }] }, theme, {});
    const text = result.render(100).join("\n");
    expect(text).toContain("claude-4");
  });

  it("shows only the first line of a single task's preview", () => {
    const result = renderCall({ tasks: [{ task: "first line\nsecond line" }] }, theme, {});
    const text = result.render(100).join("\n");
    expect(text).toContain("first line");
    expect(text).not.toContain("second line");
  });

  it.each([
    {},
    { tasks: [] },
    { tasks: [{}] },
    { tasks: [null] },
  ])("renders incomplete streaming arguments without object placeholders: %j", (args) => {
    const text = renderCall(args, theme, {}).render(100).join("\n").trim();
    expect(text).toBe("spawn");
  });

  it("renders batch header with minion count", () => {
    const result = renderCall(
      { tasks: [{ task: "t1" }, { task: "t2" }, { task: "t3" }] },
      theme,
      {},
    );
    const text = result.render(100).join("\n");
    expect(text).toContain("spawn");
    expect(text).toContain("[3 minions]");
  });

  it("batch call header shows model when all tasks use the same model", () => {
    const result = renderCall(
      {
        tasks: [
          { task: "t1", model: "gpt-4" },
          { task: "t2", model: "gpt-4" },
          { task: "t3", model: "gpt-4" },
        ],
      },
      theme,
      {},
    );
    const text = result.render(100).join("\n");
    expect(text).toContain("[3 minions]");
    expect(text).toContain("gpt-4");
  });

  it("batch call header shows no model when tasks use different models", () => {
    const result = renderCall(
      {
        tasks: [
          { task: "t1", model: "gpt-4" },
          { task: "t2", model: "claude-4" },
        ],
      },
      theme,
      {},
    );
    const text = result.render(100).join("\n");
    expect(text).toContain("[2 minions]");
    expect(text).not.toContain("gpt-4");
    expect(text).not.toContain("claude-4");
  });

  it("truncates long task previews", () => {
    const longTask = "a".repeat(100);
    const result = renderCall({ tasks: [{ task: longTask }] }, theme, {});
    const text = result.render(100).join("\n");
    // Task previews longer than 60 chars are truncated with "…"
    // Original task is 100 chars, truncated to 60 + "…" = 61 chars
    expect(text).toContain("…");
    // The text should contain the truncated portion (first 60 chars)
    expect(text).toContain("a".repeat(60));
    // The full 100 chars should NOT be present
    expect(text).not.toContain("a".repeat(100));
  });
});

describe("renderResult", () => {
  // Minimal theme stub that returns text as-is (no ANSI codes)
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as any;

  it("streaming render does not include inline background-control hint", () => {
    const details: SpawnToolDetails = {
      id: "abc",
      name: "kevin",
      agentName: "kevin",
      task: "t",
      status: "running",
      usage: emptyUsage(),
      finalOutput: "",
      activity: "thinking…",
      spinnerFrame: 0,
    };
    const result = renderResult(
      { content: [], details },
      { expanded: false, isPartial: true },
      theme,
      { isError: false },
    );
    const lines = result.render(100);
    const text = lines.join("\n");
    expect(text).toContain("kevin");
    expect(text).not.toContain("/minions " + "bg");
  });

  it("streaming render caches name/id to state", () => {
    const details: SpawnToolDetails = {
      id: "abc",
      name: "kevin",
      agentName: "kevin",
      task: "t",
      status: "running",
      usage: emptyUsage(),
      finalOutput: "",
      activity: "thinking…",
      spinnerFrame: 0,
    };
    const state: Record<string, string | undefined> = {};
    renderResult({ content: [], details }, { expanded: false, isPartial: true }, theme, {
      isError: false,
      state,
    });
    expect(state.cachedName).toBe("kevin");
    expect(state.cachedId).toBe("abc");
  });

  it("error render falls back to cached state when details missing", () => {
    const state = { cachedName: "kevin", cachedId: "abc123" };
    const result = renderResult(
      { content: [{ type: "text", text: "error" }], details: undefined as any },
      { expanded: false, isPartial: false },
      theme,
      { isError: true, state },
    );
    const lines = result.render(100);
    const text = lines.join("\n");
    expect(text).toContain("kevin");
    expect(text).toContain("abc123");
  });

  it("renders completion layout when isPartial=true but status is completed", () => {
    const details: SpawnToolDetails = {
      id: "abc",
      name: "kevin",
      agentName: "kevin",
      task: "t",
      status: "completed",
      usage: emptyUsage(),
      finalOutput: "done",
      activity: "thinking\u2026",
      spinnerFrame: 3,
    };
    const result = renderResult(
      { content: [], details },
      { expanded: false, isPartial: true },
      theme,
      { isError: false },
    );
    const text = result.render(100).join("\n");
    expect(text).toContain("\u2713");
    expect(text).not.toContain("/minions " + "bg");
  });

  it("renders completion layout when isPartial=true but status is failed", () => {
    const details: SpawnToolDetails = {
      id: "abc",
      name: "kevin",
      agentName: "kevin",
      task: "t",
      status: "failed",
      usage: emptyUsage(),
      finalOutput: "",
      spinnerFrame: 2,
    };
    const result = renderResult(
      { content: [], details },
      { expanded: false, isPartial: true },
      theme,
      { isError: false },
    );
    const text = result.render(100).join("\n");
    expect(text).not.toContain("/minions " + "bg");
  });

  it("error render shows 'minion' when no details and no state", () => {
    const result = renderResult(
      { content: [{ type: "text", text: "error" }], details: undefined as any },
      { expanded: false, isPartial: false },
      theme,
      { isError: true },
    );
    const lines = result.render(100);
    const text = lines.join("\n");
    expect(text).toContain("minion");
  });

  it("renders batch mode when isBatch is true", () => {
    const details: SpawnToolDetails = {
      id: "batch-123",
      name: "batch-batch-123",
      agentName: "batch",
      task: "batch of 2 minions",
      isBatch: true,
      minions: [
        {
          id: "1",
          name: "kevin",
          agentName: "kevin",
          task: "t1",
          status: "running",
          usage: emptyUsage(),
          finalOutput: "",
          spinnerFrame: 0,
        },
        {
          id: "2",
          name: "bob",
          agentName: "bob",
          task: "t2",
          status: "running",
          usage: emptyUsage(),
          finalOutput: "",
          spinnerFrame: 0,
        },
      ],
      status: "running",
      usage: emptyUsage(),
      finalOutput: "",
      spinnerFrame: 0,
    };
    const result = renderResult(
      { content: [], details },
      { expanded: false, isPartial: true },
      theme,
      { isError: false },
    );
    const text = result.render(100).join("\n");
    // Note: "[2 minions]" header is shown by renderCall, not renderResult (to avoid duplication)
    expect(text).toContain("kevin");
    expect(text).toContain("bob");
    // Should show spinner icons for running minions
    expect(text).toContain("[oo]");
  });

  it("batch render caches minions to state", () => {
    const details: SpawnToolDetails = {
      id: "batch-123",
      name: "batch-batch-123",
      agentName: "batch",
      task: "batch of 2 minions",
      isBatch: true,
      minions: [
        {
          id: "1",
          name: "kevin",
          agentName: "kevin",
          task: "t1",
          status: "running",
          usage: emptyUsage(),
          finalOutput: "",
        },
        {
          id: "2",
          name: "bob",
          agentName: "bob",
          task: "t2",
          status: "running",
          usage: emptyUsage(),
          finalOutput: "",
        },
      ],
      status: "running",
      usage: emptyUsage(),
      finalOutput: "",
    };
    const state: { cachedMinions?: Array<{ name: string; id: string }> } = {};
    renderResult({ content: [], details }, { expanded: false, isPartial: true }, theme, {
      isError: false,
      state,
    });
    expect(state.cachedMinions).toHaveLength(2);
    expect(state.cachedMinions?.map((m) => m.name)).toContain("kevin");
    expect(state.cachedMinions?.map((m) => m.name)).toContain("bob");
  });

  it("batch render falls back to cached minions when details missing", () => {
    const state = {
      cachedMinions: [
        { name: "kevin", id: "1" },
        { name: "bob", id: "2" },
      ],
    };
    const result = renderResult(
      { content: [{ type: "text", text: "error" }], details: undefined as any },
      { expanded: false, isPartial: false },
      theme,
      { isError: false, state },
    );
    const text = result.render(100).join("\n");
    // Note: "[2 minions]" header is shown by renderCall, not renderResult (to avoid duplication)
    expect(text).toContain("kevin");
    expect(text).toContain("bob");
    // Should show checkmarks for completed status (fallback uses completed status)
    expect(text).toContain("✓");
  });

  it("batch render shows completed checkmarks for completed minions", () => {
    const details: SpawnToolDetails = {
      id: "batch-123",
      name: "batch-batch-123",
      agentName: "batch",
      task: "batch of 2 minions",
      isBatch: true,
      minions: [
        {
          id: "1",
          name: "kevin",
          agentName: "kevin",
          task: "t1",
          status: "completed",
          usage: emptyUsage(),
          finalOutput: "done",
        },
        {
          id: "2",
          name: "bob",
          agentName: "bob",
          task: "t2",
          status: "completed",
          usage: emptyUsage(),
          finalOutput: "done2",
        },
      ],
      status: "completed",
      usage: emptyUsage(),
      finalOutput: "",
    };
    const result = renderResult(
      { content: [], details },
      { expanded: false, isPartial: false },
      theme,
      { isError: false },
    );
    const text = result.render(100).join("\n");
    expect(text).toContain("\u2713"); // Checkmark for completed
    expect(text).not.toContain("[oo]"); // No spinner for completed
    expect(text).toContain("kevin");
    expect(text).toContain("bob");
  });

  it("batch render shows model per minion when models differ", () => {
    const details: SpawnToolDetails = {
      id: "batch-123",
      name: "batch-batch-123",
      agentName: "batch",
      task: "batch of 2 minions",
      isBatch: true,
      minions: [
        {
          id: "1",
          name: "kevin",
          agentName: "ephemeral",
          task: "t1",
          status: "running",
          usage: emptyUsage(),
          model: "gpt-4",
          finalOutput: "",
          spinnerFrame: 0,
        },
        {
          id: "2",
          name: "bob",
          agentName: "ephemeral",
          task: "t2",
          status: "running",
          usage: emptyUsage(),
          model: "claude-4",
          finalOutput: "",
          spinnerFrame: 0,
        },
      ],
      status: "running",
      usage: emptyUsage(),
      finalOutput: "",
      spinnerFrame: 0,
    };
    const result = renderResult(
      { content: [], details },
      { expanded: false, isPartial: true },
      theme,
      { isError: false },
    );
    const text = result.render(100).join("\n");
    expect(text).toContain("gpt-4");
    expect(text).toContain("claude-4");
  });

  it("batch render omits per-minion model when all models are the same", () => {
    const details: SpawnToolDetails = {
      id: "batch-123",
      name: "batch-batch-123",
      agentName: "batch",
      task: "batch of 2 minions",
      isBatch: true,
      minions: [
        {
          id: "1",
          name: "kevin",
          agentName: "ephemeral",
          task: "t1",
          status: "running",
          usage: emptyUsage(),
          model: "claude-4",
          finalOutput: "",
          spinnerFrame: 0,
        },
        {
          id: "2",
          name: "bob",
          agentName: "ephemeral",
          task: "t2",
          status: "running",
          usage: emptyUsage(),
          model: "claude-4",
          finalOutput: "",
          spinnerFrame: 0,
        },
      ],
      status: "running",
      usage: emptyUsage(),
      finalOutput: "",
      spinnerFrame: 0,
    };
    const result = renderResult(
      { content: [], details },
      { expanded: false, isPartial: true },
      theme,
      { isError: false },
    );
    const text = result.render(100).join("\n");
    // Per-minion model labels should NOT appear when all same
    // Count occurrences of "claude-4" — should be 0 in the batch lines
    // (model only appears in the footer, not per-line)
    const lines = text.split("\n");
    const minionLines = lines.filter((l) => l.includes("kevin") || l.includes("bob"));
    for (const line of minionLines) {
      expect(line).not.toContain("claude-4");
    }
  });

  it("batch footer shows mixed model info when models differ", () => {
    const details: SpawnToolDetails = {
      id: "batch-123",
      name: "batch-batch-123",
      agentName: "batch",
      task: "batch of 2 minions",
      isBatch: true,
      minions: [
        {
          id: "1",
          name: "kevin",
          agentName: "ephemeral",
          task: "t1",
          status: "completed",
          usage: {
            input: 100,
            output: 20,
            cacheRead: 0,
            cacheWrite: 0,
            cost: 0.001,
            contextTokens: 120,
            turns: 1,
          },
          model: "gpt-4",
          finalOutput: "done",
        },
        {
          id: "2",
          name: "bob",
          agentName: "ephemeral",
          task: "t2",
          status: "completed",
          usage: {
            input: 200,
            output: 40,
            cacheRead: 0,
            cacheWrite: 0,
            cost: 0.002,
            contextTokens: 240,
            turns: 2,
          },
          model: "claude-4",
          finalOutput: "done2",
        },
      ],
      status: "completed",
      usage: emptyUsage(),
      finalOutput: "",
    };
    const result = renderResult(
      { content: [], details },
      { expanded: false, isPartial: false },
      theme,
      { isError: false },
    );
    const text = result.render(100).join("\n");
    // Per-minion lines DO show models (that's correct for mixed models)
    // But the footer usage line should NOT show a single model
    const lines = text.split("\n");
    const footerLine = lines.find((l) => l.includes("turns") && l.includes("↑"));
    expect(footerLine).toBeDefined();
    expect(footerLine).not.toContain("gpt-4");
    expect(footerLine).not.toContain("claude-4");
  });

  it("batch footer shows model in usage when all models are the same", () => {
    const details: SpawnToolDetails = {
      id: "batch-123",
      name: "batch-batch-123",
      agentName: "batch",
      task: "batch of 2 minions",
      isBatch: true,
      minions: [
        {
          id: "1",
          name: "kevin",
          agentName: "ephemeral",
          task: "t1",
          status: "completed",
          usage: {
            input: 100,
            output: 20,
            cacheRead: 0,
            cacheWrite: 0,
            cost: 0.001,
            contextTokens: 120,
            turns: 1,
          },
          model: "claude-4",
          finalOutput: "done",
        },
        {
          id: "2",
          name: "bob",
          agentName: "ephemeral",
          task: "t2",
          status: "completed",
          usage: {
            input: 200,
            output: 40,
            cacheRead: 0,
            cacheWrite: 0,
            cost: 0.002,
            contextTokens: 240,
            turns: 2,
          },
          model: "claude-4",
          finalOutput: "done2",
        },
      ],
      status: "completed",
      usage: emptyUsage(),
      finalOutput: "",
    };
    const result = renderResult(
      { content: [], details },
      { expanded: false, isPartial: false },
      theme,
      { isError: false },
    );
    const text = result.render(100).join("\n");
    // Footer usage should include the model name
    expect(text).toContain("claude-4");
  });

  it("batch render shows X marks for failed minions", () => {
    const details: SpawnToolDetails = {
      id: "batch-123",
      name: "batch-batch-123",
      agentName: "batch",
      task: "batch of 2 minions",
      isBatch: true,
      minions: [
        {
          id: "1",
          name: "kevin",
          agentName: "kevin",
          task: "t1",
          status: "failed",
          usage: emptyUsage(),
          finalOutput: "error",
        },
        {
          id: "2",
          name: "bob",
          agentName: "bob",
          task: "t2",
          status: "failed",
          usage: emptyUsage(),
          finalOutput: "error2",
        },
      ],
      status: "failed",
      usage: emptyUsage(),
      finalOutput: "",
    };
    const result = renderResult(
      { content: [], details },
      { expanded: false, isPartial: false },
      theme,
      { isError: true },
    );
    const text = result.render(100).join("\n");
    expect(text).toContain("\u2717"); // X for failed
    expect(text).not.toContain("[oo]"); // No spinner
    expect(text).not.toContain("\u2713"); // No checkmark (all failed)
  });
});
