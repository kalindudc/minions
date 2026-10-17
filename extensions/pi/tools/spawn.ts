import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { describePersonaWarning, discoverAgents, skippedPersona } from "../../../src/agents.js";
import type { AgentConfig } from "../../../src/types.js";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import { defaultMinionTemplate, generateId, pickMinionName } from "../minions.js";
import { BatchCoordinator, runSingleMinion } from "../spawn/index.js";
import type { SubsessionManager } from "../subsessions/manager.js";
import type { AgentTree } from "../tree.js";
import type { AgentStatus, UsageStats } from "../types.js";
import { emptyUsage } from "../types.js";

const TaskDescriptor = Type.Object({
  task: Type.String({ description: "Task to delegate to this minion" }),
  agent: Type.Optional(
    Type.String({
      description:
        "Name of the agent to invoke. If omitted, spawns an ephemeral minion with default capabilities.",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description:
        "Model for this minion's session, e.g. 'openrouter/z-ai/glm-5.3-flash', 'kimi-coding/k3', or an unambiguous bare model id. Resolved against the model registry; fails loudly if unknown or unauthenticated.",
    }),
  ),
});

export const SpawnToolParams = Type.Object(
  {
    tasks: Type.Array(TaskDescriptor, {
      minItems: 1,
      description:
        "Tasks to delegate. One item runs a single minion; multiple items run minions in parallel.",
    }),
  },
  { additionalProperties: false },
);
export type SpawnToolParams = Static<typeof SpawnToolParams>;

export interface BatchMinionItem {
  id: string;
  name: string;
  agentName: string;
  task: string;
  status: AgentStatus;
  usage: UsageStats;
  model?: string;
  finalOutput: string;
  activity?: string;
  spinnerFrame?: number;
}

export interface SpawnToolDetails {
  id: string;
  name: string;
  agentName: string;
  task: string;
  status: AgentStatus;
  usage: UsageStats;
  model?: string;
  finalOutput: string;
  activity?: string;
  spinnerFrame?: number;
  isBatch?: boolean;
  minions?: BatchMinionItem[];
  outputPreviewLines?: number;
  spinnerFrames?: string[];
}

function resolveAgentConfig(agentName: string, cwd: string): AgentConfig {
  const { agents, warnings } = discoverAgents(cwd, "both");
  const found = agents.find((a) => a.name === agentName);

  if (!found) {
    const skipped = skippedPersona(warnings, agentName);
    if (skipped) {
      throw new Error(`Agent "${agentName}" was skipped: ${describePersonaWarning(skipped)}`);
    }
    const available = agents.map((a) => a.name).join(", ") || "none";
    logger.warn("spawn:tool", "agent not found", {
      requested: agentName,
      available,
    });
    throw new Error(`Agent "${agentName}" not found. Available: ${available}`);
  }

  return found;
}

