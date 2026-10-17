import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describePersonaWarning, discoverAgents, skippedPersona } from "../../../src/agents.js";
import type { AgentConfig } from "../../../src/types.js";
import { logger } from "../logger.js";
import { defaultMinionTemplate } from "../minions.js";
import { formatToolCall } from "../render.js";
import { runMinionSession } from "../spawn.js";
import type { SubsessionManager } from "../subsessions/manager.js";
import type { BatchMinionItem } from "../tools/spawn.js";
import type { AgentTree } from "../tree.js";
import type { BatchCoordinator } from "./batch.js";

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

export async function runSingleMinion(opts: {
  spec: { task: string; agent?: string; model?: string };
  m: BatchMinionItem;
  isSingleMinion: boolean;
  toolCallId: string;
  controller: AbortController;
  tree: AgentTree;
  ctx: ExtensionContext;
  piConfig: {
    toolSync: { enabled: boolean; maxWait: number };
  };
  parentToolNames: string[];
  subsessionManager: SubsessionManager;
  coordinator: BatchCoordinator;
}): Promise<{
  success: boolean;
  result?: import("../types.js").SpawnResult;
  error?: string;
}> {
  const {
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
  } = opts;

  const agentConfig = spec.agent ? resolveAgentConfig(spec.agent, ctx.cwd) : undefined;
  const config = {
    ...(agentConfig ?? defaultMinionTemplate(m.name)),
    model: spec.model ?? agentConfig?.model,
  };

  coordinator.emit(true);

  try {
    const result = await runMinionSession(config, spec.task, {
      id: m.id,
      name: m.name,
      signal: controller.signal,
      modelRegistry: ctx.modelRegistry,
      parentModel: ctx.model,
      cwd: ctx.cwd,
      subsessionManager,
      spawnedBy: toolCallId,
      parentSessionPath: ctx.sessionManager?.getSessionFile() ?? undefined,
      parentToolNames,
      toolSyncEnabled: piConfig.toolSync.enabled,
      toolSyncMaxWait: piConfig.toolSync.maxWait * 1000,
      tree,
      onToolActivity: (activity) => {
        if (activity.type === "start") {
          const desc = formatToolCall(activity.toolName, activity.args ?? {});
          m.activity = `→ ${desc}`;
          tree.logActivity(m.id, `→ ${desc}`);
          coordinator.emit(true);
        }
      },
      onToolOutput: (toolName, delta) => {
        const line = delta.trimEnd().split("\n").filter(Boolean).at(-1) ?? "";
        if (line) {
          m.activity = `${toolName}: ${line}`;
          tree.updateActivity(m.id, `${toolName}: ${line}`);
          coordinator.emit(true);
        }
      },
      onTextDelta: (_delta, fullText) => {
        const preview = fullText.split("\n").filter(Boolean).at(-1) ?? "";
        m.activity = preview;
        m.finalOutput = preview;
        tree.updateActivity(m.id, preview);
        coordinator.emit(true);
      },
      onTurnEnd: (turnCount) => {
        tree.logActivity(m.id, `turn ${turnCount}`);
      },
      onUsageUpdate: (usage) => {
        tree.updateUsage(m.id, usage);
        m.usage = {
          ...m.usage,
          input: usage.input,
          output: usage.output,
          cacheRead: usage.cacheRead,
          cacheWrite: usage.cacheWrite,
          cost: usage.cost,
        };
        coordinator.emit(true);
      },
    });

    const currentStatus = tree.get(m.id)?.status;
    if (currentStatus !== "aborted") {
      m.status = result.exitCode === 0 ? "completed" : "failed";
      m.finalOutput =
        m.status === "failed" ? result.error || result.finalOutput : result.finalOutput;
      m.usage = result.usage;
      const errorMsg = result.error;
      tree.updateStatus(m.id, m.status, result.exitCode, errorMsg);
      tree.updateUsage(m.id, result.usage);
      coordinator.emit(true);
    } else {
      m.status = "aborted";
      m.finalOutput = result.finalOutput;
      coordinator.emit(true);
    }

    if (!isSingleMinion) {
      logger.debug("spawn:tool", "batch-minion-finished", {
        id: m.id,
        name: m.name,
        status: m.status,
        exitCode: result.exitCode,
      });
    }

    return { success: result.exitCode === 0, result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    m.status = "failed";
    m.finalOutput = msg;
    tree.updateStatus(m.id, "failed", 1, msg);
    logger.error("spawn:tool", isSingleMinion ? "failed" : "batch-minion-failed", {
      id: m.id,
      name: m.name,
      error: msg,
    });
    return { success: false, error: msg };
  }
}
