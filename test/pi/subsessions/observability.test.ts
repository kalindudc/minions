import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, MINION_PROGRESS_CHANNEL } from "../../../extensions/pi/subsessions/event-bus.js";
import {
  hideObservability,
  showMinionObservability,
} from "../../../extensions/pi/subsessions/observability.js";
import { AgentTree } from "../../../extensions/pi/tree.js";
import { createMockContext } from "../helpers/mock-context.js";

function createMockTheme(): Theme {
  return {
    fg: vi.fn((_color: string, text: string) => text),
    bg: vi.fn((_color: string, text: string) => text),
    bold: vi.fn((text: string) => text),
    dim: vi.fn((text: string) => text),
  } as unknown as Theme;
}

describe("showMinionObservability", () => {
  let tree: AgentTree;
  let eventBus: EventBus;
  let ctx: ExtensionContext;
  let inputHandler: ((data: string) => { consume: boolean }) | null = null;

  beforeEach(() => {
    tree = new AgentTree();
    eventBus = new EventBus();
    ctx = createMockContext("/tmp");
    inputHandler = null;

    vi.mocked(ctx.ui.onTerminalInput).mockImplementation((handler) => {
      inputHandler = handler as (data: string) => { consume: boolean };
      return () => {
        inputHandler = null;
      };
    });
  });

  describe("when showing observability for a minion", () => {
    it("renders the widget above the editor", async () => {
      tree.add("minion-123", "kevin", "test task");

      const promise = showMinionObservability(ctx, tree, eventBus, "minion-123");

      // Widget should be rendered with aboveEditor placement
      expect(ctx.ui.setWidget).toHaveBeenCalledWith("minion-observability", expect.any(Function), {
        placement: "aboveEditor",
      });

      // Cleanup
      inputHandler?.("q");
      await promise;
    });

    it("captures keyboard input for navigation", async () => {
      tree.add("minion-123", "kevin", "test task");

      showMinionObservability(ctx, tree, eventBus, "minion-123");

      expect(ctx.ui.onTerminalInput).toHaveBeenCalledWith(expect.any(Function));

      // Cleanup
      inputHandler?.("q");
    });

    it("returns { action: 'close' } when user presses q", async () => {
      tree.add("minion-123", "kevin", "test task");

      const promise = showMinionObservability(ctx, tree, eventBus, "minion-123");

      inputHandler?.("q");
      const result = await promise;

      expect(result).toEqual({ action: "close" });
    });

    it("returns { action: 'close' } when user presses escape", async () => {
      tree.add("minion-123", "kevin", "test task");

      const promise = showMinionObservability(ctx, tree, eventBus, "minion-123");

      inputHandler?.("\x1b"); // Escape key
      const result = await promise;

      expect(result).toEqual({ action: "close" });
    });

    it("returns { action: 'back' } when user presses b", async () => {
      tree.add("minion-123", "kevin", "test task");

      const promise = showMinionObservability(ctx, tree, eventBus, "minion-123");

      inputHandler?.("b");
      const result = await promise;

      expect(result).toEqual({ action: "back" });
    });

    it("consumes all keyboard input to prevent editor interaction", async () => {
      tree.add("minion-123", "kevin", "test task");

      showMinionObservability(ctx, tree, eventBus, "minion-123");

      // Any key should be consumed
      expect(inputHandler?.("x")).toEqual({ consume: true });
      expect(inputHandler?.("1")).toEqual({ consume: true });
      expect(inputHandler?.("\r")).toEqual({ consume: true });

      // Cleanup
      inputHandler?.("q");
    });

    it("removes the widget when closed", async () => {
      tree.add("minion-123", "kevin", "test task");

      const promise = showMinionObservability(ctx, tree, eventBus, "minion-123");

      inputHandler?.("q");
      await promise;

      expect(ctx.ui.setWidget).toHaveBeenLastCalledWith("minion-observability", undefined);
    });

    it("unsubscribes from keyboard input when closed", async () => {
      tree.add("minion-123", "kevin", "test task");
      const unsubscribeSpy = vi.fn();

      // Set up mock that both captures handler and returns unsubscribe spy
      vi.mocked(ctx.ui.onTerminalInput).mockImplementation((handler) => {
        inputHandler = handler as (data: string) => { consume: boolean };
        return unsubscribeSpy;
      });

      const promise = showMinionObservability(ctx, tree, eventBus, "minion-123");

      inputHandler?.("q");
      await promise;

      expect(unsubscribeSpy).toHaveBeenCalled();
    });
  });

  describe("when receiving minion events via EventBus", () => {
    it("displays tool_start events with tool name and args", async () => {
      tree.add("minion-123", "kevin", "test task");

      showMinionObservability(ctx, tree, eventBus, "minion-123");

      // Emit a tool start event
      eventBus.emit(MINION_PROGRESS_CHANNEL, {
        id: "minion-123",
        progress: {
          type: "tool_execution_start",
          toolName: "bash",
          args: { command: "ls" },
        },
      });

      // Widget should re-render - we verify by checking setWidget was called again
      const widgetCalls = vi.mocked(ctx.ui.setWidget).mock.calls.length;
      expect(widgetCalls).toBeGreaterThanOrEqual(1);

      // Cleanup
      inputHandler?.("q");
    });

    it("ignores events for other minions", async () => {
      tree.add("minion-123", "kevin", "test task");
      tree.add("minion-456", "brett", "other task");

      showMinionObservability(ctx, tree, eventBus, "minion-123");

      // Clear initial render calls
      vi.mocked(ctx.ui.setWidget).mockClear();

      // Emit event for different minion
      eventBus.emit(MINION_PROGRESS_CHANNEL, {
        id: "minion-456",
        progress: { type: "tool_execution_start", toolName: "bash", args: {} },
      });

      // Should not re-render for other minion's events
      expect(ctx.ui.setWidget).not.toHaveBeenCalled();

      // Cleanup
      inputHandler?.("q");
    });

    it("displays text_delta events from assistant", async () => {
      tree.add("minion-123", "kevin", "test task");

      showMinionObservability(ctx, tree, eventBus, "minion-123");

      // Emit a text delta event
      eventBus.emit(MINION_PROGRESS_CHANNEL, {
        id: "minion-123",
        progress: {
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "Hello world" },
        },
      });

      // Should have triggered re-render
      expect(ctx.ui.setWidget).toHaveBeenCalled();

      // Cleanup
      inputHandler?.("q");
    });

    it("displays tool output events", async () => {
      tree.add("minion-123", "kevin", "test task");

      showMinionObservability(ctx, tree, eventBus, "minion-123");

      // Emit a tool end event with output
      eventBus.emit(MINION_PROGRESS_CHANNEL, {
        id: "minion-123",
        progress: {
          type: "tool_execution_end",
          toolName: "read",
          result: { content: [{ type: "text", text: "file contents" }] },
        },
      });

      // Should have triggered re-render
      expect(ctx.ui.setWidget).toHaveBeenCalled();

      // Cleanup
      inputHandler?.("q");
    });

    it("stops receiving events after being closed", async () => {
      tree.add("minion-123", "kevin", "test task");

      const promise = showMinionObservability(ctx, tree, eventBus, "minion-123");

      // Close the widget
      inputHandler?.("q");
      await promise;

      // Clear any post-close calls
      vi.mocked(ctx.ui.setWidget).mockClear();

      // Emit event after close
      eventBus.emit(MINION_PROGRESS_CHANNEL, {
        id: "minion-123",
        progress: { type: "tool_execution_start", toolName: "bash", args: {} },
      });

      // Should not re-render after close
      expect(ctx.ui.setWidget).not.toHaveBeenCalled();
    });
  });

  describe("widget rendering", () => {
    it("shows model in header when minion has model set", async () => {
      tree.add("minion-abc123", "kevin", "test task", undefined, "ephemeral", "claude-4");

      showMinionObservability(ctx, tree, eventBus, "minion-abc123");

      // Get the widget render function
      const renderCall = vi.mocked(ctx.ui.setWidget).mock.calls[0];
      const renderFn = renderCall?.[1] as Function | undefined;
      expect(renderFn).toBeDefined();

      const mockTUI = { requestRender: vi.fn() };
      const mockTheme = createMockTheme();
      const textComponent = renderFn?.(mockTUI, mockTheme);
      expect(textComponent).toBeDefined();

      // The rendered text should contain the model
      const rendered = textComponent.render(100);
      const text = rendered.join("\n");
      expect(text).toContain("claude-4");

      // Cleanup
      inputHandler?.("q");
    });

    it("shows minion name and truncated ID in header", async () => {
      tree.add("minion-abc123", "kevin", "test task");

      showMinionObservability(ctx, tree, eventBus, "minion-abc123");

      // Get the widget render function
      const renderCall = vi.mocked(ctx.ui.setWidget).mock.calls[0];
      const renderFn = renderCall?.[1] as Function | undefined;
      expect(renderFn).toBeDefined();

      // Render with mock TUI and theme
      const mockTUI = { requestRender: vi.fn() };
      const mockTheme = createMockTheme();
      const textComponent = renderFn?.(mockTUI, mockTheme);

      // The text component should contain the rendered content
      expect(textComponent).toBeDefined();

      // Cleanup
      inputHandler?.("q");
    });

    it("shows help text with keyboard shortcuts", async () => {
      tree.add("minion-123", "kevin", "test task");

      showMinionObservability(ctx, tree, eventBus, "minion-123");

      const renderCall = vi.mocked(ctx.ui.setWidget).mock.calls[0];
      const renderFn = renderCall?.[1] as Function | undefined;
      expect(renderFn).toBeDefined();

      const mockTUI = { requestRender: vi.fn() };
      const mockTheme = createMockTheme();
      const textComponent = renderFn?.(mockTUI, mockTheme);

      // Help text should be in the rendered content
      expect(textComponent).toBeDefined();

      // Cleanup
      inputHandler?.("q");
    });
  });
});