async function executeSpawn(
  specs: Array<{ task: string; agent?: string; model?: string }>,
  toolCallId: string,
  tree: AgentTree,
  pi: ExtensionAPI,
  subsessionManager: SubsessionManager,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<SpawnToolDetails> | undefined,
  ctx: ExtensionContext,
): Promise<AgentToolResult<SpawnToolDetails>> {
  const isSingleMinion = specs.length === 1;
  const piConfig = getConfig(ctx);
  const spinnerFrames = piConfig.display.spinnerFrames;
  const outputPreviewLines = piConfig.display.outputPreviewLines;

  if (!piConfig.allowEphemeral) {
    const ephemeralSpecs = specs.filter((s) => !s.agent);
    if (ephemeralSpecs.length > 0) {
      const { agents } = discoverAgents(ctx.cwd, "both");
      const available = agents.map((a) => `- ${a.name}: ${a.description}`).join("\n");
      throw new Error(
        `Ephemeral minions are disabled. You must specify a named agent.\n\nAvailable agents:\n${available || "(none found)"}`,
      );
    }
  }

  logger.info("spawn:tool", isSingleMinion ? "start" : "batch-start", {
    count: specs.length,
  });

  if (!isSingleMinion) {
    logger.debug("spawn:tool", "batch-minions", {
      minions: specs.map((s, i) => ({
        index: i,
        agent: s.agent ?? "ephemeral",
        task: s.task.slice(0, 50),
      })),
    });
  }

  const parentToolNames = pi.getAllTools().map((t) => t.name);
  const assignedNames = new Set<string>();

  const minions: BatchMinionItem[] = specs.map((spec) => {
    const id = generateId();
    const agentConfig = spec.agent ? resolveAgentConfig(spec.agent, ctx.cwd) : undefined;
    const name = pickMinionName(tree, id, ctx, agentConfig?.displayName, assignedNames);
    assignedNames.add(name);

    const config = {
      ...(agentConfig ?? defaultMinionTemplate(name)),
      model: spec.model ?? agentConfig?.model,
    };
    const resolvedModel = spec.model ?? config.model ?? ctx.model?.id;

    return {
      id,
      name,
      agentName: spec.agent ?? "ephemeral",
      task: spec.task,
      status: "running",
      usage: emptyUsage(),
      model: resolvedModel,
      finalOutput: "",
      activity: "starting...",
      spinnerFrame: 0,
    };
  });

  for (const m of minions) {
    tree.add(m.id, m.name, m.task, undefined, m.agentName, m.model);
  }

  const controller = new AbortController();
  if (signal) {
    const onAbort = () => controller.abort();
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const batchId = generateId();
  const batchName = isSingleMinion ? minions[0].name : `batch-${batchId.slice(0, 8)}`;
  const coordinator = new BatchCoordinator({
    minions,
    isSingleMinion,
    batchId,
    batchName,
    batchTask: isSingleMinion ? minions[0].task : `batch of ${specs.length} minions`,
    outputPreviewLines,
    spinnerFrames,
    onUpdate,
  });
  coordinator.start();

  const sessionPromises = minions.map((m, index) => {
    const spec = specs[index];
    if (!spec) throw new Error(`No spec found for minion at index ${index}`);
    return runSingleMinion({
      spec,
      m,
      isSingleMinion,
      toolCallId,
      controller,
      tree,
      ctx,
      piConfig,
      parentToolNames,
      subsessionManager,
      coordinator,
    });
  });

  const results = await Promise.allSettled(sessionPromises);
  coordinator.stop();

  const anyFailed = results.some(
    (r) => r.status === "rejected" || !(r.value as { success: boolean }).success,
  );
  const completedCount = minions.filter((m) => m.status === "completed").length;
  const failedCount = minions.filter((m) => m.status === "failed").length;
  const finalStatus = coordinator.getStatus();
  coordinator.emit(true);
  coordinator.disconnect();

  const firstMinion = minions[0];
  const finalOutput = coordinator.getOutput();

  if (isSingleMinion) {
    logger.info("spawn:tool", finalStatus === "completed" ? "completed" : "failed", {
      id: firstMinion.id,
      exitCode: anyFailed ? 1 : 0,
    });
  } else {
    logger.info("spawn:tool", "batch-complete", {
      count: specs.length,
      status: finalStatus,
      succeeded: completedCount,
      failed: failedCount,
    });
  }

  const resultText = isSingleMinion
    ? `Minion ${firstMinion.name} (${firstMinion.id}) ${finalStatus}.\n\n${finalOutput || "(no output)"}`
    : `Batch complete: ${completedCount} completed${failedCount > 0 ? `, ${failedCount} failed` : ""}\n\n${finalOutput}`;

  const result: AgentToolResult<SpawnToolDetails> = {
    content: [{ type: "text", text: resultText }],
    details: {
      id: isSingleMinion ? firstMinion.id : batchId,
      name: isSingleMinion ? firstMinion.name : batchName,
      agentName: isSingleMinion ? firstMinion.agentName : "batch",
      task: isSingleMinion ? firstMinion.task : `batch of ${specs.length} minions`,
      status: finalStatus,
      model: isSingleMinion ? firstMinion.model : undefined,
      usage: minions.reduce(
        (acc, m) => ({
          input: acc.input + m.usage.input,
          output: acc.output + m.usage.output,
          cacheRead: acc.cacheRead + m.usage.cacheRead,
          cacheWrite: acc.cacheWrite + m.usage.cacheWrite,
          cost: acc.cost + m.usage.cost,
          contextTokens: acc.contextTokens + m.usage.contextTokens,
          turns: acc.turns + m.usage.turns,
        }),
        emptyUsage(),
      ),
      finalOutput,
      isBatch: !isSingleMinion,
      minions: [...minions],
      outputPreviewLines,
      spinnerFrames,
    },
  };

  for (const m of minions) {
    const currentNode = tree.get(m.id);
    if (currentNode?.status === "aborted") {
      throw new Error(
        `[HALTED] Minion ${m.name} (${m.id}) was stopped by the user. This is intentional — do NOT retry or re-spawn.`,
      );
    }
  }

  if (anyFailed) {
    if (isSingleMinion) {
      const errorMsg = firstMinion.finalOutput || "exited with error";
      throw new Error(`Minion ${firstMinion.name} (${firstMinion.id}) failed: ${errorMsg}`);
    }

    const failed = minions.filter((m) => m.status === "failed");
    const detail = failed
      .map(
        (m) => `${m.name}: ${(m.finalOutput || "exited with error").split("\n")[0].slice(0, 300)}`,
      )
      .join("; ");
    throw new Error(`Batch spawn failed (${failed.length}/${minions.length} failed). ${detail}`);
  }

  return result;
}

export function spawn(tree: AgentTree, pi: ExtensionAPI, subsessionManager: SubsessionManager) {
  return async function execute(
    _toolCallId: string,
    params: SpawnToolParams,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<SpawnToolDetails> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<SpawnToolDetails>> {
    const { tasks } = params;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      throw new Error("Must specify a non-empty 'tasks' array.");
    }

    logger.debug("spawn:tool", tasks.length === 1 ? "single-mode" : "batch-mode", {
      count: tasks.length,
    });

    return executeSpawn(tasks, _toolCallId, tree, pi, subsessionManager, signal, onUpdate, ctx);
  };
}
