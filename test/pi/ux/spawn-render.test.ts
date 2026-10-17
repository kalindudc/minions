import { describe, expect, it } from "vitest";
import { renderResult } from "../../../extensions/pi/render.js";
import { createTestHarness } from "../helpers/index.js";

describe("spawn rendering", () => {
  it("renders spawn tool progress", async () => {
    const harness = createTestHarness({ width: 120 });

    // Simulate spawn tool execution
    await harness.simulateToolCall("spawn", { tasks: [{ task: "test" }] });
    await harness.waitForRender(1);

    expect(harness.getLastFrame()).toMatchSnapshot("spawn-progress");
  });

  it("captures multiple renders in sequence", async () => {
    const harness = createTestHarness({ width: 120 });

    await harness.simulateToolCall("spawn", { tasks: [{ task: "first" }] });
    await harness.simulateToolCall("spawn", { tasks: [{ task: "second" }] });
    await harness.waitForRender(2);

    expect(harness.tui.renderLog).toHaveLength(2);
    expect(harness.getLastFrame()?.[0]).toContain("second");
  });

  it("tracks minion lifecycle through tree", async () => {
    const harness = createTestHarness({ width: 120 });

    await harness.simulateToolCall("spawn", { tasks: [{ task: "lifecycle test" }] });

    const running = harness.tree.getRunning();
    expect(running).toHaveLength(1);
    expect(running[0]?.name).toBe("spawn");
  });

  it("verifies subsession creation on tool call", async () => {
    const harness = createTestHarness({ width: 120 });

    await harness.simulateToolCall("spawn", { tasks: [{ task: "subsession test" }] });

    const sessions = harness.subsessionManager.list();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).toBe("running");
  });
});

describe("harness assertions", () => {
  it("can assert session state", async () => {
    const harness = createTestHarness({ width: 120 });

    await harness.simulateToolCall("spawn", { tasks: [{ task: "session test" }] });

    const sessions = harness.subsessionManager.list();
    const sessionId = sessions[0]?.sessionId;
    expect(sessionId).toBeDefined();

    harness.assertSessionSwitched(sessionId!);
  });
});

describe("MockTUI functionality", () => {
  it("captures render calls in log", () => {
    const harness = createTestHarness({ width: 80 });

    harness.tui.render(
      {
        constructor: { name: "TestComponent" },
        render: (w: number) => [`Line 1 ${w}`, `Line 2 ${w}`],
        invalidate: () => {},
      } as any,
      80,
    );

    expect(harness.tui.renderLog).toHaveLength(1);
    expect(harness.tui.renderLog[0]?.component).toBe("TestComponent");
    expect(harness.tui.renderLog[0]?.width).toBe(80);
  });

  it("finds frames matching predicate", () => {
    const harness = createTestHarness({ width: 80 });

    harness.tui.render(
      {
        constructor: { name: "MatchComponent" },
        render: () => ["target content here"],
        invalidate: () => {},
      } as any,
      80,
    );

    harness.tui.render(
      {
        constructor: { name: "NoMatchComponent" },
        render: () => ["other content"],
        invalidate: () => {},
      } as any,
      80,
    );

    const frames = harness.tui.findFrames((lines) => lines.some((l) => l.includes("target")));

    expect(frames).toHaveLength(1);
    expect(frames[0]?.[0]).toContain("target");
  });

  it("clears render log", () => {
    const harness = createTestHarness({ width: 80 });

    harness.tui.render(
      {
        constructor: { name: "Test" },
        render: () => ["test"],
        invalidate: () => {},
      } as any,
      80,
    );

    expect(harness.tui.renderLog).toHaveLength(1);
    harness.tui.clear();
    expect(harness.tui.renderLog).toHaveLength(0);
  });
});

