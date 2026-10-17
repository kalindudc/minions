import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStatusTracker, MINIONS_STATUS_KEY } from "../../extensions/pi/status.js";
import type { SubsessionManager } from "../../extensions/pi/subsessions/manager.js";
import { AgentTree } from "../../extensions/pi/tree.js";
import { createMockContext } from "./helpers/mock-context.js";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as any;

function createMockSubsessionManager() {
  return {
    getSession: vi.fn(),
    updateStatus: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    getMetadata: vi.fn(),
  } as unknown as SubsessionManager;
}

describe("createStatusTracker", () => {
  let tree: AgentTree;
  let subsessionManager: SubsessionManager;
  let mockSetStatus: ReturnType<typeof vi.fn>;
  let mockUi: { setStatus: typeof mockSetStatus; theme: typeof theme };

  beforeEach(() => {
    tree = new AgentTree();
    subsessionManager = createMockSubsessionManager();
    mockSetStatus = vi.fn();
    mockUi = { setStatus: mockSetStatus, theme };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not throw or update status before UI is set", () => {
    const tracker = createStatusTracker(tree, subsessionManager, createMockContext("/tmp"));

    expect(() => tracker.refresh()).not.toThrow();
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it("shows foreground running minion count and a lightweight hint", () => {
    const tracker = createStatusTracker(tree, subsessionManager, createMockContext("/tmp"));
    tracker.setUi(mockUi as any);

    tree.add("m1", "kevin", "task");
    tracker.refresh();

    const lastCall = mockSetStatus.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe(MINIONS_STATUS_KEY);
    expect(lastCall?.[1]).toContain("[oo] minions: 1");
    expect(lastCall?.[1]).toMatch(/\/minions|\/minions list|\/minions learn/);
  });

  it("rotates personalized foreground hints while minions are running", () => {
    const tracker = createStatusTracker(tree, subsessionManager, createMockContext("/tmp"));
    tracker.setUi(mockUi as any);

    tree.add("m1", "kevin", "task");
    tracker.refresh();

    let foundPersonalized = false;
    for (let i = 0; i < 8; i++) {
      const lastCall = mockSetStatus.mock.calls.at(-1);
      if (String(lastCall?.[1]).includes("kevin")) {
        foundPersonalized = true;
        break;
      }
      vi.advanceTimersByTime(4000);
    }

    expect(foundPersonalized).toBe(true);
  });

  it("clears status and stops rotation when no minions are running", () => {
    const tracker = createStatusTracker(tree, subsessionManager, createMockContext("/tmp"));
    tracker.setUi(mockUi as any);

    tree.add("m1", "kevin", "task");
    tracker.refresh();
    const callsBeforeComplete = mockSetStatus.mock.calls.length;

    tree.updateStatus("m1", "completed");
    tracker.refresh();
    vi.advanceTimersByTime(8000);

    expect(mockSetStatus).toHaveBeenCalledWith(MINIONS_STATUS_KEY, undefined);
    expect(mockSetStatus.mock.calls.length).toBe(callsBeforeComplete + 1);
  });

  it("uses the first static hint on initial refresh", () => {
    const ctx = createMockContext("/tmp");
    const tracker = createStatusTracker(tree, subsessionManager, ctx);
    tracker.setUi(mockUi as any);

    tree.add("m1", "kevin", "task");
    tracker.refresh();

    const lastCall = mockSetStatus.mock.calls.at(-1);
    expect(lastCall?.[1]).toBe("[oo] minions: 1  ·  /minions");
  });

  it("destroy stops hint rotation", () => {
    const tracker = createStatusTracker(tree, subsessionManager, createMockContext("/tmp"));
    tracker.setUi(mockUi as any);

    tree.add("m1", "kevin", "task");
    tracker.refresh();
    const callsBeforeDestroy = mockSetStatus.mock.calls.length;

    tracker.destroy();
    vi.advanceTimersByTime(8000);

    expect(mockSetStatus.mock.calls.length).toBe(callsBeforeDestroy);
  });
});
