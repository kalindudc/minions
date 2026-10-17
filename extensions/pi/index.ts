import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { discoverAgents, formatPersonaWarnings } from "../../src/agents.js";
import { shouldStepAside } from "./bb-bridge.js";
import { createHaltHandler } from "./commands/halt.js";
import { createMinionsHandler } from "./commands/minions.js";
import { createSpawnHandler } from "./commands/spawn.js";
import { buildFooterFactory } from "./footer.js";
import { LOG_FILE, logger } from "./logger.js";
import { renderCall, renderResult } from "./render.js";
import { minionSpawnMessageRenderer } from "./renderers/minion-spawn.js";
import { getMinionsSkill } from "./skill.js";
import { createStatusTracker } from "./status.js";
import { EventBus } from "./subsessions/event-bus.js";
import { SubsessionManager } from "./subsessions/manager.js";
import { getTempSessionPath } from "./subsessions/paths.js";
import { HaltToolParams, halt } from "./tools/halt.js";
import { ListAgentsParams, listAgents } from "./tools/list-agents.js";
import { ListMinionsParams, listMinions, ShowMinionParams, showMinion } from "./tools/minions.js";
import { SpawnToolParams, spawn } from "./tools/spawn.js";
import { AgentTree } from "./tree.js";

const LearnMinionsParams = Type.Object(
  {},
  { description: "Return the built-in pi-minions foreground delegation skill." },
);

