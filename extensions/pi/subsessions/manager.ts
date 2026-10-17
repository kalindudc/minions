import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { logger } from "../logger.js";
import { resolveModelString } from "../model-match.js";
import { formatToolCall } from "../render.js";
import type { EventBus } from "./event-bus.js";
import { MINION_COMPLETE_CHANNEL, MINION_PROGRESS_CHANNEL } from "./event-bus.js";
import { getMinionsDir } from "./paths.js";
import type {
  CreateMinionSessionOptions,
  MinionSessionHandle,
  MinionSessionMetadata,
} from "./types.js";

export class SubsessionManager {
  private activeSessions = new Map<string, AgentSession>();
  private activeHandles = new Map<string, MinionSessionHandle>();
  private metadataCache = new Map<string, MinionSessionMetadata>();
  private unsubscribers = new Map<string, () => void>();

  constructor(
    private cwd: string,
    private parentSessionPath: string,
    public readonly eventBus?: EventBus,
  ) {}

  /** Emit progress events via EventBus for parent to receive */
  private emitProgress(id: string, progress: unknown): void {
    this.eventBus?.emit(MINION_PROGRESS_CHANNEL, { id, progress });
  }

  async create(options: CreateMinionSessionOptions): Promise<MinionSessionHandle> {
    const {
      id,
      name,
      task,
      config,
      spawnedBy,
      modelRegistry,
      parentModel,
      parentSystemPrompt,
      signal,
    } = options;

    // Create minions directory
    const minionsDir = getMinionsDir(this.cwd);
    mkdirSync(minionsDir, { recursive: true });

    const sessionPath = join(minionsDir, `${id}.${name}.jsonl`);

    // Create metadata
    const metadata: MinionSessionMetadata = {
      sessionId: id,
      parentSession: this.parentSessionPath,
      spawnedBy,
      name,
      task,
      agent: config.name,
      createdAt: Date.now(),
      status: "running",
    };

    // Create the file-based session manager using static factory
    // Use create() to create a new session file
    const sessionManager = SessionManager.create(this.cwd, minionsDir);

    // Store metadata in cache and write to separate metadata file
    // (Don't modify pi's session file format - it uses {"type":"session",...})
    const actualPath = sessionManager.getSessionFile() ?? sessionPath;
    this.metadataCache.set(id, metadata);
    this.writeMetadataFile(actualPath, metadata);

    // Set up resource loader with extensions filtered to prevent recursion
    const agentDir = getAgentDir();
    const settingsManager = SettingsManager.create(this.cwd, agentDir);
    const loader = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir,
      settingsManager,
      noExtensions: false,
      noSkills: false,
      noPromptTemplates: false,
      noThemes: false,
      systemPromptOverride: parentSystemPrompt
        ? () => parentSystemPrompt
        : config.systemPrompt
          ? () => config.systemPrompt
          : undefined,
      extensionsOverride: (base) => ({
        ...base,
        extensions: base.extensions.filter((ext) => !ext.resolvedPath.includes("pi-minions")),
      }),
    });
    await loader.reload();

    // Per-minion model override: config.model comes from the spawn spec's `model`
    // field (ephemeral minions) or the agent frontmatter `model` (named agents).
    // When set, it replaces the parent's model for this minion's session.
    let sessionModel = parentModel;
    if (config.model) {
      const override = resolveModelString(modelRegistry, config.model);
      if (!modelRegistry.hasConfiguredAuth(override)) {
        throw new Error(
          `Model override "${config.model}" (${override.provider}/${override.id}) has no configured auth. Run /login for its provider or pick another model.`,
        );
      }
      logger.debug("spawn:session", "model override applied", {
        id,
        requested: config.model,
        resolved: `${override.provider}/${override.id}`,
      });
      sessionModel = override;
    }

    // Create the agent session
    const { session } = await createAgentSession({
      cwd: this.cwd,
      model: sessionModel,
      customTools: options.customTools,
      sessionManager,
      settingsManager,
      modelRegistry,
      resourceLoader: loader,
    });

    // Bind extensions to trigger session_start — required for extensions that
    // register tools asynchronously.
    // Without this call, session_start never fires and those tools never load.
    await session.bindExtensions({ shutdownHandler: async () => {} });

    // Wait for async extension tools to stabilize before starting the session.
    // Some extensions register tools asynchronously after session_start
    // via fire-and-forget handlers. Configurable via toolSync settings.
    if (options.toolSyncEnabled !== false) {
      await this.waitForAsyncTools(id, session, options.parentToolNames, options.toolSyncMaxWait);
    }

    // Filter active tools if the agent config specifies a tool allowlist
    if (config.tools && config.tools.length > 0) {
      session.setActiveToolsByName(config.tools);
    }

    // Store the session for steer/halt operations
    this.activeSessions.set(id, session);

    // Track state for callbacks
    let currentFullText = "";
    let turnCount = 0;
    let completed = false;

    // Subscribe to session events for progress tracking and completion detection
    const unsubscribe = session.subscribe((event) => {
      // After completion/abort, drop all events — the parent tool call has
      // already returned and emitting into it would throw
      // "Agent listener invoked outside active run".
      if (completed) return;

      // Emit progress via EventBus for parent monitoring
      this.emitProgress(id, event);

      if (event.type === "tool_execution_start") {
        const toolEvent = event as { args?: Record<string, unknown> };
        options.onToolActivity?.({
          type: "start",
          toolName: event.toolName,
          args: toolEvent.args,
        });
      }
      if (event.type === "tool_execution_end") {
        options.onToolActivity?.({ type: "end", toolName: event.toolName });
      }
      if (event.type === "tool_execution_update" && options.onToolOutput) {
        const toolEvent = event as { partialResult?: { content?: Array<{ text?: string }> } };
        const fullText: string = toolEvent.partialResult?.content?.[0]?.text ?? "";
        options.onToolOutput(event.toolName, fullText);
      }
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        currentFullText += event.assistantMessageEvent.delta;
        options.onTextDelta?.(event.assistantMessageEvent.delta, currentFullText);
      }
      if (event.type === "turn_end") {
        turnCount++;
        options.onTurnEnd?.(turnCount);
        if (options.onUsageUpdate) {
          try {
            const stats = session.getSessionStats();
            options.onUsageUpdate({
              input: stats.tokens.input,
              output: stats.tokens.output,
              cacheRead: stats.tokens.cacheRead,
              cacheWrite: stats.tokens.cacheWrite,
              cost: stats.cost,
            });
          } catch {
            // getSessionStats may not be available in all states
          }
        }
      }
      if (event.type === "agent_end" && !completed) {
        completed = true;
        const exitCode = 0; // Success - agent_end without error
        this.updateStatus(id, "completed", exitCode);
        options.onComplete?.({ exitCode, output: currentFullText });
        this.eventBus?.emit(MINION_COMPLETE_CHANNEL, {
          id,
          exitCode,
          output: currentFullText,
        });
      }
    });

    // Store unsubscribe for cleanup
    this.unsubscribers.set(id, unsubscribe);

    // Wire abort signal
    let abortCleanup: (() => void) | undefined;
    if (signal) {
      const onAbort = () => {
        // Set completed BEFORE abort so any synchronous events from
        // session.abort() are dropped by the subscribe guard above.
        completed = true;
        session.abort();
        this.updateStatus(id, "aborted");
        options.onComplete?.({ exitCode: 1, output: currentFullText });
        this.eventBus?.emit(MINION_COMPLETE_CHANNEL, {
          id,
          exitCode: 1,
          output: currentFullText,
        });
      };
      if (signal.aborted) {
        session.abort();
        this.updateStatus(id, "aborted");
        completed = true;
        options.onComplete?.({ exitCode: 1, output: currentFullText });
        this.eventBus?.emit(MINION_COMPLETE_CHANNEL, {
          id,
          exitCode: 1,
          output: currentFullText,
        });
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
        abortCleanup = () => signal.removeEventListener("abort", onAbort);
      }
    }

    // Clean up when session ends
    const cleanup = () => {
      unsubscribe();
      this.unsubscribers.delete(id);
      abortCleanup?.();
      this.activeSessions.delete(id);
      this.activeHandles.delete(id);
    };

    // Build handle and wire cleanup
    const handle: MinionSessionHandle = {
      id,
      path: actualPath,
      steer: async (text: string) => {
        await session.steer(text);
      },
      abort: () => {
        session.abort();
        if (!completed) {
          completed = true;
          this.updateStatus(id, "aborted");
          options.onComplete?.({ exitCode: 1, output: currentFullText });
          this.eventBus?.emit(MINION_COMPLETE_CHANNEL, {
            id,
            exitCode: 1,
            output: currentFullText,
          });
        }
        cleanup();
      },
    };

    this.activeHandles.set(id, handle);

    // Start the session with the initial task
    session
      .prompt(task)
      .then(() => {
        // Session completed naturally
        if (!completed) {
          completed = true;
          const exitCode = signal?.aborted ? 1 : 0;
          const status = signal?.aborted ? "aborted" : "completed";
          this.updateStatus(id, status, exitCode);
          options.onComplete?.({ exitCode, output: currentFullText });
          this.eventBus?.emit(MINION_COMPLETE_CHANNEL, {
            id,
            exitCode,
            output: currentFullText,
          });
        }
        cleanup();
      })
      .catch((err) => {
        // Session failed
        if (!completed) {
          completed = true;
          const error = err instanceof Error ? err.message : String(err);
          this.updateStatus(id, "failed", 1, error);
          options.onComplete?.({ exitCode: 1, output: currentFullText });
          this.eventBus?.emit(MINION_COMPLETE_CHANNEL, {
            id,
            exitCode: 1,
            output: currentFullText,
            error,
          });
        }
        cleanup();
      });

    logger.debug("subsession", "created", { id, name, path: actualPath });

    return handle;
  }

  private async waitForAsyncTools(
    id: string,
    session: AgentSession,
    parentToolNames?: string[],
    maxWait?: number,
  ): Promise<void> {
    if (!parentToolNames) return;

    const expected = parentToolNames.filter((name) => !SubsessionManager.BUILTIN_TOOLS.has(name));
    if (expected.length === 0) return;

    const POLL_INTERVAL = 200;
    const effectiveMaxWait = maxWait ?? 5000;
    const deadline = Date.now() + effectiveMaxWait;

    while (Date.now() < deadline) {
      const current = new Set(session.getAllTools().map((t) => t.name));
      const missing = expected.filter((name) => !current.has(name));
      if (missing.length === 0) {
        logger.debug("subsession", "async-tools-ready", {
          id,
          waited: effectiveMaxWait - (deadline - Date.now()),
          toolCount: current.size,
        });
        return;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }

    // Timed out — log what's still missing but don't block session start
    const current = new Set(session.getAllTools().map((t) => t.name));
    const stillMissing = expected.filter((name) => !current.has(name));
    if (stillMissing.length > 0) {
      logger.info("subsession", "async-tools-timeout", {
        id,
        missing: stillMissing,
        missingCount: stillMissing.length,
        maxWait: effectiveMaxWait,
      });
    }
  }

  private static readonly BUILTIN_TOOLS = new Set([
    "read",
    "bash",
    "edit",
    "write",
    "grep",
    "find",
    "ls",
    "spawn",
    "list_agents",
    "halt",
    "list_minion_types",
    "list_minions",
    "show_minion",
    "learn_minions",
  ]);

  getMetadata(id: string): MinionSessionMetadata | undefined {
    // Check cache first
    if (this.metadataCache.has(id)) {
      return this.metadataCache.get(id);
    }

    // Try to read from disk
    const minionsDir = getMinionsDir(this.cwd);
    const files = this.listSessionFiles(minionsDir);

    for (const file of files) {
      // Read metadata and check sessionId (filenames are timestamp-based)
      const metadata = this.readMetadataFile(join(minionsDir, file));
      if (metadata?.sessionId === id) {
        this.metadataCache.set(id, metadata);
        return metadata;
      }
    }

    return undefined;
  }

  list(): MinionSessionMetadata[] {
    const minionsDir = getMinionsDir(this.cwd);
    if (!existsSync(minionsDir)) {
      return [];
    }

    const files = this.listSessionFiles(minionsDir);
    const results: MinionSessionMetadata[] = [];

    for (const file of files) {
      const metadata = this.readMetadataFile(join(minionsDir, file));
      if (metadata) {
        results.push(metadata);
      }
    }

    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  getSession(id: string): AgentSession | undefined {
    return this.activeSessions.get(id);
  }

  getSessionHandle(id: string): MinionSessionHandle | undefined {
    return this.activeHandles.get(id);
  }

  abortSession(id: string): boolean {
    const handle = this.activeHandles.get(id);
    if (handle) {
      handle.abort();
      return true;
    }
    return false;
  }

  /** Check if a session path is a minion session and return the minion ID */
  getMinionIdFromPath(sessionPath: string): string | undefined {
    logger.debug("subsession", "getMinionIdFromPath-start", { sessionPath });
    const minionsDir = getMinionsDir(this.cwd);
    logger.debug("subsession", "checking-minions-dir", {
      sessionPath,
      minionsDir,
      startsWith: sessionPath.startsWith(minionsDir),
    });
    if (!sessionPath.startsWith(minionsDir)) {
      logger.debug("subsession", "not-minions-dir", {
        sessionPath,
        minionsDir,
      });
      return undefined;
    }
    // Read metadata to get the session ID
    const metadata = this.readMetadataFile(sessionPath);
    logger.debug("subsession", "read-metadata-result", {
      sessionPath,
      hasMetadata: !!metadata,
    });
    if (metadata) {
      logger.debug("subsession", "extracted-id", {
        sessionPath,
        id: metadata.sessionId,
      });
      return metadata.sessionId;
    }
    logger.debug("subsession", "no-metadata-returning-undefined", {
      sessionPath,
    });
    return undefined;
  }

  /** Get the session file path for a minion by ID */
  getSessionPath(id: string): string | undefined {
    const minionsDir = getMinionsDir(this.cwd);
    const files = this.listSessionFiles(minionsDir);
    logger.debug("subsession", "getSessionPath", {
      id,
      fileCount: files.length,
    });

    for (const file of files) {
      // Check if file contains the minion ID by reading metadata
      const filePath = join(minionsDir, file);
      const metadata = this.readMetadataFile(filePath);
      if (metadata?.sessionId === id) {
        logger.debug("subsession", "found-session-path", {
          id,
          path: filePath,
        });
        return filePath;
      }
    }
    logger.debug("subsession", "session-path-not-found", { id });
    return undefined;
  }

  /** Get metadata for a minion session by ID */
  getCurrentMetadata(): MinionSessionMetadata | undefined {
    // This is used when we're in a minion session to get its metadata
    const metadata = this.list();
    // Return the most recently created running minion as current
    return metadata.find((m) => m.status === "running");
  }

  updateStatus(
    id: string,
    status: MinionSessionMetadata["status"],
    exitCode?: number,
    error?: string,
  ): void {
    const metadata = this.metadataCache.get(id) ?? this.getMetadata(id);
    if (metadata) {
      metadata.status = status;
      if (exitCode !== undefined) metadata.exitCode = exitCode;
      if (error !== undefined) metadata.error = error;

      // Find the session file and update its metadata
      const minionsDir = getMinionsDir(this.cwd);
      const files = this.listSessionFiles(minionsDir);
      for (const file of files) {
        const sessionPath = join(minionsDir, file);
        const fileMetadata = this.readMetadataFile(sessionPath);
        if (fileMetadata?.sessionId === id) {
          this.writeMetadataFile(sessionPath, metadata);
          break;
        }
      }

      this.metadataCache.set(id, metadata);
    }
  }

  parseSessionHistory(id: string): string[] {
    const path = this.getSessionPath(id);
    if (!path) return [];
    const history: string[] = [];
    let turnCount = 0;
    try {
      for (const raw of readFileSync(path, "utf-8").split("\n")) {
        if (!raw.trim()) continue;
        const event = JSON.parse(raw) as Record<string, unknown>;
        if (event.type === "tool_execution_start") {
          const args = (event.args ?? {}) as Record<string, unknown>;
          history.push(`→ ${formatToolCall(String(event.toolName), args)}`);
        } else if (event.type === "turn_end") {
          turnCount++;
          history.push(`turn ${turnCount}`);
        }
      }
    } catch {
      /* ignore */
    }
    return history;
  }

  private listSessionFiles(dir: string): string[] {
    try {
      return readdirSync(dir).filter((f: string) => f.endsWith(".jsonl"));
    } catch {
      return [];
    }
  }

  /** Get metadata file path for a session file */
  private getMetadataPath(sessionPath: string): string {
    return `${sessionPath}.minion-meta.json`;
  }

  /** Write metadata to separate file (don't modify pi's session file) */
  private writeMetadataFile(sessionPath: string, metadata: MinionSessionMetadata): void {
    try {
      const metaPath = this.getMetadataPath(sessionPath);
      writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
      logger.debug("subsession", "metadata-written", { sessionPath, metaPath });
    } catch (err) {
      logger.debug("subsession", "metadata-write-error", {
        sessionPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Read metadata from separate file, with fallback to legacy format in session file */
  private readMetadataFile(sessionPath: string): MinionSessionMetadata | undefined {
    try {
      // Try new format first: separate metadata file
      const metaPath = this.getMetadataPath(sessionPath);
      if (existsSync(metaPath)) {
        const content = readFileSync(metaPath, "utf-8");
        const metadata = JSON.parse(content) as MinionSessionMetadata;
        logger.debug("subsession", "metadata-read", {
          sessionPath,
          metaPath,
          id: metadata.sessionId,
        });
        return metadata;
      }

      // Fallback to legacy format: metadata embedded in session file first line
      if (existsSync(sessionPath)) {
        const content = readFileSync(sessionPath, "utf-8");
        const firstLine = content.split("\n")[0];
        if (firstLine) {
          const parsed = JSON.parse(firstLine);
          if (parsed.__metadata) {
            logger.debug("subsession", "metadata-read-legacy", {
              sessionPath,
              id: parsed.__metadata.sessionId,
            });
            return parsed.__metadata as MinionSessionMetadata;
          }
        }
      }

      logger.debug("subsession", "metadata-file-not-found", {
        sessionPath,
        metaPath,
      });
      return undefined;
    } catch (err) {
      logger.debug("subsession", "metadata-read-error", {
        sessionPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }

  /** Load session info using SessionManager.list() - proper API usage */
  async loadSessionInfo(): Promise<void> {
    const minionsDir = getMinionsDir(this.cwd);
    try {
      const sessions = await SessionManager.list(this.cwd, minionsDir);
      logger.debug("subsession", "loaded-session-list", {
        count: sessions.length,
      });
      for (const session of sessions) {
        logger.debug("subsession", "session-info", {
          path: session.path,
          id: session.id,
          name: session.name,
          parentSessionPath: session.parentSessionPath,
        });
      }
    } catch (err) {
      logger.debug("subsession", "load-session-list-error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
