import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SubsessionManager } from "../subsessions/manager.js";
import { abortAgents } from "../tools/halt.js";
import type { AgentTree } from "../tree.js";

export function createHaltHandler(tree: AgentTree, subsessionManager: SubsessionManager) {
  return async function handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const trimmed = args.trim();

    if (!trimmed) {
      ctx.ui.notify("Usage: /halt <id | name | all>", "error");
      return;
    }

    if (trimmed === "all") {
      const running = tree.getRunning();
      if (running.length === 0) {
        ctx.ui.notify("No running minions to halt.", "info");
        return;
      }
      const count = await abortAgents(
        running.map((n) => n.id),
        tree,
        subsessionManager,
      );
      ctx.ui.notify(`Halted ${count} minion${count !== 1 ? "s" : ""}.`, "info");
      return;
    }

    const node = tree.resolve(trimmed);
    if (!node) {
      ctx.ui.notify(`Minion not found: ${trimmed}`, "error");
      return;
    }

    if (node.status !== "running") {
      ctx.ui.notify(
        `Minion ${node.name} (${node.id}) is not running (status: ${node.status}).`,
        "info",
      );
      return;
    }

    await abortAgents([node.id], tree, subsessionManager);
    ctx.ui.notify(`Halted ${node.name} (${node.id}).`, "info");
  };
}
