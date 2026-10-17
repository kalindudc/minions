import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { logger } from "../logger.js";
import type { SubsessionManager } from "../subsessions/manager.js";
import type { AgentTree } from "../tree.js";

export const HaltToolParams = Type.Object({
  id: Type.String({
    description: "Agent ID or minion name to halt, or 'all' to halt all running minions",
  }),
});

export type HaltToolParams = Static<typeof HaltToolParams>;

export async function abortAgents(
  ids: string[],
  tree: AgentTree,
  subsessionManager: SubsessionManager,
): Promise<number> {
  let count = 0;
  for (const id of ids) {
    const hasHandle = subsessionManager.getSessionHandle(id) !== undefined;
    logger.debug("halt", "aborting", { id, hasHandle });
    if (hasHandle) {
      subsessionManager.abortSession(id);
    }
    tree.updateStatus(id, "aborted");
    count++;
  }
  return count;
}

export function halt(tree: AgentTree, subsessionManager: SubsessionManager) {
  return async function execute(
    _toolCallId: string,
    params: HaltToolParams,
    _signal: AbortSignal | undefined,
    _onUpdate: unknown,
    _ctx: ExtensionContext,
  ): Promise<AgentToolResult<Record<string, never>>> {
    if (params.id === "all") {
      const running = tree.getRunning();
      if (running.length === 0) {
        return {
          content: [{ type: "text", text: "No running minions to halt." }],
          details: {},
        };
      }
      const count = await abortAgents(
        running.map((n) => n.id),
        tree,
        subsessionManager,
      );
      return {
        content: [
          {
            type: "text",
            text: `Halted ${count} minion${count !== 1 ? "s" : ""}.`,
          },
        ],
        details: {},
      };
    }

    const node = tree.resolve(params.id);
    if (!node) {
      throw new Error(`Minion not found: ${params.id}`);
    }

    if (node.status !== "running") {
      return {
        content: [
          {
            type: "text",
            text: `Minion ${node.name} (${node.id}) is not running (status: ${node.status}).`,
          },
        ],
        details: {},
      };
    }

    await abortAgents([node.id], tree, subsessionManager);
    return {
      content: [{ type: "text", text: `Halted minion ${node.name} (${node.id}).` }],
      details: {},
    };
  };
}
