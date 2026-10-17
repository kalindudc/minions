import { describe, expect, it } from "vitest";
import type {
  CreateMinionSessionOptions,
  MinionSessionHandle,
  MinionSessionMetadata,
} from "../../../extensions/pi/subsessions/types.js";
import type { AgentConfig } from "../../../src/types.js";

describe("MinionSessionMetadata type", () => {
  it("should accept valid metadata objects", () => {
    const metadata: MinionSessionMetadata = {
      sessionId: "test-id",
      parentSession: "/tmp/parent.jsonl",
      spawnedBy: "tool-call-1",
      name: "test-minion",
      task: "do something",
      agent: "scout",
      createdAt: Date.now(),
      status: "running",
    };

    expect(metadata.sessionId).toBe("test-id");
    expect(metadata.status).toBe("running");
  });

  it("should accept optional exitCode and error", () => {
    const metadata: MinionSessionMetadata = {
      sessionId: "test-id",
      parentSession: "/tmp/parent.jsonl",
      spawnedBy: "tool-call-1",
      name: "test-minion",
      task: "do something",
      createdAt: Date.now(),
      status: "completed",
      exitCode: 0,
      error: undefined,
    };

    expect(metadata.exitCode).toBe(0);
  });
});

describe("MinionSessionHandle type", () => {
  it("should have required properties", () => {
    const handle: MinionSessionHandle = {
      id: "test-id",
      path: "/tmp/session.jsonl",
      steer: async () => {},
      abort: () => {},
    };

    expect(handle.id).toBe("test-id");
    expect(handle.path).toBe("/tmp/session.jsonl");
    expect(typeof handle.steer).toBe("function");
    expect(typeof handle.abort).toBe("function");
  });
});

describe("CreateMinionSessionOptions type", () => {
  it("should accept all required options", () => {
    const config: AgentConfig = {
      name: "test",
      description: "Test agent",
      systemPrompt: "You are a test agent.",
      source: "ephemeral",
      filePath: "/tmp/test.md",
    };

    const options: CreateMinionSessionOptions = {
      id: "test-id",
      name: "test-minion",
      task: "do something",
      config,
      spawnedBy: "tool-call-1",
      cwd: "/tmp",
      modelRegistry: {} as any,
      parentModel: undefined,
      parentSystemPrompt: "custom prompt",
      signal: undefined,
      onToolActivity: () => {},
      onToolOutput: () => {},
      onTextDelta: () => {},
      onTurnEnd: () => {},
      onComplete: () => {},
    };

    expect(options.id).toBe("test-id");
    expect(options.config).toBe(config);
    expect(options.onComplete).toBeDefined();
  });
});
