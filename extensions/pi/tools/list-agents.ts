import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { discoverAgents, formatPersonaWarnings } from "../../../src/agents.js";
import { getConfig } from "../config.js";

export const ListAgentsParams = Type.Object(
  {},
  {
    description:
      "List all available agents that can be spawned as minions. No parameters required.",
  },
);

export interface AgentInfo {
  name: string;
  description: string;
  source: string;
  model?: string;
}

export function listAgents() {
  return async function execute(
    _toolCallId: string,
    _params: Record<string, never>,
    _signal: AbortSignal | undefined,
    _onUpdate: undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<AgentInfo[]>> {
    const { agents, warnings } = discoverAgents(ctx.cwd, "both");
    const piConfig = getConfig(ctx);

    const lines: string[] = [];
    const details: AgentInfo[] = [];

    // Built-in ephemeral minion (only when allowed)
    if (piConfig.allowEphemeral) {
      lines.push(
        "- minion (built-in): General-purpose ephemeral minion with default capabilities. Used when no agent name is specified.",
      );
      details.push({
        name: "minion",
        description: "General-purpose ephemeral minion",
        source: "built-in",
      });
    }

    for (const a of agents) {
      const model = a.model ? ` [model: ${a.model}]` : "";
      lines.push(`- ${a.name} (${a.source}): ${a.description}${model}`);
      details.push({
        name: a.name,
        description: a.description,
        source: a.source,
        model: a.model,
      });
    }

    const skipped = warnings.length > 0 ? `\n\n${formatPersonaWarnings(warnings)}` : "";
    return {
      content: [{ type: "text", text: `Available agents:\n${lines.join("\n")}${skipped}` }],
      details,
    };
  };
}
