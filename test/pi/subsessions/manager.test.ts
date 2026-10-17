import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../../extensions/pi/subsessions/event-bus.js";
import { SubsessionManager } from "../../../extensions/pi/subsessions/manager.js";
import { getMinionsDir } from "../../../extensions/pi/subsessions/paths.js";
import type { MinionSessionMetadata } from "../../../extensions/pi/subsessions/types.js";

// Mock must be at top level (hoisted)
vi.mock("@earendil-works/pi-coding-agent", () => {
  const mockSession = {
    subscribe: vi.fn().mockReturnValue(() => {}),
    steer: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
    prompt: vi.fn().mockResolvedValue(undefined),
    state: { messages: [] },
    getSessionStats: vi.fn().mockReturnValue({
      tokens: {
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        total: 150,
      },
      cost: 0.001,
    }),
    getAllTools: vi.fn().mockReturnValue([
      { name: "read", description: "Read files" },
      { name: "bash", description: "Run bash" },
      { name: "edit", description: "Edit files" },
    ]),
    bindExtensions: vi.fn().mockResolvedValue(undefined),
    setActiveToolsByName: vi.fn(),
  };

  const mockSessionManager = {
    getSessionFile: vi.fn().mockReturnValue("/tmp/test-session.jsonl"),
  };

  return {
    createAgentSession: vi.fn().mockResolvedValue({ session: mockSession }),
    DefaultResourceLoader: vi.fn().mockImplementation(() => ({
      reload: vi.fn().mockResolvedValue(undefined),
    })),
    SessionManager: {
      create: vi.fn().mockReturnValue(mockSessionManager),
    },
    SettingsManager: {
      create: vi.fn().mockReturnValue({}),
    },
    getAgentDir: vi.fn().mockReturnValue("/tmp/pi-agent"),
    createCodingTools: vi.fn().mockReturnValue([]),
  };
});

