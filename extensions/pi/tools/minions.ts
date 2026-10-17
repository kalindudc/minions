import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { formatDuration, formatUsage } from "../render.js";
import { getMinionHistory } from "../subsessions/observability.js";
import type { AgentTree } from "../tree.js";
import type { AgentNode, AgentStatus } from "../types.js";

export const ListMinionsParams = Type.Object(
  {},
  {
    description: "List all foreground minions in the current session. No parameters required.",
  },
);
export type ListMinionsParams = Static<typeof ListMinionsParams>;

export interface MinionInfo {
  id: string;
  name: string;
  task: string;
  status: AgentStatus;
  agentName?: string;
  model?: string;
  lastActivity?: string;
}

function collectMinions(tree: AgentTree): AgentNode[] {
  const nodes: AgentNode[] = [];

  const visit = (node: AgentNode) => {
    nodes.push(node);
    for (const childId of node.children) {
      const child = tree.get(childId);
      if (child) visit(child);
    }
  };

  for (const root of tree.getRoots()) visit(root);
  return nodes;
}

function toInfo(node: AgentNode): MinionInfo {
  return {
    id: node.id,
    name: node.name,
    task: node.task,
    status: node.status,
    agentName: node.agentName,
    model: node.model,
    lastActivity: node.lastActivity,
  };
}

function displayName(node: AgentNode): string {
  return node.agentName && node.agentName !== "ephemeral"
    ? `${node.agentName} ${node.name}`
    : node.name;
}

export function listMinions(tree: AgentTree) {
  return async function execute(
    _toolCallId: string,
    _params: ListMinionsParams,
    _signal: AbortSignal | undefined,
    _onUpdate: unknown,
    _ctx: ExtensionContext,
  ): Promise<AgentToolResult<{ minions: MinionInfo[] }>> {
    const minions = collectMinions(tree).map(toInfo);

    const lines: string[] = [];
    if (minions.length === 0) {
      lines.push("No active minions.");
    } else {
      lines.push(`Minions (${minions.length}):`);
      for (const m of minions) {
        const model = m.model ? ` [${m.model}]` : "";
        const activity = m.lastActivity ? ` -- ${m.lastActivity}` : "";
        lines.push(`  ${m.name} (${m.id}) [${m.status}]${model}: ${m.task}${activity}`);
      }
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: { minions },
    };
  };
}

export function buildShowMinionText(tree: AgentTree, target: string): string | null {
  const node = tree.resolve(target);
  if (!node) return null;

  const lines: string[] = [];
  lines.push(`${displayName(node)} (${node.id})`);
  lines.push(`  Status: ${node.status}`);
  lines.push(`  Task: ${node.task}`);
  if (node.model) lines.push(`  Model: ${node.model}`);

  if (node.status === "running") {
    lines.push(`  Running for: ${formatDuration(Date.now() - node.startTime)}`);
    if (node.lastActivity) lines.push(`  Activity: ${node.lastActivity}`);
  }

  if (node.endTime) lines.push(`  Duration: ${formatDuration(node.endTime - node.startTime)}`);
  const usageText = formatUsage(node.usage);
  lines.push(`  Usage: ${usageText || "N/A"}`);
  if (node.error) lines.push(`  Error: ${node.error}`);

  const history = node.activityHistory ?? getMinionHistory(node.id);
  if (history.length > 0) {
    lines.push("  Recent activity:");
    for (const msg of history) lines.push(`    ${msg}`);
  }

  if (node.status === "running") {
    lines.push(`\n  Tip: Use '/minions show ${node.name}' for live activity stream`);
  }

  return lines.join("\n");
}

export const ShowMinionParams = Type.Object({
  target: Type.String({ description: "Minion ID or name to inspect" }),
});
export type ShowMinionParams = Static<typeof ShowMinionParams>;

export function showMinion(tree: AgentTree) {
  return async function execute(
    _toolCallId: string,
    params: ShowMinionParams,
    _signal: AbortSignal | undefined,
    _onUpdate: unknown,
    _ctx: ExtensionContext,
  ): Promise<AgentToolResult<unknown>> {
    const text = buildShowMinionText(tree, params.target);
    if (text === null) {
      throw new Error(`Minion not found: ${params.target}`);
    }
    return { content: [{ type: "text", text }], details: undefined };
  };
}
