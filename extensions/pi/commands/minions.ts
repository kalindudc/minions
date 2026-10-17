import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { discoverAgents } from "../../../src/agents.js";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import { getMinionsSkill } from "../skill.js";
import type { EventBus } from "../subsessions/event-bus.js";
import { showMinionObservability } from "../subsessions/observability.js";
import type { AgentTree } from "../tree.js";
import { VERSION } from "../version.js";

type ParsedArgs =
  | { action: "list" }
  | { action: "learn" }
  | { action: "skill" }
  | { action: "version" }
  | { action: "help" }
  | { action: "show-running" }
  | { action: "show"; target: string }
  | { error: string };

export function parseMinionArgs(args: string): ParsedArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) return { action: "show-running" };

  const action = tokens[0];

  if (action === "list") return { action: "list" };
  if (action === "learn") return { action: "learn" };
  if (action === "skill") return { action: "skill" };

  if (action === "show" || action === "s") {
    const target = tokens.slice(1).join(" ").trim();
    if (!target) return { error: "Usage: /minions show <id | name>" };
    return { action: "show", target };
  }

  if (action === "version") return { action: "version" };
  if (action === "help" || action === "h") return { action: "help" };

  return {
    error: `Unknown subcommand: ${action}. Use [help] to see the list of available commands.`,
  };
}

function getSortedMinionIds(tree: AgentTree): string[] {
  const running = tree.getRunning();
  return running
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => m.id);
}

async function showMinionWithCycling(
  ctx: ExtensionCommandContext,
  tree: AgentTree,
  eventBus: EventBus,
  startMinionId: string,
): Promise<void> {
  let currentId: string | null = startMinionId;

  const cycleToMinion = (currentId: string, direction: "next" | "prev"): string | null => {
    const sortedIds = getSortedMinionIds(tree);
    if (sortedIds.length === 0) return null;

    const currentIndex = sortedIds.indexOf(currentId);
    if (currentIndex === -1) return sortedIds[0] ?? null;

    if (direction === "next") {
      return sortedIds[(currentIndex + 1) % sortedIds.length] ?? null;
    }
    return sortedIds[(currentIndex - 1 + sortedIds.length) % sortedIds.length] ?? null;
  };

  while (currentId) {
    logger.debug("minions:cmd", "opening-observability", { currentId });

    let nextId: string | null = null;
    const result = await showMinionObservability(ctx, tree, eventBus, currentId, (direction) => {
      nextId = currentId ? cycleToMinion(currentId, direction) : null;
    });

    if (result.action === "close") {
      logger.debug("minions:cmd", "observability-closed");
      return;
    }

    if (result.action === "back") return;

    if (nextId) {
      currentId = nextId;
    } else {
      return;
    }
  }
}

export function showListMinions(ctx: ExtensionCommandContext) {
  const { agents } = discoverAgents(ctx.cwd, "both");
  const config = getConfig(ctx);
  const lines = ["Available minion types:"];
  if (config.allowEphemeral) {
    lines.push("  minion (built-in): General-purpose ephemeral minion with default capabilities");
  }

  for (const a of agents) {
    const model = a.model ? ` [model: ${a.model}]` : "";
    lines.push(`  ${a.name} (${a.source}): ${a.description}${model}`);
  }

  ctx.ui.notify(lines.join("\n"), "info");
  logger.debug("minions:cmd", "list-complete", { agentCount: agents.length });
}

export function createMinionsHandler(tree: AgentTree, eventBus: EventBus) {
  return async function handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
    logger.debug("minions:cmd", "handler-called", { args: args.trim() || "(empty)" });

    const parsed = parseMinionArgs(args);
    logger.debug("minions:cmd", "parsed-args", {
      action: "action" in parsed ? parsed.action : "error",
    });

    if ("error" in parsed) {
      logger.debug("minions:cmd", "parse-error", { error: parsed.error });
      ctx.ui.notify(parsed.error, "error");
      return;
    }

    if (parsed.action === "list") {
      logger.debug("minions:cmd", "list");
      showListMinions(ctx);
      return;
    }

    if (parsed.action === "learn" || parsed.action === "skill") {
      logger.debug("minions:cmd", parsed.action);
      ctx.ui.notify(getMinionsSkill(), "info");
      return;
    }

    if (parsed.action === "show-running") {
      logger.debug("minions:cmd", "show-running");
      const sortedIds = getSortedMinionIds(tree);

      if (sortedIds.length === 0) {
        ctx.ui.notify("No active minions. Spawn one with /spawn or the spawn tool.", "info");
        return;
      }

      await showMinionWithCycling(ctx, tree, eventBus, sortedIds[0] ?? "");
      return;
    }

    if (parsed.action === "version") {
      logger.debug("minions:cmd", "version", { version: VERSION });
      ctx.ui.notify(`pi-minions v${VERSION}`, "info");
      return;
    }

    if (parsed.action === "help") {
      logger.debug("minions:cmd", "help");

      const lines = ["Available /minions subcommands:"];
      lines.push("  h, help            - Show this help message");
      lines.push("  learn              - Show minion usage guidance");
      lines.push("  list               - List available agent types");
      lines.push("  s, show <id|name>  - Show live activity for a specific minion");
      lines.push("  skill              - Show the agentic minions skill text");
      lines.push("  version            - Show the extension version");

      ctx.ui.notify(lines.join("\n"), "info");
      logger.debug("minions:cmd", "help-complete");
      return;
    }

    const node = tree.resolve(parsed.target);
    if (!node) {
      ctx.ui.notify(`Minion not found: ${parsed.target}`, "error");
      return;
    }

    await showMinionWithCycling(ctx, tree, eventBus, node.id);
  };
}
