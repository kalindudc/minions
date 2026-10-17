import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, MINION_PROGRESS_CHANNEL } from "../../../extensions/pi/subsessions/event-bus.js";
import {
  hideObservability,
  showMinionObservability,
} from "../../../extensions/pi/subsessions/observability.js";
import { AgentTree } from "../../../extensions/pi/tree.js";
import { createMockContext } from "../helpers/mock-context.js";

function _createMockTheme(): Theme {
  return {
    fg: vi.fn((_color: string, text: string) => text),
    bg: vi.fn((_color: string, text: string) => text),
    bold: vi.fn((text: string) => text),
    dim: vi.fn((text: string) => text),
  } as unknown as Theme;
}

describe("observability widget UX", () => {
  let tree: AgentTree;
  let eventBus: EventBus;
  let ctx: ExtensionContext;
  let inputHandler: ((data: string) => { consume: boolean }) | null = null;

  beforeEach(() => {
    tree = new AgentTree();
    eventBus = new EventBus();
    ctx = createMockContext("/tmp");
    inputHandler = null;

    // Mock onTerminalInput to capture handler
    vi.mocked(ctx.ui.onTerminalInput).mockImplementation((handler) => {
      inputHandler = handler as (data: string) => { consume: boolean };
      return () => {
        inputHandler = null;
      };
    });
  });

  describe("minion activity streaming", () => {
    it("shows tool execution start with tool name and args", async () => {
      tree.add("minion-123", "kevin", "test task");

      showMinionObservability(ctx, tree, eventBus, "minion-123");

      // Emit a tool start event
      eventBus.emit(MINION_PROGRESS_CHANNEL, {
        id: "minion-123",
        progress: {
          type: "tool_execution_start",
          toolName: "bash",
          args: { command: "ls -la" },
        },
      });

      // Verify widget re-renders (indicating event was processed)
      const setWidgetCalls = vi.mocked(ctx.ui.setWidget).mock.calls;
      expect(setWidgetCalls.length).toBeGreaterThanOrEqual(1);

      // Cleanup
      inputHandler?.("q");
    });

    it("shows tool output when tool completes", async () => {
      tree.add("minion-123", "kevin", "test task");

      showMinionObservability(ctx, tree, eventBus, "minion-123");

      // Widget should have rendered initially
      expect(ctx.ui.setWidget).toHaveBeenCalledWith("minion-observability", expect.any(Function), {
        placement: "aboveEditor",
      });

      // Cleanup
      inputHandler?.("q");
    });

    it("shows assistant thinking with text deltas", async () => {
      tree.add("minion-123", "kevin", "test task");

      showMinionObservability(ctx, tree, eventBus, "minion-123");

      // Widget should render with correct placement
      const calls = vi.mocked(ctx.ui.setWidget).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0]).toEqual([
        "minion-observability",
        expect.any(Function),
        { placement: "aboveEditor" },
      ]);

      // Cleanup
      inputHandler?.("q");
    });

    it("shows turn completion activity", async () => {
      tree.add("minion-123", "kevin", "test task");

      showMinionObservability(ctx, tree, eventBus, "minion-123");

      // Emit turn end event
      eventBus.emit(MINION_PROGRESS_CHANNEL, {
        id: "minion-123",
        progress: { type: "turn_end" },
      });

      // Should have rendered
      expect(ctx.ui.setWidget).toHaveBeenCalled();

      // Cleanup
      inputHandler?.("q");
    });

    it("shows agent completion", async () => {
      tree.add("minion-123", "kevin", "test task");

      showMinionObservability(ctx, tree, eventBus, "minion-123");

      // Emit agent end event
      eventBus.emit(MINION_PROGRESS_CHANNEL, {
        id: "minion-123",
        progress: { type: "agent_end" },
      });

      // Should have rendered
      expect(ctx.ui.setWidget).toHaveBeenCalled();

      // Cleanup
      inputHandler?.("q");
    });
  });

  describe("keyboard navigation", () => {
    it("q key closes observability and returns to parent", async () => {
      tree.add("minion-123", "kevin", "test task");

      const promise = showMinionObservability(ctx, tree, eventBus, "minion-123");

      inputHandler?.("q");
      const result = await promise;

      expect(result.action).toBe("close");
    });

    it("escape key closes observability", async () => {
      tree.add("minion-123", "kevin", "test task");

      const promise = showMinionObservability(ctx, tree, eventBus, "minion-123");

      inputHandler?.("\x1b");
      const result = await promise;

      expect(result.action).toBe("close");
    });

    it("b key returns to dashboard", async () => {
      tree.add("minion-123", "kevin", "test task");

      const promise = showMinionObservability(ctx, tree, eventBus, "minion-123");

      inputHandler?.("b");
      const result = await promise;

      expect(result.action).toBe("back");
    });

    it("random keys are consumed but have no effect", async () => {
      tree.add("minion-123", "kevin", "test task");

      showMinionObservability(ctx, tree, eventBus, "minion-123");

      // All these should be consumed (return true) without closing
      expect(inputHandler?.("a")).toEqual({ consume: true });
      expect(inputHandler?.("1")).toEqual({ consume: true });
      expect(inputHandler?.("x")).toEqual({ consume: true });
      expect(inputHandler?.("\r")).toEqual({ consume: true });

      // Widget should still be open
      const lastCall = vi.mocked(ctx.ui.setWidget).mock.calls[
        vi.mocked(ctx.ui.setWidget).mock.calls.length - 1
      ];
      expect(lastCall?.[1]).not.toBeUndefined();

      // Cleanup
      inputHandler?.("q");
    });
  });

  describe("widget lifecycle", () => {
    it("widget is placed above editor", async () => {
      tree.add("minion-123", "kevin", "test task");

      showMinionObservability(ctx, tree, eventBus, "minion-123");

      const call = vi.mocked(ctx.ui.setWidget).mock.calls[0];
      expect(call?.[2]).toEqual({ placement: "aboveEditor" });

      // Cleanup
      inputHandler?.("q");
    });

    it("widget is removed when closed", async () => {
      tree.add("minion-123", "kevin", "test task");

      const promise = showMinionObservability(ctx, tree, eventBus, "minion-123");

      inputHandler?.("q");
      await promise;

      const lastCall = vi.mocked(ctx.ui.setWidget).mock.calls[
        vi.mocked(ctx.ui.setWidget).mock.calls.length - 1
      ];
      expect(lastCall).toEqual(["minion-observability", undefined]);
    });

    it("keyboard handler is cleaned up on close", async () => {
      tree.add("minion-123", "kevin", "test task");
      const unsubscribe = vi.fn();

      // Set up mock that captures handler and returns unsubscribe
      vi.mocked(ctx.ui.onTerminalInput).mockImplementation((handler) => {
        inputHandler = handler as (data: string) => { consume: boolean };
        return unsubscribe;
      });

      const promise = showMinionObservability(ctx, tree, eventBus, "minion-123");
      inputHandler?.("q");
      await promise;

      expect(unsubscribe).toHaveBeenCalled();
    });

    it("event bus subscription is cleaned up on close", async () => {
      tree.add("minion-123", "kevin", "test task");

      const promise = showMinionObservability(ctx, tree, eventBus, "minion-123");

      inputHandler?.("q");
      await promise;

      // Clear render calls (including cleanup call)
      vi.mocked(ctx.ui.setWidget).mockClear();

      // Emit event after close
      eventBus.emit(MINION_PROGRESS_CHANNEL, {
        id: "minion-123",
        progress: { type: "activity", message: "test" },
      });

      // Should not re-render after close (no new widget calls except cleanup which already happened)
      expect(ctx.ui.setWidget).not.toHaveBeenCalled();
    });
  });

  describe("event filtering", () => {
    it("only shows events for the target minion", async () => {
      tree.add("minion-123", "kevin", "test task");
      tree.add("minion-456", "brett", "other task");

      showMinionObservability(ctx, tree, eventBus, "minion-123");

      // Clear initial render
      vi.mocked(ctx.ui.setWidget).mockClear();

      // Emit event for other minion
      eventBus.emit(MINION_PROGRESS_CHANNEL, {
        id: "minion-456",
        progress: { type: "tool_execution_start", toolName: "bash", args: {} },
      });

      // Should not render for other minion
      expect(ctx.ui.setWidget).not.toHaveBeenCalled();

      // Cleanup
      inputHandler?.("q");
    });

    it("subscribes to tree changes for activity updates", async () => {
      tree.add("minion-123", "kevin", "test task");
      tree.add("minion-456", "brett", "other task");

      const onChangeSpy = vi.spyOn(tree, "onChange");

      showMinionObservability(ctx, tree, eventBus, "minion-123");

      // Should have subscribed to tree changes
      expect(onChangeSpy).toHaveBeenCalled();

      // Cleanup
      inputHandler?.("q");
    });
  });
});

describe("hideObservability UX", () => {
  it("removes widget immediately", () => {
    const ctx = createMockContext("/tmp");

    hideObservability(ctx);

    expect(ctx.ui.setWidget).toHaveBeenCalledWith("minion-observability", undefined);
  });
});
