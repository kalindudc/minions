import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../../src/types.js";
import { logger } from "./logger.js";
import { generateId } from "./minions.js";
import { SubsessionManager } from "./subsessions/manager.js";
import { getTempSessionPath } from "./subsessions/paths.js";
import type { AgentTree } from "./tree.js";
import type { SpawnResult } from "./types.js";
import { emptyUsage } from "./types.js";

// Transcript logging (transitional - should move to SubsessionManager)
const TRANSCRIPT_DIR = join("/tmp", "logs", "pi-minions", "minions");

function createTranscriptWriter(id: string, name: string, task: string) {
  try {
    mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
  const path = join(TRANSCRIPT_DIR, `${id}-${name}.log`);

  const write = (line: string) => {
    try {
      appendFileSync(path, `${line}\n`);
    } catch {
      /* never throw from logging */
    }
  };

  write(`=== Minion: ${name} (${id}) ===`);
  write(`Task: ${task}`);
  write(`Started: ${new Date().toISOString()}`);
  write("---");

  return { write, path };
}

// Callbacks for streaming progress
export interface MinionCallbacks {
  onToolActivity?: (activity: {
    type: "start" | "end";
    toolName: string;
    args?: Record<string, unknown>;
  }) => void;
  onToolOutput?: (toolName: string, delta: string) => void;
  onTextDelta?: (delta: string, fullText: string) => void;
  onTurnEnd?: (turnCount: number) => void;
  onUsageUpdate?: (usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
  }) => void;
}

/**
 * Run a minion session.
 *
 * This function ORCHESTRATES between:
 * - AgentTree: UI state updates (status, activity, usage)
 * - SubsessionManager: Session lifecycle (create, steer, abort)
 *
 * All other modules should use ONE of these, not both.
 *
 * @param tree - UI state tracker (notifications, hierarchy)
 * @param subsessionManager - Session lifecycle manager
 */
