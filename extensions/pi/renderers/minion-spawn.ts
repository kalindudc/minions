import type { MessageRenderOptions, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";
import { DEFAULT_SPINNER_FRAMES } from "../config.js";
import { formatUsage } from "../render.js";
import type { SpawnToolDetails } from "../tools/spawn.js";

// Structured render result with separate sections for flexible composition
export interface SpawnRenderResult {
  header?: string;
  body: string;
  footer?: string;
}

// Helper to calculate visible width of a string (strips ANSI codes)
function visibleWidth(str: string): number {
  // Strip ANSI escape sequences and count remaining characters
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentional ANSI escape sequence matching
  return str.replace(/\x1b\[[0-9;]*m/g, "").length;
}

// Truncate text to fit within max width, adding "..." if truncated
function truncateWithEllipsis(text: string, maxWidth: number): string {
  if (visibleWidth(text) <= maxWidth) {
    return text;
  }
  if (maxWidth <= 3) {
    return "...".slice(0, maxWidth);
  }
  // Simple truncation - remove chars from the end until we fit
  let result = text;
  while (visibleWidth(result) > maxWidth - 3 && result.length > 0) {
    result = result.slice(0, -1);
  }
  return `${result}...`;
}

function getSpinner(spinnerFrames: string[] | undefined, frameIndex: number): string {
  const frames = spinnerFrames ?? DEFAULT_SPINNER_FRAMES;
  return frames[frameIndex % frames.length] ?? frames[0] ?? "○";
}

export function renderBatchMinions(
  data: SpawnToolDetails,
  _options: MessageRenderOptions,
  theme: Theme,
): SpawnRenderResult {
  const minions = data.minions ?? [];
  const spinnerFrames = data.spinnerFrames;

  const uniqueModels = new Set(minions.map((m) => m.model).filter(Boolean));
  const showModels = uniqueModels.size > 1;

  const lines: string[] = [];

  for (const m of minions) {
    const isRunning = m.status === "running";
    const isAborted = m.status === "aborted";
    const isError = m.status === "failed";
    const isCompleted = m.status === "completed";

    let icon: string;
    if (isAborted) {
      icon = "■";
    } else if (isError) {
      icon = "✗";
    } else if (isCompleted) {
      icon = "✓";
    } else {
      icon = getSpinner(spinnerFrames, m.spinnerFrame ?? 0);
    }

    let color: "accent" | "warning" | "error" | "success" | "text" | "muted" | "dim";
    if (isCompleted) {
      color = "success";
    } else if (isAborted) {
      color = "warning";
    } else if (isError) {
      color = "error";
    } else if (isRunning) {
      color = "accent";
    } else {
      color = "text";
    }

    // Build line with icon, agent type (if not ephemeral), and name
    let line = `${theme.fg(color, icon)}`;

    // Add agent type if it's not the default ephemeral minion
    if (m.agentName && m.agentName !== "ephemeral") {
      line += ` ${theme.fg("success", m.agentName)}`;
    }

    line += ` ${theme.fg(color, m.name)}`;

    // Show model per-minion only when models differ across batch
    if (showModels && m.model) {
      line += ` ${theme.fg("dim", `[${m.model}]`)}`;
    }

    if (isRunning && m.activity) {
      // Calculate available width for activity text
      const terminalWidth = process.stdout.columns || 80;
      const prefixWidth = visibleWidth(line);
      // leave some padding on the right for aesthetics
      const availableWidth = Math.max(10, terminalWidth - prefixWidth - 10);

      const activityText = truncateWithEllipsis(m.activity, availableWidth);
      line += ` ${theme.fg("dim", activityText)}`;
    }

    lines.push(line);
  }

  return {
    body: lines.join("\n"),
  };
}

export function renderSingleMinion(
  data: SpawnToolDetails,
  options: MessageRenderOptions,
  theme: Theme,
): SpawnRenderResult {
  let name = data.name;
  let agentName = data.agentName;
  let status = data.status;
  let usage = data.usage;
  let finalOutput = data.finalOutput;
  let activity = data.activity;
  let spinnerFrame = data.spinnerFrame;
  let model = data.model;
  let id = data.id;

  if (data.minions && data.minions.length > 0) {
    // If we have batch minions but only one, render it as a single minion for better detail
    name = data.minions[0].name;
    agentName = data.minions[0].agentName;
    status = data.minions[0].status;
    usage = data.minions[0].usage;
    finalOutput = data.minions[0].finalOutput;
    activity = data.minions[0].activity;
    spinnerFrame = data.minions[0].spinnerFrame;
    model = data.minions[0].model;
    id = data.minions[0].id;
  }

  const isRunning = status === "running";
  const isAborted = status === "aborted";
  const isError = status === "failed";

  // Status icon and color
  let icon: string;
  let statusColor: "accent" | "warning" | "error" | "success" | "text" | "muted" | "dim";
  if (isAborted) {
    icon = "■";
    statusColor = "warning";
  } else if (isError) {
    icon = "✗";
    statusColor = "error";
  } else if (isRunning) {
    icon = getSpinner(data.spinnerFrames, spinnerFrame ?? 0);
    statusColor = "accent";
  } else {
    icon = "✓";
    statusColor = "success";
  }

  // Header: icon, agent type (if not ephemeral), name, id, and usage
  let header = `${theme.fg(statusColor, icon)}`;

  // Add agent type if it's not the default ephemeral minion
  if (agentName && agentName !== "ephemeral") {
    header += ` ${theme.fg("success", agentName)}`;
  }

  header += ` ${theme.fg(statusColor, name)}`;
  if (id) {
    header += ` ${theme.fg("dim", `(${id})`)}`;
  }

  // Add usage
  const usageText = formatUsage(usage, model);
  if (usageText) {
    header += `  ${theme.fg("muted", `—  ${usageText}`)}`;
  }

  let body = "";
  if (isRunning && activity) {
    body = `${theme.fg("dim", `  │`)}\n${theme.fg("dim", `  ╰  ${activity ?? "thinking…"}`)}`;
  }

  // Expanded output preview
  if (options.expanded && finalOutput) {
    const previewLines = data.outputPreviewLines ?? 20;
    const preview = finalOutput.split("\n").slice(0, previewLines).join("\n");
    body += (body ? "\n" : "") + theme.fg("toolOutput", preview);
  }

  return {
    header,
    body,
  };
}

export function minionSpawnRenderer(
  message: { details?: SpawnToolDetails },
  options: MessageRenderOptions,
  theme: Theme,
): SpawnRenderResult | undefined {
  const data = message.details;
  if (!data) {
    return undefined;
  }

  if (data.isBatch && data.minions && data.minions.length > 1) {
    return renderBatchMinions(data, options, theme);
  }

  return renderSingleMinion(data, options, theme);
}

// Wrapper for pi.registerMessageRenderer that returns Text component
export function minionSpawnMessageRenderer(
  message: { details?: SpawnToolDetails },
  options: MessageRenderOptions,
  theme: Theme,
): Component | undefined {
  const result = minionSpawnRenderer(message, options, theme);
  if (!result) return undefined;

  const parts: string[] = [];
  if (result.header) parts.push(result.header);
  if (result.body) parts.push(result.body);
  if (result.footer) parts.push(result.footer);

  return new Text(parts.join("\n"), 0, 0);
}