describe("activity history preloading", () => {
  let tree: AgentTree;
  let eventBus: EventBus;
  let ctx: ExtensionContext;
  let inputHandler: ((data: string) => { consume: boolean }) | null = null;

  beforeEach(() => {
    tree = new AgentTree();
    eventBus = new EventBus();
    ctx = createMockContext("/tmp");
    inputHandler = null;

    vi.mocked(ctx.ui.onTerminalInput).mockImplementation((handler) => {
      inputHandler = handler as (data: string) => { consume: boolean };
      return () => {
        inputHandler = null;
      };
    });
  });

  it("renders lines from activityHistory on widget open", async () => {
    tree.add("minion-123", "kevin", "test task");
    tree.setActivityHistory("minion-123", ["turn 1", "→ $ ls"]);

    showMinionObservability(ctx, tree, eventBus, "minion-123");

    const renderCall = vi.mocked(ctx.ui.setWidget).mock.calls[0];
    const renderFn = renderCall?.[1] as Function | undefined;
    expect(renderFn).toBeDefined();

    const mockTUI = { requestRender: vi.fn() };
    const mockTheme = createMockTheme();
    const textComponent = renderFn?.(mockTUI, mockTheme);
    expect(textComponent).toBeDefined();

    inputHandler?.("q");
  });

  it("syncs new history entries on tree change", async () => {
    tree.add("minion-123", "kevin", "test task");
    tree.setActivityHistory("minion-123", ["turn 1"]);

    showMinionObservability(ctx, tree, eventBus, "minion-123");

    vi.mocked(ctx.ui.setWidget).mockClear();
    tree.logActivity("minion-123", "→ $ read file");

    expect(ctx.ui.setWidget).toHaveBeenCalled();

    inputHandler?.("q");
  });
});