export default function (pi: ExtensionAPI): void {
  logger.debug("extension", "loaded", { logFile: LOG_FILE });
  if (shouldStepAside()) return;

  let tree = new AgentTree();
  let subsessionManager: SubsessionManager | undefined;
  let statusTracker: ReturnType<typeof createStatusTracker> | undefined;
  let cachedUi: ExtensionContext["ui"] | null = null;
  let cachedCtx: ExtensionContext | null = null;
  // biome-ignore lint/suspicious/noExplicitAny: external API type
  let cachedModel: Model<any> | undefined;

  const eventBus = new EventBus();

  pi.registerTool({
    name: "spawn",
    label: "Spawn Minion",
    description:
      "Delegate tasks to named agents or ephemeral minions with isolated foreground context. " +
      "Pass a non-empty tasks array: one item runs a single minion; multiple items run minions in parallel. " +
      "If a task entry omits the agent name, spawns an ephemeral minion with default capabilities. " +
      "Agents are discovered from global and project agent/minion directories, including ~/.pi/agent/{agents,minions}/, ~/.agents/{agents,minions}/, .pi/{agents,minions}/, and .agents/{agents,minions}/. " +
      "Each agent runs as a file-based foreground session with parent tracking.",
    promptSnippet: "Spawn foreground minions from a tasks array for isolated delegation",
    promptGuidelines: [
      "Use spawn for foreground task delegation. The tool blocks until all requested minions complete and returns their results.",
      "Always pass spawn a non-empty `tasks` array. Each item requires `task` and accepts optional `agent` and `model`.",
      "Use one item in spawn's `tasks` array for a single minion; use multiple items to run minions in parallel.",
      "Use list_agents to discover available named agents before spawning by name.",
      "Omit `agent` within a spawn task descriptor to spawn an ephemeral minion with default capabilities.",
      "When a spawn result says [HALTED], the user intentionally stopped the minion. Do NOT retry, re-spawn, or ask about it. Acknowledge and move on.",
      "Use list_minions and show_minion to inspect foreground minion activity.",
    ],
    parameters: SpawnToolParams,
    execute: (...args) => {
      if (!subsessionManager) throw new Error("SubsessionManager not initialized");
      return spawn(tree, pi, subsessionManager)(...args);
    },
    renderCall,
    renderResult,
  });

  pi.registerTool({
    name: "list_agents",
    label: "List Agents",
    description: "List available agents that can be spawned as minions.",
    promptSnippet: "List available agents for spawning",
    parameters: ListAgentsParams,
    execute: listAgents(),
  });

  pi.registerTool({
    name: "halt",
    label: "Halt Minion",
    description: "Abort a running minion by ID. Use id='all' to halt all running minions.",
    parameters: HaltToolParams,
    execute: (...args) => {
      if (!subsessionManager) throw new Error("SubsessionManager not initialized");
      return halt(tree, subsessionManager)(...args);
    },
  });

  pi.registerTool({
    name: "list_minion_types",
    label: "List Minion Types",
    description: "List available agent types that can be spawned as minions.",
    promptSnippet: "List available minion types",
    parameters: ListAgentsParams,
    execute: listAgents(),
  });

  pi.registerTool({
    name: "list_minions",
    label: "List Minions",
    description: "List all foreground minions in the current session.",
    promptSnippet: "List all current foreground minions",
    promptGuidelines: [
      "Use list_minions to check what foreground minions are currently running or recently completed before spawning new ones.",
    ],
    parameters: ListMinionsParams,
    execute: (...args) => listMinions(tree)(...args),
  });

  pi.registerTool({
    name: "show_minion",
    label: "Show Minion",
    description: "Show detailed status, activity, and output of a minion by ID or name.",
    parameters: ShowMinionParams,
    execute: (...args) => showMinion(tree)(...args),
  });

  pi.registerTool({
    name: "learn_minions",
    label: "Learn Minions",
    description: "Return concise guidance for using pi-minions foreground delegation.",
    promptSnippet: "Learn how to use pi-minions",
    parameters: LearnMinionsParams,
    execute: async () => ({
      content: [{ type: "text", text: getMinionsSkill() }],
      details: undefined,
    }),
  });

  logger.debug("extension", "registering-renderers");
  pi.registerMessageRenderer("minion-spawn", minionSpawnMessageRenderer);
  logger.debug("extension", "renderers-registered");

  pi.registerCommand("spawn", {
    description: "Spawn a foreground minion: /spawn <task> [--model <model>]",
    handler: createSpawnHandler(pi),
  });

  pi.registerCommand("minions", {
    description: "Manage minions: /minions [help] for more information",
    handler: (args, ctx) => createMinionsHandler(tree, eventBus)(args, ctx),
  });

  pi.registerCommand("halt", {
    description: "Halt minion(s): /halt <id | name | all>",
    handler: (args, ctx) => {
      if (!subsessionManager) throw new Error("SubsessionManager not initialized");
      return createHaltHandler(tree, subsessionManager)(args, ctx);
    },
  });

  pi.on("tool_execution_end", (event) => {
    logger.debug("status", "tool_execution_end", { tool: event.toolName });
    statusTracker?.refresh();
  });

  pi.on("session_start", (_event, ctx) => {
    cachedCtx = ctx;
    cachedModel = ctx.model;
    cachedUi = ctx.ui;

    const { warnings } = discoverAgents(ctx.cwd, "both");
    if (warnings.length > 0) ctx.ui.notify(formatPersonaWarnings(warnings), "warning");

    const parentSessionPath = ctx.sessionManager?.getSessionFile() ?? getTempSessionPath(ctx.cwd);
    subsessionManager = new SubsessionManager(ctx.cwd, parentSessionPath, eventBus);

    tree = new AgentTree();

    for (const metadata of subsessionManager.list()) {
      if (metadata.parentSession === parentSessionPath) {
        tree.add(metadata.sessionId, metadata.name, metadata.task, undefined, metadata.agent);
        const history = subsessionManager.parseSessionHistory(metadata.sessionId);
        if (history.length > 0) tree.setActivityHistory(metadata.sessionId, history);
        if (metadata.status !== "running") {
          tree.updateStatus(metadata.sessionId, metadata.status, metadata.exitCode, metadata.error);
        }
      }
    }

    logger.debug("session", "subsession-manager-created", {
      cwd: ctx.cwd,
      parentSession: parentSessionPath,
      isTemp: !ctx.sessionManager?.getSessionFile(),
    });

    statusTracker = createStatusTracker(tree, subsessionManager, ctx);
    tree.onChange(() => statusTracker?.refresh());
    statusTracker.setUi(cachedUi);

    cachedUi.setStatus("minions-bg", undefined);
    cachedUi.setStatus("minions-fg", undefined);

    cachedUi.setFooter(
      buildFooterFactory({
        getCtx: () => cachedCtx,
        getModel: () => cachedModel,
        getThinkingLevel: () => pi.getThinkingLevel(),
        tree,
      }),
    );
  });

  pi.on("model_select", async (event, ctx) => {
    cachedUi = ctx.ui;
    cachedModel = event.model;

    cachedUi.setFooter(
      buildFooterFactory({
        getCtx: () => cachedCtx,
        getModel: () => cachedModel,
        getThinkingLevel: () => pi.getThinkingLevel(),
        tree,
      }),
    );
  });
}
