import { expect } from "vitest";
import { MockSubsessionManager } from "./mock-subsession.js";
import { MockAgentTree } from "./mock-tree.js";
import { MockTUI } from "./mock-tui.js";

export interface HarnessOptions {
  cwd?: string;
  width?: number;
  minions?: string[];
}

export class TestHarness {
  tui: MockTUI;
  tree: MockAgentTree;
  subsessionManager: MockSubsessionManager;
  cwd: string;
  width: number;

  constructor(options?: HarnessOptions) {
    this.cwd = options?.cwd ?? "/mock/cwd";
    this.width = options?.width ?? 120;
    this.tui = new MockTUI();
    this.tree = new MockAgentTree();
    this.subsessionManager = new MockSubsessionManager();
  }

  async sendInput(text: string): Promise<void> {
    // Simulate sending input to the session
    await this.subsessionManager.getSession(this.tree.getRunning()[0]?.id ?? "")?.steer(text);
  }

  async waitForRender(count?: number, timeout?: number): Promise<void> {
    const targetCount = count ?? 1;
    const maxWait = timeout ?? 1000;
    const startTime = Date.now();

    while (this.tui.renderLog.length < targetCount) {
      if (Date.now() - startTime > maxWait) {
        throw new Error(`Timeout waiting for ${targetCount} renders`);
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  getLastFrame(): string[] | undefined {
    return this.tui.getLastFrame();
  }

  // Assertions
  assertSnapshot(name: string): void {
    const frame = this.getLastFrame();
    expect(frame).toMatchSnapshot(name);
  }

  assertSessionSwitched(toSessionId: string): void {
    const metadata = this.subsessionManager.getMetadata(toSessionId);
    expect(metadata).toBeDefined();
    expect(metadata?.status).toBe("running");
  }

  // Tool simulation helpers
  async simulateToolCall(toolName: string, args: Record<string, unknown>): Promise<void> {
    // Create a mock minion for this tool call
    const id = `mock-${toolName}-${Date.now()}`;
    this.tree.add(id, toolName, JSON.stringify(args));

    // Create a subsession for this minion
    await this.subsessionManager.create({
      id,
      name: toolName,
      task: JSON.stringify(args),
      config: {
        name: toolName,
        description: `Mock ${toolName} agent`,
        systemPrompt: "You are a test agent.",
        source: "ephemeral",
        filePath: "/mock/path",
      },
      spawnedBy: "test",
      cwd: this.cwd,
      modelRegistry: {} as any,
    });

    // Emit some render activity
    this.tui.render(
      {
        constructor: { name: "ToolCallRenderer" },
        render: (w: number) => [`[${toolName}] Called with: ${JSON.stringify(args)}`.slice(0, w)],
        invalidate: () => {},
      } as any,
      this.width,
    );
  }
}
