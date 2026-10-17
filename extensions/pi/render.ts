import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { minionSpawnRenderer } from "./renderers/minion-spawn.js";
import type { SpawnToolDetails } from "./tools/spawn.js";
import type { UsageStats } from "./types.js";
import { emptyUsage } from "./types.js";

// Formatting helpers

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

export function formatToolCall(name: string, args: Record<string, unknown>): string {
  if (name === "bash") {
    const cmd = String(args.command ?? "");
    const truncated = cmd.length > 60 ? `${cmd.slice(0, 60)}...` : cmd;
    return `$ ${truncated}`;
  }
  if (name === "read") {
    const path = String(args.path ?? args.file_path ?? "");
    return `read ${path}`;
  }
  const preview = JSON.stringify(args);
  const truncated = preview.length > 50 ? `${preview.slice(0, 50)}...` : preview;
  return `${name} ${truncated}`;
}

export function formatUsage(usage: UsageStats, model?: string): string {
  const parts: string[] = [];

  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns !== 1 ? "s" : ""}`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);

  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (usage.contextTokens) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  if (model) parts.push(model);

  return parts.join("  ");
}

// TUI render functions

export function renderCall(args: Record<string, unknown>, theme: Theme, _ctx: unknown): Text {
  if (args.tasks && Array.isArray(args.tasks) && args.tasks.length > 1) {
    const n = args.tasks.length;
    const taskModels = (args.tasks as Array<{ model?: string }>)
      .map((t) => t.model)
      .filter(Boolean);
    const uniqueModels = new Set(taskModels);
    const modelHint = uniqueModels.size === 1 ? ` [${[...uniqueModels][0]}]` : "";

    let text = theme.fg("toolTitle", theme.bold("spawn "));
    text += theme.fg("accent", `[${n} minion${n !== 1 ? "s" : ""}]`);
    if (modelHint) {
      text += theme.fg("dim", modelHint);
    }

    return new Text(text, 0, 0);
  }

  const firstTask = Array.isArray(args.tasks) ? args.tasks[0] : undefined;
  const task = String(firstTask?.task ?? "");
  const firstTaskLine = task.split("\n")[0];
  const taskPreview = firstTaskLine.length > 60 ? `${firstTaskLine.slice(0, 60)}…` : firstTaskLine;
  const model = firstTask?.model ? ` [${firstTask.model}]` : "";

  const text =
    theme.fg("toolTitle", theme.bold("spawn ")) +
    theme.fg("muted", taskPreview) +
    theme.fg("dim", model);
  return new Text(text, 0, 0);
}

export function renderResult(
  result: AgentToolResult<SpawnToolDetails>,
  { expanded, isPartial }: ToolRenderResultOptions,
  theme: Theme,
  ctx: {
    isError: boolean;
    state?: {
      cachedName?: string;
      cachedId?: string;
      cachedMinions?: Array<{ name: string; id: string }>;
    };
  },
): Text {
  let details = result.details;

  // Cache name/id during streaming so they survive tool errors
  if (isPartial && details) {
    if (ctx.state) {
      ctx.state.cachedName = details.name;
      ctx.state.cachedId = details.id;
      if (details.isBatch && details.minions) {
        ctx.state.cachedMinions = details.minions.map((m) => ({ name: m.name, id: m.id }));
      }
    }
  }

  // Batch fallback when details missing
  if (!details && ctx.state?.cachedMinions) {
    details = {
      isBatch: true,
      minions: ctx.state.cachedMinions.map((m) => ({
        ...m,
        status: ctx.isError ? "failed" : "completed",
        usage: emptyUsage(),
        finalOutput: "",
        agentName: m.name,
        task: "",
      })),
      status: ctx.isError ? "failed" : "completed",
      usage: emptyUsage(),
      finalOutput: "",
      id: "",
      name: "batch",
      agentName: "batch",
      task: "",
    } as SpawnToolDetails;
  } else if (!details && ctx.state) {
    const name = ctx.state.cachedName ?? "minion";
    const id = ctx.state.cachedId;
    // Reconstruct minimal details for rendering
    details = {
      id: id ?? "",
      name,
      agentName: name,
      task: "",
      status: ctx.isError ? "failed" : "completed",
      usage: emptyUsage(),
      finalOutput: "",
      spinnerFrame: 0,
    } as SpawnToolDetails;
  }

  // Final fallback when no details and no cached state
  if (!details) {
    details = {
      id: "",
      name: "minion",
      agentName: "minion",
      task: "",
      status: ctx.isError ? "failed" : "completed",
      usage: emptyUsage(),
      finalOutput: "",
      spinnerFrame: 0,
    } as SpawnToolDetails;
  }

  const rendered = minionSpawnRenderer({ details }, { expanded }, theme);

  if (!rendered) {
    return new Text(theme.fg("error", "Failed to render spawn result"), 0, 0);
  }

  // Compose final output from structured parts
  const parts: string[] = [];
  if (rendered.header) parts.push(rendered.header);
  if (rendered.body) parts.push(rendered.body);

  // Add footer with usage info for batch spawns
  if (details.isBatch && details.minions && details.minions.length > 1) {
    const uniqueModels = new Set(details.minions.map((m) => m.model).filter(Boolean));
    const model = uniqueModels.size === 1 ? [...uniqueModels][0] : undefined;
    const usage = {
      turns: details.minions.reduce((sum, m) => sum + m.usage.turns, 0),
      input: details.minions.reduce((sum, m) => sum + m.usage.input, 0),
      output: details.minions.reduce((sum, m) => sum + m.usage.output, 0),
      cost: details.minions.reduce((sum, m) => sum + m.usage.cost, 0),
      contextTokens: details.minions.reduce((sum, m) => sum + m.usage.contextTokens, 0),
      cacheRead: details.minions.reduce((sum, m) => sum + m.usage.cacheRead, 0),
      cacheWrite: details.minions.reduce((sum, m) => sum + m.usage.cacheWrite, 0),
    };

    const usageText = formatUsage(usage, model);
    if (usageText) {
      // Right-align usage text (assuming 100 char terminal width)
      const terminalWidth = process.stdout.columns || 80;
      const visibleLength = usageText.length;
      // leave some padding on the right for aesthetics
      const leftPadding = Math.max(2, terminalWidth - visibleLength - 10);

      parts.push(" ".repeat(leftPadding) + theme.fg("muted", usageText));
    }
  } else if (rendered.footer) {
    parts.push(rendered.footer);
  }

  return new Text(parts.join("\n"), 0, 0);
}