describe("minion status widget", () => {
  // Minimal theme stub that returns text as-is (no ANSI codes)
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as any;

  it("renders running minion with spinner and activity", () => {
    const harness = createTestHarness({ width: 100 });

    const details = {
      id: "minion-123",
      name: "test-minion",
      agentName: "test-minion",
      task: "Analyze codebase",
      status: "running" as const,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        contextTokens: 0,
        turns: 0,
      },
      finalOutput: "",
      activity: "→ grep -r TODO src/",
      spinnerFrame: 0,
    };

    const text = renderResult(
      { content: [], details },
      { expanded: false, isPartial: true },
      theme,
      { isError: false },
    );

    harness.tui.render(text, 100);
    const frame = harness.getLastFrame();

    expect(frame).toBeDefined();
    expect(frame?.join("\n")).toContain("test-minion");
    expect(frame?.join("\n")).toContain("minion-123");
    expect(frame?.join("\n")).toContain("→ grep -r TODO src/");
    expect(frame?.join("\n")).toMatch(/\[o[-o]*\]|\[-+o?\]/); // new ASCII spinner pattern
  });

  it("renders completed minion with checkmark and usage", () => {
    const harness = createTestHarness({ width: 100 });

    const details = {
      id: "minion-456",
      name: "completed-minion",
      agentName: "completed-minion",
      task: "Run tests",
      status: "completed" as const,
      usage: {
        input: 1500,
        output: 300,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.0021,
        contextTokens: 1800,
        turns: 3,
      },
      finalOutput: "All tests passed!",
      spinnerFrame: 0,
    };

    const text = renderResult(
      { content: [], details },
      { expanded: false, isPartial: false },
      theme,
      { isError: false },
    );

    harness.tui.render(text, 100);
    const frame = harness.getLastFrame();

    expect(frame).toBeDefined();
    expect(frame?.join("\n")).toContain("✓");
    expect(frame?.join("\n")).toContain("completed-minion");
    expect(frame?.join("\n")).toContain("3 turns");
    expect(frame?.join("\n")).toContain("↑1.5k");
    expect(frame?.join("\n")).toContain("↓300");
  });

  it("renders failed minion with error indicator", () => {
    const harness = createTestHarness({ width: 100 });

    const details = {
      id: "minion-789",
      name: "failed-minion",
      agentName: "failed-minion",
      task: "Build project",
      status: "failed" as const,
      usage: {
        input: 500,
        output: 100,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.0005,
        contextTokens: 600,
        turns: 1,
      },
      finalOutput: "Error: Build failed",
      spinnerFrame: 0,
    };

    const text = renderResult(
      { content: [{ type: "text", text: "Error: Build failed" }], details },
      { expanded: false, isPartial: false },
      theme,
      { isError: true },
    );

    harness.tui.render(text, 100);
    const frame = harness.getLastFrame();

    expect(frame).toBeDefined();
    expect(frame?.join("\n")).toContain("✗");
    expect(frame?.join("\n")).toContain("failed-minion");
  });

  it("captures minion status progression through render log", () => {
    const harness = createTestHarness({ width: 100 });

    // Initial running state
    const runningDetails = {
      id: "minion-xyz",
      name: "progressive-minion",
      agentName: "progressive-minion",
      task: "Process data",
      status: "running" as const,
      usage: {
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.0001,
        contextTokens: 150,
        turns: 1,
      },
      finalOutput: "",
      activity: "Processing...",
      spinnerFrame: 2,
    };

    const runningText = renderResult(
      { content: [], details: runningDetails },
      { expanded: false, isPartial: true },
      theme,
      { isError: false },
    );

    harness.tui.render(runningText, 100);

    // Transition to completed state
    const completedDetails = {
      ...runningDetails,
      status: "completed" as const,
      finalOutput: "Data processed successfully!",
      usage: {
        input: 5000,
        output: 1200,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.008,
        contextTokens: 6200,
        turns: 8,
      },
    };

    const completedText = renderResult(
      { content: [], details: completedDetails },
      { expanded: false, isPartial: false },
      theme,
      { isError: false },
    );

    harness.tui.render(completedText, 100);

    // Verify progression captured
    expect(harness.tui.renderLog).toHaveLength(2);

    const firstFrame = harness.tui.renderLog[0]?.lines.join("\n");
    const secondFrame = harness.tui.renderLog[1]?.lines.join("\n");

    // Running state shows spinner, completed shows checkmark
    expect(firstFrame).toMatch(/\[o[-o]*\]|\[-+o?\]/); // new ASCII spinner pattern
    expect(secondFrame).toContain("✓");
    expect(secondFrame).toContain("8 turns");
    expect(secondFrame).toContain("↑5.0k");
  });

  it("renders expanded minion with output preview", () => {
    const harness = createTestHarness({ width: 100 });

    const details = {
      id: "minion-abc",
      name: "output-minion",
      agentName: "output-minion",
      task: "Generate report",
      status: "completed" as const,
      usage: {
        input: 200,
        output: 500,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.001,
        contextTokens: 700,
        turns: 2,
      },
      finalOutput: "Line 1\nLine 2\nLine 3",
      spinnerFrame: 0,
    };

    const text = renderResult(
      { content: [], details },
      { expanded: true, isPartial: false },
      theme,
      { isError: false },
    );

    harness.tui.render(text, 100);
    const frame = harness.getLastFrame();

    expect(frame).toBeDefined();
    expect(frame?.join("\n")).toContain("Line 1");
    expect(frame?.join("\n")).toContain("Line 2");
    expect(frame?.join("\n")).toContain("Line 3");
  });
});
