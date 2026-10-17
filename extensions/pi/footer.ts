import * as os from "node:os";
import type { Model } from "@earendil-works/pi-ai";
import type {
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatTokens } from "./render.js";
import type { AgentTree } from "./tree.js";

export interface FooterFactoryDeps {
  getCtx: () => ExtensionContext | null;
  // biome-ignore lint/suspicious/noExplicitAny: external API type
  getModel: () => Model<any> | undefined;
  getThinkingLevel: () => string;
  tree: AgentTree;
}

/** Abbreviate an absolute path to use ~ for home directory. */
function abbreviatePath(p: string): string {
  const home = os.homedir();
  if (p === home) return "~";
  if (p.startsWith(`${home}/`)) return `~${p.slice(home.length)}`;
  return p;
}

/** Sanitize a status string: strip control chars, collapse spaces. */
function sanitizeStatus(s: string): string {
  return s
    .replace(/[\r\n\t]/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

export function buildFooterFactory(
  deps: FooterFactoryDeps,
): (tui: unknown, theme: Theme, footerData: ReadonlyFooterDataProvider) => Component {
  return (_tui, theme, footerData) => {
    return {
      invalidate(): void {
        /* stateless — nothing to invalidate */
      },
      render(width: number): string[] {
        const ctx = deps.getCtx();
        if (!ctx) return [];

        const model = deps.getModel();

        // -- Accumulate session token/cost totals from assistant entries --
        let totalInput = 0;
        let totalOutput = 0;
        let totalCacheRead = 0;
        let totalCacheWrite = 0;
        let totalCost = 0;

        for (const entry of ctx.sessionManager.getEntries()) {
          if (entry.type !== "message") continue;

          const entryMsg = entry as {
            message?: { role?: string; usage?: Record<string, number | { total?: number }> };
          };
          const msg = entryMsg.message;
          if (!msg || msg.role !== "assistant") continue;

          const u = msg.usage;
          if (!u) continue;

          totalInput += (u.input as number) ?? 0;
          totalOutput += (u.output as number) ?? 0;
          totalCacheRead += (u.cacheRead as number) ?? 0;
          totalCacheWrite += (u.cacheWrite as number) ?? 0;

          // Session entries use nested cost.total; add safely
          const cost = u.cost as number | { total?: number } | undefined;
          totalCost += typeof cost === "number" ? cost : (cost?.total ?? 0);
        }

        // -- Add minion totals --
        const minionUsage = deps.tree.getTotalUsage();
        totalInput += minionUsage.input;
        totalOutput += minionUsage.output;
        totalCacheRead += minionUsage.cacheRead;
        totalCacheWrite += minionUsage.cacheWrite;
        totalCost += minionUsage.cost;

        // -- Line 1: pwd + git branch + session name --
        const cwd = abbreviatePath(ctx.sessionManager.getCwd());
        const branch = footerData.getGitBranch();
        const sessionName = ctx.sessionManager.getSessionName();
        const parts1: string[] = [cwd];
        if (branch) parts1.push(`(${branch})`);
        if (sessionName) parts1.push(`— ${sessionName}`);
        const line1 = theme.fg("dim", truncateToWidth(parts1.join(" "), width));

        // -- Line 2: stats left + model right --
        const contextUsage = ctx.getContextUsage();
        const statsTokens = `↑${formatTokens(totalInput)} ↓${formatTokens(totalOutput)} R${formatTokens(totalCacheRead)} W${formatTokens(totalCacheWrite)}`;
        const isOAuth = model ? ctx.modelRegistry.isUsingOAuth(model) : false;
        const costStr = `$${totalCost.toFixed(3)}${isOAuth ? " (sub)" : ""}`;

        let ctxStr = "";
        if (contextUsage && contextUsage.percent !== null) {
          const pct = Math.round(contextUsage.percent);
          const windowStr = formatTokens(contextUsage.contextWindow);
          const pctText = `${pct}%/${windowStr}`;
          if (pct > 90) {
            ctxStr = ` ${theme.fg("error", pctText)}`;
          } else if (pct > 70) {
            ctxStr = ` ${theme.fg("warning", pctText)}`;
          } else {
            ctxStr = ` ${pctText}`;
          }
        }

        const statsLeft = `${statsTokens} ${costStr}${ctxStr}`;

        let modelRight = "";
        if (model) {
          const modelName = model.name ?? model.id;
          const thinkingLevel = deps.getThinkingLevel();
          const thinkingSuffix =
            model.reasoning && thinkingLevel !== "off" ? ` [${thinkingLevel}]` : "";
          modelRight = `${modelName}${thinkingSuffix}`;
        }

        // Build the stats line with right-aligned model
        const statsLeftWidth = visibleWidth(statsLeft);
        const modelRightWidth = visibleWidth(modelRight);
        const gap = 2;
        const totalNeeded = statsLeftWidth + gap + modelRightWidth;

        let line2Raw: string;
        if (modelRight && totalNeeded <= width) {
          const spaces = width - statsLeftWidth - modelRightWidth;
          line2Raw = statsLeft + " ".repeat(spaces) + modelRight;
        } else if (modelRight && statsLeftWidth + gap <= width) {
          const available = width - statsLeftWidth - gap;
          line2Raw = `${statsLeft}  ${truncateToWidth(modelRight, available)}`;
        } else {
          line2Raw = truncateToWidth(statsLeft, width);
        }
        const line2 = theme.fg("dim", line2Raw);

        // -- Line 3 (optional): extension statuses --
        const statuses = footerData.getExtensionStatuses();
        if (statuses.size === 0) {
          return [line1, line2];
        }

        const sortedKeys = Array.from(statuses.keys()).sort();
        const statusText = sortedKeys
          .map((k) => sanitizeStatus(statuses.get(k) ?? ""))
          .filter(Boolean)
          .join(" ");

        if (!statusText) {
          return [line1, line2];
        }

        const line3 = truncateToWidth(statusText, width);
        return [line1, line2, line3];
      },
    };
  };
}