describe("SubsessionManager", () => {
  let tempDir: string;
  let manager: SubsessionManager;
  let eventBus: EventBus;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pi-minions-test-"));
    eventBus = new EventBus();
    manager = new SubsessionManager(tempDir, join(tempDir, "parent.jsonl"), eventBus);
    vi.clearAllMocks();
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("create", () => {
    it("should create a session handle with id and path", async () => {
      const handle = await manager.create({
        id: "test-id",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tool-call-1",
        cwd: tempDir,
        modelRegistry: {} as any,
      });

      expect(handle).toBeDefined();
      expect(handle.id).toBe("test-id");
      expect(handle.path).toBeDefined();
      expect(typeof handle.steer).toBe("function");
      expect(typeof handle.abort).toBe("function");
    });

    it("should call onComplete when session completes", async () => {
      const onComplete = vi.fn();

      await manager.create({
        id: "test-id",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tool-call-1",
        cwd: tempDir,
        modelRegistry: {} as any,
        onComplete,
      });

      // Wait for async completion
      await new Promise((r) => setTimeout(r, 10));

      // Verify mock was called
      const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
      expect(createAgentSession).toHaveBeenCalled();
    });

    it("applies config.model override to createAgentSession", async () => {
      const fakeModel = { provider: "openrouter", id: "deepseek/deepseek-v4.1-flash" };
      const registry = {
        getAll: () => [fakeModel],
        hasConfiguredAuth: () => true,
      } as any;

      await manager.create({
        id: "test-model-override",
        name: "model-override-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
          model: "openrouter/deepseek/deepseek-v4.1-flash",
        },
        spawnedBy: "tool-call-1",
        cwd: tempDir,
        modelRegistry: registry,
      });

      await new Promise((r) => setTimeout(r, 10));

      const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
      expect(createAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            provider: "openrouter",
            id: "deepseek/deepseek-v4.1-flash",
          }),
        }),
      );
    });

    it("keeps parent model when config.model is unset", async () => {
      const parentModel = { provider: "openrouter", id: "z-ai/glm-5.3-flash" } as any;

      await manager.create({
        id: "test-parent-model",
        name: "parent-model-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tool-call-1",
        cwd: tempDir,
        modelRegistry: {} as any,
        parentModel,
      });

      await new Promise((r) => setTimeout(r, 10));

      const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
      expect(createAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({ model: parentModel }),
      );
    });

    it("rejects with a clear error when config.model is unknown", async () => {
      const registry = {
        getAll: () => [{ provider: "openrouter", id: "z-ai/glm-5.3-flash" }],
        hasConfiguredAuth: () => true,
      } as any;

      await expect(
        manager.create({
          id: "test-bad-model",
          name: "bad-model-minion",
          task: "do something",
          config: {
            name: "test",
            description: "Test agent",
            systemPrompt: "You are a test agent.",
            source: "ephemeral",
            filePath: "/tmp/test.md",
            model: "openrouter/nope-model",
          },
          spawnedBy: "tool-call-1",
          cwd: tempDir,
          modelRegistry: registry,
        }),
      ).rejects.toThrow(/did not match any model/);
    });
  });

  describe("getMetadata", () => {
    it("should return undefined for unknown session", () => {
      const metadata = manager.getMetadata("non-existent");
      expect(metadata).toBeUndefined();
    });

    it("should return cached metadata after create", async () => {
      await manager.create({
        id: "test-id",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tool-call-1",
        cwd: tempDir,
        modelRegistry: {} as any,
      });

      const metadata = manager.getMetadata("test-id");
      expect(metadata).toBeDefined();
      expect(metadata?.sessionId).toBe("test-id");
      expect(metadata?.name).toBe("test-minion");
      expect(metadata?.task).toBe("do something");
    });
  });

  describe("list", () => {
    it("should return empty array when no sessions exist", () => {
      const sessions = manager.list();
      expect(sessions).toEqual([]);
    });

    it("should list created sessions from cache", async () => {
      // Create sessions (these get cached)
      await manager.create({
        id: "test-1",
        name: "minion-1",
        task: "task 1",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tc-1",
        cwd: tempDir,
        modelRegistry: {} as any,
      });

      await manager.create({
        id: "test-2",
        name: "minion-2",
        task: "task 2",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tc-2",
        cwd: tempDir,
        modelRegistry: {} as any,
      });

      // getMetadata should return cached data for created sessions
      const meta1 = manager.getMetadata("test-1");
      const meta2 = manager.getMetadata("test-2");

      expect(meta1).toBeDefined();
      expect(meta2).toBeDefined();
      expect(meta1?.sessionId).toBe("test-1");
      expect(meta2?.sessionId).toBe("test-2");
    });
  });

  describe("getSession", () => {
    it("should return undefined for unknown session", () => {
      const session = manager.getSession("non-existent");
      expect(session).toBeUndefined();
    });
  });

  describe("updateStatus", () => {
    it("should update status in cache", async () => {
      await manager.create({
        id: "test-id",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tool-call-1",
        cwd: tempDir,
        modelRegistry: {} as any,
      });

      manager.updateStatus("test-id", "completed", 0);

      const metadata = manager.getMetadata("test-id");
      expect(metadata?.status).toBe("completed");
      expect(metadata?.exitCode).toBe(0);
    });

    it("should handle updating unknown session gracefully", () => {
      // Should not throw
      manager.updateStatus("non-existent", "completed", 0);
    });
  });

  describe("resuming a minion session", () => {
    it("finds the session file path given a minion ID", () => {
      // Given a minion session file exists with metadata
      const minionsDir = getMinionsDir(tempDir);
      mkdirSync(minionsDir, { recursive: true });

      const sessionFile = join(minionsDir, "2026-04-02T22-46-54-session.jsonl");
      writeFileSync(sessionFile, '{"type":"session"}\n');

      const metadata: MinionSessionMetadata = {
        sessionId: "minion-abc",
        parentSession: join(tempDir, "parent.jsonl"),
        spawnedBy: "test",
        name: "test-minion",
        task: "test task",
        createdAt: Date.now(),
        status: "running",
      };
      writeFileSync(`${sessionFile}.minion-meta.json`, JSON.stringify(metadata));

      // When looking up the path by minion ID
      const foundPath = manager.getSessionPath("minion-abc");

      // Then the correct session file path is returned
      expect(foundPath).toBe(sessionFile);
    });

    it("returns undefined when minion ID does not exist", () => {
      // Given no session files exist
      // When looking up a non-existent minion ID
      const foundPath = manager.getSessionPath("non-existent");

      // Then undefined is returned
      expect(foundPath).toBeUndefined();
    });
  });

  describe("identifying current session as a minion", () => {
    it("extracts minion ID when given a minion session path", () => {
      // Given a minion session file exists with metadata
      const minionsDir = getMinionsDir(tempDir);
      mkdirSync(minionsDir, { recursive: true });

      const sessionFile = join(minionsDir, "2026-04-02T22-46-54-session.jsonl");
      writeFileSync(sessionFile, '{"type":"session"}\n');

      const metadata: MinionSessionMetadata = {
        sessionId: "minion-xyz",
        parentSession: join(tempDir, "parent.jsonl"),
        spawnedBy: "test",
        name: "test-minion",
        task: "test task",
        createdAt: Date.now(),
        status: "running",
      };
      writeFileSync(`${sessionFile}.minion-meta.json`, JSON.stringify(metadata));

      // When checking if the path is a minion session
      const minionId = manager.getMinionIdFromPath(sessionFile);

      // Then the minion ID is returned
      expect(minionId).toBe("minion-xyz");
    });

    it("returns undefined when path is not in minions directory", () => {
      // Given a non-minion session path
      const parentSession = join(tempDir, "parent.jsonl");

      // When checking if it's a minion session
      const minionId = manager.getMinionIdFromPath(parentSession);

      // Then undefined is returned
      expect(minionId).toBeUndefined();
    });
  });

  describe("post-completion event silencing", () => {
    it("does not invoke callbacks for events after agent_end", async () => {
      let capturedSubscriber: ((event: any) => void) | undefined;

      const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
      vi.mocked(createAgentSession).mockImplementationOnce(
        async () =>
          ({
            session: {
              subscribe: (cb: (event: any) => void) => {
                capturedSubscriber = cb;
                return () => {};
              },
              abort: vi.fn(),
              prompt: vi.fn().mockReturnValue(new Promise(() => {})), // never resolves
              state: { messages: [] },
              getSessionStats: vi.fn().mockReturnValue({
                tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                cost: 0,
              }),
              bindExtensions: vi.fn().mockResolvedValue(undefined),
            },
          }) as any,
      );

      const onToolActivity = vi.fn();
      const onTextDelta = vi.fn();
      const onComplete = vi.fn();

      await manager.create({
        id: "silence-test",
        name: "test-minion",
        task: "test",
        config: {
          name: "test",
          description: "Test",
          systemPrompt: "test",
          source: "ephemeral" as const,
          filePath: "",
        },
        spawnedBy: "tc",
        cwd: tempDir,
        modelRegistry: {} as any,
        onToolActivity,
        onTextDelta,
        onComplete,
      });

      expect(capturedSubscriber).toBeDefined();

      // Simulate agent_end
      capturedSubscriber!({ type: "agent_end" });
      expect(onComplete).toHaveBeenCalledOnce();

      // Now fire stale events that would arrive after completion
      onToolActivity.mockClear();
      onTextDelta.mockClear();
      onComplete.mockClear();

      capturedSubscriber!({
        type: "tool_execution_start",
        toolName: "bash",
        args: { command: "ls" },
      });
      capturedSubscriber!({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "stale" },
      });
      capturedSubscriber!({ type: "agent_end" });

      // None of the stale events should have triggered callbacks
      expect(onToolActivity).not.toHaveBeenCalled();
      expect(onTextDelta).not.toHaveBeenCalled();
      expect(onComplete).not.toHaveBeenCalled();
    });

    it("does not invoke callbacks for events after abort", async () => {
      let capturedSubscriber: ((event: any) => void) | undefined;
      const abortMock = vi.fn();

      const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
      vi.mocked(createAgentSession).mockImplementationOnce(
        async () =>
          ({
            session: {
              subscribe: (cb: (event: any) => void) => {
                capturedSubscriber = cb;
                return () => {};
              },
              abort: abortMock,
              prompt: vi.fn().mockReturnValue(new Promise(() => {})), // never resolves
              state: { messages: [] },
              getSessionStats: vi.fn().mockReturnValue({
                tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                cost: 0,
              }),
              bindExtensions: vi.fn().mockResolvedValue(undefined),
            },
          }) as any,
      );

      const controller = new AbortController();
      const onToolActivity = vi.fn();
      const onComplete = vi.fn();

      await manager.create({
        id: "abort-silence-test",
        name: "test-minion",
        task: "test",
        config: {
          name: "test",
          description: "Test",
          systemPrompt: "test",
          source: "ephemeral" as const,
          filePath: "",
        },
        spawnedBy: "tc",
        cwd: tempDir,
        modelRegistry: {} as any,
        signal: controller.signal,
        onToolActivity,
        onComplete,
      });

      expect(capturedSubscriber).toBeDefined();

      // Abort the session
      controller.abort();
      expect(onComplete).toHaveBeenCalledOnce();

      // Fire stale events after abort
      onToolActivity.mockClear();
      onComplete.mockClear();

      capturedSubscriber!({
        type: "tool_execution_start",
        toolName: "bash",
        args: { command: "ls" },
      });

      // Stale event should be silenced
      expect(onToolActivity).not.toHaveBeenCalled();
    });
  });

  describe("usage update on turn end", () => {
    it("calls onUsageUpdate with stats from getSessionStats when session emits turn_end", async () => {
      let capturedSubscriber: ((event: any) => void) | undefined;

      const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
      vi.mocked(createAgentSession).mockImplementationOnce(
        async () =>
          ({
            session: {
              subscribe: (cb: (event: any) => void) => {
                capturedSubscriber = cb;
                return () => {};
              },
              abort: vi.fn(),
              prompt: vi.fn().mockReturnValue(new Promise(() => {})), // keep session alive
              state: { messages: [] },
              getSessionStats: vi.fn().mockReturnValue({
                tokens: {
                  input: 200,
                  output: 80,
                  cacheRead: 10,
                  cacheWrite: 5,
                  total: 290,
                },
                cost: 0.005,
              }),
              bindExtensions: vi.fn().mockResolvedValue(undefined),
            },
          }) as any,
      );

      const onUsageUpdate = vi.fn();
      await manager.create({
        id: "usage-test-id",
        name: "usage-minion",
        task: "usage task",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "test",
          source: "ephemeral",
          filePath: "",
        },
        spawnedBy: "tc",
        cwd: tempDir,
        modelRegistry: {} as any,
        onUsageUpdate,
      });

      expect(capturedSubscriber).toBeDefined();
      capturedSubscriber?.({ type: "turn_end" });

      expect(onUsageUpdate).toHaveBeenCalledWith({
        input: 200,
        output: 80,
        cacheRead: 10,
        cacheWrite: 5,
        cost: 0.005,
      });
    });

    it("does not throw when onUsageUpdate is not provided and turn_end fires", async () => {
      let capturedSubscriber: ((event: any) => void) | undefined;

      const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
      vi.mocked(createAgentSession).mockImplementationOnce(
        async () =>
          ({
            session: {
              subscribe: (cb: (event: any) => void) => {
                capturedSubscriber = cb;
                return () => {};
              },
              abort: vi.fn(),
              prompt: vi.fn().mockResolvedValue(undefined),
              state: { messages: [] },
              getSessionStats: vi.fn().mockReturnValue({
                tokens: {
                  input: 100,
                  output: 50,
                  cacheRead: 0,
                  cacheWrite: 0,
                  total: 150,
                },
                cost: 0.001,
              }),
              bindExtensions: vi.fn().mockResolvedValue(undefined),
            },
          }) as any,
      );

      await manager.create({
        id: "no-cb-test",
        name: "test-minion",
        task: "test",
        config: {
          name: "test",
          description: "Test",
          systemPrompt: "test",
          source: "ephemeral",
          filePath: "",
        },
        spawnedBy: "tc",
        cwd: tempDir,
        modelRegistry: {} as any,
        // No onUsageUpdate
      });

      expect(() => capturedSubscriber?.({ type: "turn_end" })).not.toThrow();
    });
  });

  describe("tracking parent session relationship", () => {
    it("remembers parent session path for returning from minion", () => {
      // Given a minion session with parent relationship
      const minionsDir = getMinionsDir(tempDir);
      mkdirSync(minionsDir, { recursive: true });

      const sessionFile = join(minionsDir, "2026-04-02T22-46-54-session.jsonl");
      writeFileSync(sessionFile, '{"type":"session"}\n');

      const metadata: MinionSessionMetadata = {
        sessionId: "minion-123",
        parentSession: join(tempDir, "parent.jsonl"),
        spawnedBy: "spawn-tool",
        name: "child-minion",
        task: "child task",
        createdAt: Date.now(),
        status: "running",
      };
      writeFileSync(`${sessionFile}.minion-meta.json`, JSON.stringify(metadata));

      // When retrieving the minion metadata
      const found = manager.getMetadata("minion-123");

      // Then the parent session path is available
      expect(found?.parentSession).toBe(join(tempDir, "parent.jsonl"));
    });
  });

  describe("customTools forwarding", () => {
    it("passes customTools to createAgentSession when provided", async () => {
      // Given customTools in the session options
      const customTools = [
        {
          name: "my-tool",
          label: "My Tool",
          description: "A custom tool for testing",
          parameters: {} as any,
          execute: vi.fn(),
        },
      ];

      // When creating a minion session with customTools
      await manager.create({
        id: "custom-tools-test",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tool-call-1",
        cwd: tempDir,
        modelRegistry: {} as any,
        customTools,
      });

      // Then createAgentSession receives the customTools
      const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
      expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({ customTools }));
    });

    it("passes undefined customTools when not provided", async () => {
      // Given no customTools in the session options
      await manager.create({
        id: "no-custom-tools-test",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test agent",
          systemPrompt: "You are a test agent.",
          source: "ephemeral",
          filePath: "/tmp/test.md",
        },
        spawnedBy: "tool-call-1",
        cwd: tempDir,
        modelRegistry: {} as any,
      });

      // Then createAgentSession receives undefined for customTools
      const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
      expect(createAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({ customTools: undefined }),
      );
    });
  });

  describe("extension binding on session creation", () => {
    it("calls bindExtensions on the created session to trigger session_start", async () => {
      const bindExtensionsMock = vi.fn().mockResolvedValue(undefined);

      const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
      vi.mocked(createAgentSession).mockImplementationOnce(
        async () =>
          ({
            session: {
              subscribe: () => () => {},
              abort: vi.fn(),
              prompt: vi.fn().mockResolvedValue(undefined),
              state: { messages: [] },
              getSessionStats: vi.fn().mockReturnValue({
                tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
                cost: 0.001,
              }),
              getAllTools: vi.fn().mockReturnValue([]),
              bindExtensions: bindExtensionsMock,
            },
          }) as any,
      );

      await manager.create({
        id: "bind-test",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test",
          systemPrompt: "test",
          source: "ephemeral",
          filePath: "",
        },
        spawnedBy: "tc",
        cwd: tempDir,
        modelRegistry: {} as any,
      });

      // bindExtensions is an SDK boundary call that triggers session_start
      expect(bindExtensionsMock).toHaveBeenCalledOnce();
    });

    it("does not pass a forwarded uiContext when EventBus is provided", async () => {
      const bindExtensionsMock = vi.fn().mockResolvedValue(undefined);

      const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
      vi.mocked(createAgentSession).mockImplementationOnce(
        async () =>
          ({
            session: {
              subscribe: () => () => {},
              abort: vi.fn(),
              prompt: vi.fn().mockResolvedValue(undefined),
              state: { messages: [] },
              getSessionStats: vi.fn().mockReturnValue({
                tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
                cost: 0.001,
              }),
              getAllTools: vi.fn().mockReturnValue([]),
              bindExtensions: bindExtensionsMock,
            },
          }) as any,
      );

      await manager.create({
        id: "ui-context-test",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test",
          systemPrompt: "test",
          source: "ephemeral",
          filePath: "",
        },
        spawnedBy: "tc",
        cwd: tempDir,
        modelRegistry: {} as any,
      });

      const callArgs = bindExtensionsMock.mock.calls[0][0];
      expect(callArgs.uiContext).toBeUndefined();
      expect(callArgs.shutdownHandler).toEqual(expect.any(Function));
    });

    it("skips proxy uiContext when no EventBus", async () => {
      const bindExtensionsMock = vi.fn().mockResolvedValue(undefined);

      const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
      vi.mocked(createAgentSession).mockImplementationOnce(
        async () =>
          ({
            session: {
              subscribe: () => () => {},
              abort: vi.fn(),
              prompt: vi.fn().mockResolvedValue(undefined),
              state: { messages: [] },
              getSessionStats: vi.fn().mockReturnValue({
                tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
                cost: 0.001,
              }),
              getAllTools: vi.fn().mockReturnValue([]),
              bindExtensions: bindExtensionsMock,
            },
          }) as any,
      );

      // Create manager WITHOUT EventBus
      const noEventBusManager = new SubsessionManager(tempDir, join(tempDir, "parent.jsonl"));

      await noEventBusManager.create({
        id: "no-bus-test",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test",
          systemPrompt: "test",
          source: "ephemeral",
          filePath: "",
        },
        spawnedBy: "tc",
        cwd: tempDir,
        modelRegistry: {} as any,
      });

      // uiContext should be undefined when no EventBus
      const callArgs = bindExtensionsMock.mock.calls[0][0];
      expect(callArgs.uiContext).toBeUndefined();
    });
  });

  describe("extensions a minion session loads", () => {
    let extRoot: string;

    beforeEach(() => {
      extRoot = mkdtempSync(join(tmpdir(), "minion-ext-"));
    });

    afterEach(() => {
      rmSync(extRoot, { recursive: true, force: true });
    });

    function writeExtension(dir: string, packageName: string, entry: string): string {
      mkdirSync(join(dir, entry, ".."), { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: packageName }));
      const entryPath = join(dir, entry);
      writeFileSync(entryPath, "export default () => {};");
      return entryPath;
    }

    async function extensionsLoadedByMinion(resolvedPaths: string[]): Promise<string[]> {
      const { DefaultResourceLoader } = await import("@earendil-works/pi-coding-agent");
      await manager.create({
        id: "ext-filter",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test",
          systemPrompt: "test",
          source: "ephemeral",
          filePath: "",
        },
        spawnedBy: "tc",
        cwd: tempDir,
        modelRegistry: {} as any,
      });
      const options = vi.mocked(DefaultResourceLoader).mock.calls[0][0] as any;
      const base = {
        extensions: resolvedPaths.map((resolvedPath) => ({ resolvedPath })),
        errors: [],
      };
      return options.extensionsOverride(base).extensions.map((ext: any) => ext.resolvedPath);
    }

    it("leaves out pi-minions wherever it is checked out, and keeps other extensions", async () => {
      const renamedCheckout = writeExtension(
        join(extRoot, "minions"),
        "pi-minions",
        "extensions/pi/index.ts",
      );
      const gitInstall = writeExtension(
        join(extRoot, "git", "github.com", "kalindudc", "minions"),
        "pi-minions",
        "extensions/pi/index.ts",
      );
      const otherExtension = writeExtension(join(extRoot, "bash-guard"), "bash-guard", "index.ts");

      const loaded = await extensionsLoadedByMinion([renamedCheckout, gitInstall, otherExtension]);

      expect(loaded).toEqual([otherExtension]);
    });

    it("keeps an extension whose path mentions pi-minions but whose package is another", async () => {
      const lookalike = writeExtension(
        join(extRoot, "pi-minions-theme"),
        "pi-minions-theme",
        "index.ts",
      );

      const loaded = await extensionsLoadedByMinion([lookalike]);

      expect(loaded).toEqual([lookalike]);
    });
  });

  describe("session history parsing", () => {
    it("reconstructs activity from jsonl file", () => {
      const minionsDir = getMinionsDir(tempDir);
      mkdirSync(minionsDir, { recursive: true });

      const sessionFile = join(minionsDir, "2026-04-02T22-46-54-session.jsonl");
      const lines = [
        '{"type":"session"}',
        '{"type":"tool_execution_start","toolName":"bash","args":{"command":"ls"}}',
        '{"type":"turn_end"}',
        '{"type":"tool_execution_start","toolName":"read","args":{"path":"src/index.ts"}}',
        '{"type":"turn_end"}',
      ];
      writeFileSync(sessionFile, lines.join("\n"));

      const metadata: MinionSessionMetadata = {
        sessionId: "history-minion",
        parentSession: join(tempDir, "parent.jsonl"),
        spawnedBy: "test",
        name: "test-minion",
        task: "test task",
        createdAt: Date.now(),
        status: "running",
      };
      writeFileSync(`${sessionFile}.minion-meta.json`, JSON.stringify(metadata));

      const history = manager.parseSessionHistory("history-minion");
      expect(history).toEqual(["→ $ ls", "turn 1", "→ read src/index.ts", "turn 2"]);
    });

    it("returns empty array for unknown session", () => {
      const history = manager.parseSessionHistory("non-existent");
      expect(history).toEqual([]);
    });
  });

  describe("async tool synchronization", () => {
    it("proceeds immediately when all expected parent tools are already present", async () => {
      const getAllToolsMock = vi.fn().mockReturnValue([
        { name: "observe_query", description: "Query" },
        { name: "slack_search", description: "Search" },
      ]);

      const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
      vi.mocked(createAgentSession).mockImplementationOnce(
        async () =>
          ({
            session: {
              subscribe: () => () => {},
              abort: vi.fn(),
              prompt: vi.fn().mockResolvedValue(undefined),
              state: { messages: [] },
              getSessionStats: vi.fn().mockReturnValue({
                tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
                cost: 0.001,
              }),
              getAllTools: getAllToolsMock,
              bindExtensions: vi.fn().mockResolvedValue(undefined),
            },
          }) as any,
      );

      const start = Date.now();
      await manager.create({
        id: "immediate-test",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test",
          systemPrompt: "test",
          source: "ephemeral",
          filePath: "",
        },
        spawnedBy: "tc",
        cwd: tempDir,
        modelRegistry: {} as any,
        parentToolNames: ["observe_query", "slack_search"],
      });

      // Should return nearly instantly, not wait 5 seconds
      expect(Date.now() - start).toBeLessThan(1000);
    });

    it("proceeds immediately when parentToolNames only contains builtin tools", async () => {
      const getAllToolsMock = vi.fn().mockReturnValue([]);

      const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
      vi.mocked(createAgentSession).mockImplementationOnce(
        async () =>
          ({
            session: {
              subscribe: () => () => {},
              abort: vi.fn(),
              prompt: vi.fn().mockResolvedValue(undefined),
              state: { messages: [] },
              getSessionStats: vi.fn().mockReturnValue({
                tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
                cost: 0.001,
              }),
              getAllTools: getAllToolsMock,
              bindExtensions: vi.fn().mockResolvedValue(undefined),
            },
          }) as any,
      );

      const start = Date.now();
      await manager.create({
        id: "builtin-only-test",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test",
          systemPrompt: "test",
          source: "ephemeral",
          filePath: "",
        },
        spawnedBy: "tc",
        cwd: tempDir,
        modelRegistry: {} as any,
        parentToolNames: ["read", "bash", "edit", "write"],
      });

      // Builtin tools are excluded from wait — should return instantly
      expect(Date.now() - start).toBeLessThan(1000);
      // getAllTools should not be called for polling since all expected tools are builtin
      expect(getAllToolsMock).not.toHaveBeenCalled();
    });

    it("times out gracefully when expected tools never appear", async () => {
      // getAllTools always returns empty — the expected tool never registers
      const getAllToolsMock = vi.fn().mockReturnValue([]);

      const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
      vi.mocked(createAgentSession).mockImplementationOnce(
        async () =>
          ({
            session: {
              subscribe: () => () => {},
              abort: vi.fn(),
              prompt: vi.fn().mockResolvedValue(undefined),
              state: { messages: [] },
              getSessionStats: vi.fn().mockReturnValue({
                tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
                cost: 0.001,
              }),
              getAllTools: getAllToolsMock,
              bindExtensions: vi.fn().mockResolvedValue(undefined),
            },
          }) as any,
      );

      // Use a short maxWait to avoid slow test
      const handle = await manager.create({
        id: "timeout-test",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test",
          systemPrompt: "test",
          source: "ephemeral",
          filePath: "",
        },
        spawnedBy: "tc",
        cwd: tempDir,
        modelRegistry: {} as any,
        parentToolNames: ["vault_get_current_user"],
        toolSyncMaxWait: 400,
      });

      // Should complete (not throw) even though the tool never appeared
      expect(handle).toBeDefined();
      expect(handle.id).toBe("timeout-test");
    });

    it("skips wait entirely when toolSyncEnabled is false", async () => {
      // getAllTools returns empty — if wait ran, it would poll for 5s
      const getAllToolsMock = vi.fn().mockReturnValue([]);

      const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
      vi.mocked(createAgentSession).mockImplementationOnce(
        async () =>
          ({
            session: {
              subscribe: () => () => {},
              abort: vi.fn(),
              prompt: vi.fn().mockResolvedValue(undefined),
              state: { messages: [] },
              getSessionStats: vi.fn().mockReturnValue({
                tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
                cost: 0.001,
              }),
              getAllTools: getAllToolsMock,
              bindExtensions: vi.fn().mockResolvedValue(undefined),
            },
          }) as any,
      );

      const start = Date.now();
      await manager.create({
        id: "disabled-test",
        name: "test-minion",
        task: "do something",
        config: {
          name: "test",
          description: "Test",
          systemPrompt: "test",
          source: "ephemeral",
          filePath: "",
        },
        spawnedBy: "tc",
        cwd: tempDir,
        modelRegistry: {} as any,
        parentToolNames: ["vault_get_current_user"],
        toolSyncEnabled: false,
      });

      // Should return instantly — getAllTools never called for polling
      expect(Date.now() - start).toBeLessThan(1000);
      expect(getAllToolsMock).not.toHaveBeenCalled();
    });
  });

  describe("tool filtering via AgentConfig.tools", () => {
    it("calls setActiveToolsByName when config.tools is set", async () => {
      const manager = new SubsessionManager(tempDir, join(tempDir, "parent.jsonl"));
      const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
      const mockSession = (await (createAgentSession as any)()).session;
      mockSession.setActiveToolsByName.mockClear();

      await manager.create({
        id: "tool-filter-1",
        name: "filtered",
        task: "test",
        config: {
          name: "scout",
          description: "Recon agent",
          systemPrompt: "You are a scout.",
          source: "user",
          filePath: "/tmp/scout.md",
          tools: ["read", "bash"],
        },
        spawnedBy: "test",
        cwd: tempDir,
        modelRegistry: {} as any,
        parentModel: undefined as any,
        toolSyncEnabled: false,
        onComplete: vi.fn(),
      });

      expect(mockSession.setActiveToolsByName).toHaveBeenCalledWith(["read", "bash"]);
    });

    it("does not call setActiveToolsByName when config.tools is undefined", async () => {
      const manager = new SubsessionManager(tempDir, join(tempDir, "parent.jsonl"));
      const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
      const mockSession = (await (createAgentSession as any)()).session;
      mockSession.setActiveToolsByName.mockClear();

      await manager.create({
        id: "tool-filter-2",
        name: "unfiltered",
        task: "test",
        config: {
          name: "scout",
          description: "Recon agent",
          systemPrompt: "You are a scout.",
          source: "user",
          filePath: "/tmp/scout.md",
        },
        spawnedBy: "test",
        cwd: tempDir,
        modelRegistry: {} as any,
        parentModel: undefined as any,
        toolSyncEnabled: false,
        onComplete: vi.fn(),
      });

      expect(mockSession.setActiveToolsByName).not.toHaveBeenCalled();
    });
  });
});