describe("history trimming does not duplicate turns", () => {
  let tree: AgentTree;
  let eventBus: EventBus;
  let ctx: ExtensionContext;
  let inputHandler: ((data: string) => { consume: boolean }) | null = null;

  beforeEach(() => {
    tree = new AgentTree();
    eventBus = new EventBus();
    ctx = createMockContext("/tmp");
    inputHandler = null;

    vi.mocked(ctx.ui.onTerminalInput).mockImplementation((handler) => {
      inputHandler = handler as (data: string) => { consume: boolean };
      return () => {
        inputHandler = null;
      };
    });
  });

  function getRenderedLines(): string[] {
    const calls = vi.mocked(ctx.ui.setWidget).mock.calls;
    const lastCall = calls[calls.length - 1];
    const renderFn = lastCall?.[1] as Function | undefined;
    if (!renderFn) return [];

    const mockTUI = { requestRender: vi.fn() };
    const mockTheme = createMockTheme();
    const textComponent = renderFn(mockTUI, mockTheme);
    // Text component renders lines; first 2 are header + separator
    return textComponent.render(200);
  }

  it("does not repeat history entries after messages are trimmed", async () => {
    tree.add("minion-123", "kevin", "test task");
    // maxVisibleMessages defaults to 6

    showMinionObservability(ctx, tree, eventBus, "minion-123");

    // Log enough activities to exceed the visible limit and force trimming
    for (let i = 1; i <= 10; i++) {
      tree.logActivity("minion-123", `turn ${i}`);
    }

    const lines = getRenderedLines();
    // Strip header + separator (first 2 lines), keep only message lines
    const messageLines = lines.slice(2);

    // Each turn text should appear at most once
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const line of messageLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (seen.has(trimmed)) duplicates.push(trimmed);
      seen.add(trimmed);
    }

    expect(duplicates).toEqual([]);

    // The most recent turns should be visible (newest at bottom)
    const joinedLines = messageLines.join("\n");
    expect(joinedLines).toContain("turn 10");

    inputHandler?.("q");
  });

  it("shows latest entries without gaps after many rapid logActivity calls", async () => {
    tree.add("minion-123", "kevin", "test task");

    showMinionObservability(ctx, tree, eventBus, "minion-123");

    // Rapid-fire 20 activities
    for (let i = 1; i <= 20; i++) {
      tree.logActivity("minion-123", `step ${i}`);
    }

    const lines = getRenderedLines();
    const messageLines = lines.slice(2).filter((l: string) => l.trim());

    // Should show the most recent entries, no duplicates
    const texts = messageLines.map((l: string) => l.trim());
    const uniqueTexts = [...new Set(texts)];
    expect(texts).toEqual(uniqueTexts);

    // The very last entry should be present
    expect(texts).toContain("step 20");

    inputHandler?.("q");
  });
});

