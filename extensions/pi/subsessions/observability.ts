// MinionObservabilityWidget displays streaming minion activity as a compact log
// Uses EventBus to receive real-time events from the minion

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { Key, matchesKey, Text } from "@earendil-works/pi-tui";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import type { AgentTree } from "../tree.js";
import type { EventBus } from "./event-bus.js";
import { MINION_PROGRESS_CHANNEL } from "./event-bus.js";

const OBSERVABILITY_WIDGET_KEY = "minion-observability";
const RENDER_THROTTLE_MS = 100;

// Get minion activity history from transcript if available
export function getMinionHistory(minionId: string): string[] {
  try {
    const { readdirSync, readFileSync, statSync } = require("node:fs");
    const { join } = require("node:path");
    const TRANSCRIPT_DIR = join("/tmp", "logs", "pi-minions", "minions");

    // Find transcript files for this minion
    const files = readdirSync(TRANSCRIPT_DIR)
      .filter((f: string) => f.startsWith(minionId) && f.endsWith(".log"))
      .map((f: string) => join(TRANSCRIPT_DIR, f));

    if (files.length === 0) return [];

    // Use the most recently modified file
    const file = files.sort((a: string, b: string) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];

    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n");

    // Extract activity lines (skip header)
    const activities: string[] = [];
    let inHeader = true;
    for (const line of lines) {
      if (inHeader) {
        if (line.startsWith("---")) inHeader = false;
        continue;
      }
      if (line.trim() && !line.startsWith("=")) {
        activities.push(line.trim());
      }
    }

    // Return last 4 activities
    return activities.slice(-4);
  } catch {
    return [];
  }
}

type ActivityMessage = {
  text: string;
};

class MinionObservabilityWidget {
  private messages: ActivityMessage[] = [];
  private historyIndex = 0;
  private unsubscribeEventBus: (() => void) | null = null;
  private unsubscribeTree: (() => void) | null = null;
  private onClose: () => void;
  private onBack: () => void;
  private onUpdate: () => void;
  private onNextMinion: () => void;
  private onPrevMinion: () => void;
  private renderTimeout: NodeJS.Timeout | null = null;
  private pendingRender = false;
  private tree: AgentTree;
  private maxVisibleMessages: number;

  constructor(
    private minionId: string,
    private minionName: string,
    private eventBus: EventBus,
    tree: AgentTree,
    ctx: ExtensionContext,
    onClose: () => void,
    onBack: () => void,
    onUpdate: () => void,
    onNextMinion: () => void,
    onPrevMinion: () => void,
  ) {
    this.onClose = onClose;
    this.onBack = onBack;
    this.onUpdate = onUpdate;
    this.onNextMinion = onNextMinion;
    this.onPrevMinion = onPrevMinion;
    this.tree = tree;
    this.maxVisibleMessages = getConfig(ctx).display.observabilityLines;
  }

  start(): void {
    logger.debug("observability", "widget-start", { minionId: this.minionId });

    // Subscribe to EventBus for this minion's events
    this.unsubscribeEventBus = this.eventBus.on(
      MINION_PROGRESS_CHANNEL,
      (data: { id: string; progress: unknown }) => {
        if (data.id === this.minionId) {
          const progressData = data.progress as { type?: string } | undefined;
          logger.debug("observability", "event-received", {
            minionId: this.minionId,
            progressType: progressData?.type,
          });
          this.handleEvent();
        }
      },
    );

    // Subscribe to tree changes to get activity updates
    this.unsubscribeTree = this.tree.onChange(() => {
      const node = this.tree.get(this.minionId);
      if (!node) return;
      const history = node.activityHistory || [];
      if (history.length > this.historyIndex) {
        for (let i = this.historyIndex; i < history.length; i++)
          this.messages.push({ text: history[i] ?? "" });
        this.historyIndex = history.length;
        this.trimMessages();
        this.triggerUpdate();
        return;
      }
      if (node.lastActivity) this.addMessage(node.lastActivity);
    });

    // Preload persistent activity history
    const historyNode = this.tree.get(this.minionId);
    if (historyNode?.activityHistory) {
      for (const activity of historyNode.activityHistory) this.messages.push({ text: activity });
      this.historyIndex = historyNode.activityHistory.length;
      this.trimMessages();
    }

    // Then load current activity if available
    const node = this.tree.get(this.minionId);
    if (node?.lastActivity) {
      logger.debug("observability", "initial-activity", {
        activity: node.lastActivity,
      });
      this.addMessage(node.lastActivity);
    }
  }

  stop(): void {
    logger.debug("observability", "widget-stop", { minionId: this.minionId });
    this.unsubscribeEventBus?.();
    this.unsubscribeEventBus = null;
    this.unsubscribeTree?.();
    this.unsubscribeTree = null;
    if (this.renderTimeout) {
      clearTimeout(this.renderTimeout);
      this.renderTimeout = null;
    }
  }

  private handleEvent(): void {
    // Throttle re-renders to prevent flickering
    if (!this.renderTimeout) {
      this.renderTimeout = setTimeout(() => {
        this.renderTimeout = null;
        if (this.pendingRender) {
          this.pendingRender = false;
          this.triggerUpdate();
        }
      }, RENDER_THROTTLE_MS);
      this.triggerUpdate();
    } else {
      this.pendingRender = true;
    }
  }

  private triggerUpdate(): void {
    logger.debug("observability", "trigger-update", {
      messageCount: this.messages.length,
    });
    this.onUpdate();
  }

