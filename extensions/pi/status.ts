import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getConfig } from "./config.js";
import { logger } from "./logger.js";
import type { SubsessionManager } from "./subsessions/manager.js";
import type { AgentTree } from "./tree.js";

export const MINIONS_STATUS_KEY = "minions-status";

const HINT_ROTATION_INTERVAL = 4000;
const STATIC_HINTS = ["/minions", "/minions list", "/minions learn"];

export interface StatusTracker {
  refresh(): void;
  setUi(ui: ExtensionContext["ui"] | null): void;
  destroy(): void;
}

export function createStatusTracker(
  tree: AgentTree,
  _subsessionManager: SubsessionManager,
  ctx: ExtensionContext,
): StatusTracker {
  let cachedUi: ExtensionContext["ui"] | null = null;
  let lastRunningCount = -1;
  let currentHintIndex = 0;
  let hintRotationTimer: ReturnType<typeof setInterval> | null = null;

  function generateHints(running: { id: string; name: string }[]): string[] {
    const hints: string[] = [...STATIC_HINTS];

    for (const minion of running) {
      hints.push(`/minions show ${minion.name}`);
      hints.push(`/halt ${minion.name}`);
    }

    return hints;
  }

  function getNextHint(hints: string[]): string {
    if (hints.length === 0) return "";
    return hints[currentHintIndex % hints.length] ?? "";
  }

  function startHintRotation(): void {
    if (hintRotationTimer) {
      logger.debug("status", "rotation-already-running");
      return;
    }
    logger.debug("status", "rotation-start", {
      interval: HINT_ROTATION_INTERVAL,
    });
    hintRotationTimer = setInterval(() => {
      currentHintIndex++;
      logger.debug("status", "rotation-tick", { index: currentHintIndex });
      refresh();
    }, HINT_ROTATION_INTERVAL);
  }

  function stopHintRotation(): void {
    if (hintRotationTimer) {
      logger.debug("status", "rotation-stop");
      clearInterval(hintRotationTimer);
      hintRotationTimer = null;
    }
    currentHintIndex = 0;
  }

  function formatStatus(runningCount: number, hint: string, theme: Theme): string {
    const parts: string[] = [];

    if (runningCount > 0) {
      parts.push(`[oo] minions: ${runningCount}`);
    }

    if (hint) {
      if (parts.length > 0) {
        parts.push(`  ·  ${hint}`);
      } else {
        parts.push(hint);
      }
    }

    return theme.fg("muted", parts.join(""));
  }

  function refresh(): void {
    if (!cachedUi) {
      logger.debug("status", "skip-no-ui");
      return;
    }

    const running = tree.getRunning().map((n) => ({ id: n.id, name: n.name }));
    const runningCount = running.length;
    const hasChanges = runningCount !== lastRunningCount;

    if (hasChanges) {
      logger.debug("status", "update", {
        runningFrom: lastRunningCount,
        runningTo: runningCount,
        hasTimer: !!hintRotationTimer,
        running: running.map((n) => `${n.name}(${n.id})`),
      });

      lastRunningCount = runningCount;

      if (runningCount > 0) {
        startHintRotation();
      } else {
        logger.debug("status", "rotation-stop-trigger", {
          reason: "no-minions",
        });
        stopHintRotation();
      }
    }

    const config = getConfig(ctx);
    const hints = config.display.showStatusHints ? generateHints(running) : [];
    const currentHint = getNextHint(hints);
    const { theme } = cachedUi;

    if (runningCount === 0) {
      cachedUi.setStatus(MINIONS_STATUS_KEY, undefined);
    } else {
      const statusText = formatStatus(runningCount, currentHint, theme);
      cachedUi.setStatus(MINIONS_STATUS_KEY, statusText);
    }
  }

  function setUi(ui: ExtensionContext["ui"] | null): void {
    cachedUi = ui;
  }

  function destroy(): void {
    stopHintRotation();
  }

  return { refresh, setUi, destroy };
}