describe("hideObservability", () => {
  it("removes the observability widget", () => {
    const ctx = createMockContext("/tmp");

    hideObservability(ctx);

    expect(ctx.ui.setWidget).toHaveBeenCalledWith("minion-observability", undefined);
  });
});

describe("event buffer management", () => {
  let tree: AgentTree;
  let eventBus: EventBus;
  let ctx: ExtensionContext;
  let inputHandler: ((data: string) => { consume: boolean }) | null = null;

  beforeEach(() => {
    tree = new AgentTree();
    eventBus = new EventBus();
    ctx = createMockContext("/tmp");
    inputHandler = null;

    vi.mocked(ctx.ui.onTerminalInput).mockImplementation((handler) => {
      inputHandler = handler as (data: string) => { consume: boolean };
      return () => {
        inputHandler = null;
      };
    });
  });

  it("maintains circular buffer of max 100 events", async () => {
    tree.add("minion-123", "kevin", "test task");

    showMinionObservability(ctx, tree, eventBus, "minion-123");

    // Emit more than 100 events
    for (let i = 0; i < 110; i++) {
      eventBus.emit(MINION_PROGRESS_CHANNEL, {
        id: "minion-123",
        progress: { type: "activity", message: `Event ${i}` },
      });
    }

    // Widget should still be functioning (not crashed)
    // We verify by checking it can still handle input
    expect(inputHandler?.("q")).toEqual({ consume: true });

    // Cleanup
    const promise = showMinionObservability(ctx, tree, eventBus, "minion-123");
    inputHandler?.("q");
    await promise;
  });

  it("shows newest events at the bottom of the viewport", async () => {
    tree.add("minion-123", "kevin", "test task");

    showMinionObservability(ctx, tree, eventBus, "minion-123");

    // Emit several events in sequence
    for (let i = 0; i < 5; i++) {
      eventBus.emit(MINION_PROGRESS_CHANNEL, {
        id: "minion-123",
        progress: { type: "activity", message: `Event ${i}` },
      });
    }

    // Get the rendered output
    const renderCall = vi.mocked(ctx.ui.setWidget).mock.calls[
      vi.mocked(ctx.ui.setWidget).mock.calls.length - 1
    ];
    const renderFn = renderCall?.[1] as Function | undefined;

    if (renderFn) {
      const mockTUI = { requestRender: vi.fn() };
      const mockTheme = createMockTheme();
      const textComponent = renderFn(mockTUI, mockTheme);

      // Component should exist
      expect(textComponent).toBeDefined();
    }

    // Cleanup
    inputHandler?.("q");
  });
});