  private trimMessages(): void {
    while (this.messages.length > this.maxVisibleMessages) {
      this.messages.shift();
    }
  }

  private addMessage(text: string): void {
    const lastMsg = this.messages[this.messages.length - 1];

    // If new text starts with the previous text (e.g., streaming text delta),
    // update the existing message instead of creating a new line
    if (lastMsg && text.startsWith(lastMsg.text) && text.length > lastMsg.text.length) {
      logger.debug("observability", "update-message", {
        oldText: lastMsg.text,
        newText: text,
      });
      lastMsg.text = text;
      this.triggerUpdate();
      return;
    }

    // Avoid duplicate consecutive messages
    if (lastMsg?.text === text) {
      return;
    }

    logger.debug("observability", "add-message", {
      text,
      currentCount: this.messages.length,
    });
    this.messages.push({ text });

    // Keep only last N messages for display
    if (this.messages.length > this.maxVisibleMessages) {
      this.messages.shift();
    }

    // Trigger re-render
    this.triggerUpdate();
  }

  handleInput(data: string): { consume: boolean } {
    if (data === "q" || data === "Q" || matchesKey(data, Key.escape)) {
      this.onClose();
      return { consume: true };
    }
    if (data === "b" || data === "B") {
      this.onBack();
      return { consume: true };
    }
    // Tab → next minion
    if (matchesKey(data, Key.tab)) {
      this.onNextMinion();
      return { consume: true };
    }
    // Shift+Tab → previous minion
    if (matchesKey(data, Key.shift(Key.tab))) {
      this.onPrevMinion();
      return { consume: true };
    }
    return { consume: true };
  }

  render(width: number, theme: Theme): string[] {
    const lines: string[] = [];
    const dim = (s: string) => theme.fg("dim", s);
    const muted = (s: string) => theme.fg("muted", s);

    const node = this.tree.get(this.minionId);

    // Header line: agent name + minion name + id + help
    const displayName =
      node?.agentName && node.agentName !== "ephemeral"
        ? `${node.agentName} ${this.minionName}`
        : this.minionName;
    const modelTag = node?.model ? ` [${node.model}]` : "";
    const headerText = `${displayName} (${this.minionId})${modelTag}`;
    const helpText = "q/esc:close · tab/shift+tab:navigate";

    // Header with accent for name, dim for help
    const headerLine = `${theme.fg("accent", this.truncate(headerText, width - helpText.length - 3))}  ${dim(helpText)}`;
    lines.push(headerLine);

    // Separator line - full width
    lines.push(muted("─".repeat(width)));

    // Show messages - oldest at top, newest at bottom
    // Start with minimal height, grow up to maxVisibleMessages
    const msgCount = this.messages.length;
    const displayCount = Math.min(msgCount, this.maxVisibleMessages);

    // Show messages (already in order: oldest -> newest)
    for (let i = 0; i < displayCount; i++) {
      const msg = this.messages[this.messages.length - displayCount + i];
      lines.push(dim(this.truncate(msg.text, width)));
    }

    return lines;
  }

  private truncate(text: string, maxWidth: number): string {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentional ANSI escape sequence matching
    const visible = text.replace(/\x1b\[[0-9;]*m/g, "").length;
    if (visible <= maxWidth) return text;
    return `${text.slice(0, maxWidth - 3)}...`;
  }
}

export function showMinionObservability(
  ctx: ExtensionContext,
  tree: AgentTree,
  eventBus: EventBus,
  minionId: string,
  onCycle?: (direction: "next" | "prev") => void,
): Promise<{ action: "close" | "back" | "cycle" }> {
  return new Promise((resolve) => {
    let resolved = false;
    let unsubscribeInput: (() => void) | null = null;

    const minion = tree.get(minionId);
    const minionName = minion?.name || "unknown";

    const renderWidget = (widget: MinionObservabilityWidget) => {
      ctx.ui.setWidget(
        OBSERVABILITY_WIDGET_KEY,
        (_tui: TUI, theme: Theme) =>
          new Text(widget.render(process.stdout.columns || 80, theme).join("\n"), 0, 0),
        { placement: "aboveEditor" },
      );
    };

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      if (unsubscribeInput) {
        unsubscribeInput();
        unsubscribeInput = null;
      }
      widget.stop();
      ctx.ui.setWidget(OBSERVABILITY_WIDGET_KEY, undefined);
    };

    const handleClose = () => {
      cleanup();
      resolve({ action: "close" });
    };

    const handleBack = () => {
      cleanup();
      resolve({ action: "back" });
    };

    const handleNext = () => {
      if (onCycle) {
        onCycle("next");
        cleanup();
        resolve({ action: "cycle" });
      }
    };

    const handlePrev = () => {
      if (onCycle) {
        onCycle("prev");
        cleanup();
        resolve({ action: "cycle" });
      }
    };

    const handleUpdate = () => {
      if (!resolved) {
        renderWidget(widget);
      }
    };

    const widget = new MinionObservabilityWidget(
      minionId,
      minionName,
      eventBus,
      tree,
      ctx,
      handleClose,
      handleBack,
      handleUpdate,
      handleNext,
      handlePrev,
    );

    unsubscribeInput = ctx.ui.onTerminalInput((data: string) => {
      const result = widget.handleInput(data);
      return result;
    });

    widget.start();
    renderWidget(widget);
  });
}

export function hideObservability(ctx: ExtensionContext): void {
  ctx.ui.setWidget(OBSERVABILITY_WIDGET_KEY, undefined);
}