export async function runMinionSession(
  config: AgentConfig,
  task: string,
  opts: {
    id?: string;
    name?: string;
    signal?: AbortSignal;
    modelRegistry: ModelRegistry;
    customTools?: import("@earendil-works/pi-coding-agent").ToolDefinition[];
    parentToolNames?: string[];
    toolSyncEnabled?: boolean;
    toolSyncMaxWait?: number;
    // biome-ignore lint/suspicious/noExplicitAny: external API type
    parentModel?: Model<any>;
    cwd: string;
    parentSystemPrompt?: string;
    subsessionManager?: SubsessionManager;
    spawnedBy?: string;
    parentSessionPath?: string;
    tree?: AgentTree;
  } & MinionCallbacks,
): Promise<SpawnResult> {
  const id = opts.id ?? generateId();
  const name = opts.name ?? config.name;
  const spawnedBy = opts.spawnedBy ?? "unknown";

  // Get or create SubsessionManager
  const subsessionManager =
    opts.subsessionManager ??
    new SubsessionManager(opts.cwd, opts.parentSessionPath ?? getTempSessionPath(opts.cwd));

  // Get AgentTree for UI updates (optional - can run without UI)
  const tree = opts.tree;

  logger.debug("spawn:session", "start", {
    id,
    name,
    agent: config.name,
    task,
  });

  // Transitional: logging should move to SubsessionManager
  const transcript = createTranscriptWriter(id, name, task);
  transcript.write(
    `System Prompt: ${opts.parentSystemPrompt ?? config.systemPrompt ?? "(default)"}`,
  );
  transcript.write("---");

  let turnCount = 0;
  let finalOutput = "";
  let completed = false;
  let stepLimitReached = false;
  let abortReason: string | undefined;
  const usage = emptyUsage();

  // Timeout handling
  const effectiveTimeout =
    config.timeout ??
    (process.env.PI_MINIONS_TIMEOUT
      ? parseInt(process.env.PI_MINIONS_TIMEOUT, 10) || undefined
      : undefined);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let graceTimeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    // Create session via SubsessionManager
    const completionPromise = new Promise<{ exitCode: number; output: string }>(
      (resolve, reject) => {
        subsessionManager
          .create({
            id,
            name,
            task,
            config,
            spawnedBy,
            cwd: opts.cwd,
            modelRegistry: opts.modelRegistry,
            parentModel: opts.parentModel,
            parentSystemPrompt: opts.parentSystemPrompt,
            signal: opts.signal,
            customTools: opts.customTools,
            parentToolNames: opts.parentToolNames,
            toolSyncEnabled: opts.toolSyncEnabled,
            toolSyncMaxWait: opts.toolSyncMaxWait,

            // Transcript logging + forward to caller callbacks
            // Tree updates are the caller's responsibility (via opts callbacks)
            onToolActivity: (activity) => {
              transcript.write(`\n[tool:${activity.type}] ${activity.toolName}`);
              opts.onToolActivity?.(activity);
            },

            onToolOutput: (toolName, delta) => {
              transcript.write(`[tool:output] ${delta.trimEnd()}`);
              opts.onToolOutput?.(toolName, delta);
            },

            onTextDelta: (delta, fullText) => {
              finalOutput = fullText;
              opts.onTextDelta?.(delta, fullText);
            },

            onUsageUpdate: (partial) => {
              tree?.updateUsage(id, partial);
              opts.onUsageUpdate?.(partial);
            },

            onTurnEnd: (count) => {
              turnCount = count;
              transcript.write(`\n--- turn ${count} ---`);

              // Step limit enforcement
              if (config.steps !== undefined && count >= config.steps && !stepLimitReached) {
                stepLimitReached = true;
                transcript.write(`\n=== Step limit reached (${config.steps}) ===`);
                logger.warn("spawn:session", "Step limit reached", {
                  name: config.name,
                  steps: config.steps,
                  turnCount: count,
                });

                const session = subsessionManager.getSession(id);
                if (session) {
                  session
                    .steer(
                      "STEP LIMIT REACHED. You have used all allocated steps. " +
                        "Wrap up now — summarize your progress and deliver your findings. " +
                        "You have 2 more turns to finish.",
                    )
                    .catch(() => {});
                }
              } else if (
                stepLimitReached &&
                config.steps !== undefined &&
                count > config.steps + 2
              ) {
                abortReason = "Step limit exceeded — force abort after grace period";
                logger.warn("spawn:session", "Force abort after grace period", {
                  name: config.name,
                  steps: config.steps,
                  turnCount: count,
                });
                subsessionManager.abortSession(id);
              }

              opts.onTurnEnd?.(count);
            },

            onComplete: (result) => {
              if (!completed) {
                completed = true;

                // Update AgentTree status
                const status = result.exitCode === 0 ? "completed" : "failed";
                tree?.updateStatus(id, status, result.exitCode);

                resolve(result);
              }
            },
          })
          .then((handle) => {
            // Wire abort signal - abort always means halt (stop the session)
            if (opts.signal) {
              const onAbort = () => {
                if (!completed) {
                  completed = true;
                  handle.abort();
                  tree?.updateStatus(id, "aborted");
                  resolve({ exitCode: 1, output: finalOutput });
                }
              };
              if (opts.signal.aborted) {
                onAbort();
              } else {
                opts.signal.addEventListener("abort", onAbort, { once: true });
              }
            }

            // Set up timeout
            if (effectiveTimeout !== undefined) {
              timeoutId = setTimeout(() => {
                transcript.write(`\n=== Timeout reached (${effectiveTimeout}ms) ===`);
                logger.warn("spawn:session", "Timeout reached", {
                  name: config.name,
                  timeout: effectiveTimeout,
                  turnCount,
                });

                handle
                  .steer(
                    "TIMEOUT REACHED. Your time allocation has expired. " +
                      "Summarize your progress and findings now. Do NOT make any more tool calls. " +
                      "This is your last turn.",
                  )
                  .catch(() => {});

                graceTimeoutId = setTimeout(() => {
                  transcript.write(`\n=== Force abort after grace period ===`);
                  logger.warn("spawn:session", "Force abort after timeout grace", {
                    name: config.name,
                    timeout: effectiveTimeout,
                    turnCount,
                  });
                  handle.abort();
                  if (!completed) {
                    completed = true;
                    tree?.updateStatus(id, "aborted");
                    resolve({ exitCode: 1, output: finalOutput });
                  }
                }, 30_000);
              }, effectiveTimeout);
            }
          })
          .catch((err) => {
            if (!completed) {
              completed = true;
              tree?.updateStatus(id, "failed", 1, err.message);
              reject(err);
            }
          });
      },
    );

    const result = await completionPromise;

    // Cleanup
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (graceTimeoutId !== undefined) clearTimeout(graceTimeoutId);

    // Check step limit abort
    if (abortReason && result.exitCode === 0) {
      return {
        exitCode: 1,
        finalOutput: result.output || finalOutput,
        usage,
        error: abortReason,
      };
    }

    // Get final stats
    const session = subsessionManager.getSession(id);
    if (session) {
      try {
        const stats = session.getSessionStats();
        usage.input = stats.tokens.input;
        usage.output = stats.tokens.output;
        usage.cacheRead = stats.tokens.cacheRead;
        usage.cacheWrite = stats.tokens.cacheWrite;
        usage.cost = stats.cost;
      } catch {
        // Session stats may not be available
      }
    }

    usage.turns = turnCount;

    // Always extract just the last assistant message to avoid full conversation history
    let lastAssistantText = "";
    if (session) {
      lastAssistantText = extractLastAssistantText(session.state.messages);
      if (lastAssistantText) {
        finalOutput = lastAssistantText;
      }
    }

    transcript.write(
      `\n=== ${result.exitCode === 0 ? "Completed" : "Failed"} (${turnCount} turns) ===`,
    );
    transcript.write(`Output:\n${finalOutput}`);

    logger.debug("spawn:session", result.exitCode === 0 ? "completed" : "failed", {
      id,
      name,
      exitCode: result.exitCode,
      turns: turnCount,
      finalOutputLength: finalOutput?.length,
      lastAssistantLength: lastAssistantText?.length,
    });

    // Use the extracted last assistant message, not result.output which may contain full history
    return {
      exitCode: result.exitCode,
      finalOutput: finalOutput || result.output || "",
      usage,
      error: result.exitCode !== 0 ? result.output || "Unknown error" : undefined,
    };
  } catch (err) {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (graceTimeoutId !== undefined) clearTimeout(graceTimeoutId);

    const msg = err instanceof Error ? err.message : String(err);
    transcript.write(`\n=== Error: ${msg} ===`);
    logger.debug("spawn:session", "error", { id, name, error: msg });

    return { exitCode: 1, finalOutput, usage, error: msg };
  }
}

function extractLastAssistantText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown> | undefined;
    if (!msg || msg.role !== "assistant") continue;

    const content = msg.content;

    if (typeof content === "string") return content.trim();

    if (Array.isArray(content)) {
      const text = content
        .filter((b: { type: string; text?: string }) => b.type === "text" && b.text)
        .map((b: { type: string; text?: string }) => b.text ?? "")
        .join("");
      if (text.trim()) return text.trim();
    }
  }

  return "";
}
