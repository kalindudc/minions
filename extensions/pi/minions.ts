import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../../src/types.js";
import { DEFAULT_MINION_NAMES, getConfig } from "./config.js";
import type { AgentTree } from "./tree.js";

export function generateId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

export function pickMinionName(
  tree: AgentTree,
  fallbackId: string,
  ctx?: ExtensionContext,
  preferredName?: string,
  reservedNames?: Set<string>,
): string {
  const inUse = new Set([
    ...tree.getRunning().map((n) => n.name),
    ...(reservedNames ? Array.from(reservedNames) : []),
  ]);

  if (preferredName) {
    if (!inUse.has(preferredName)) return preferredName;
    let candidate: string;
    do {
      const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 4);
      candidate = `${preferredName}-${suffix}`;
    } while (inUse.has(candidate));
    return candidate;
  }

  const names = ctx ? getConfig(ctx).minionNames : DEFAULT_MINION_NAMES;
  const available = names.filter((n) => !inUse.has(n));
  const useFallback = available.length === 0;
  const availableLength = available.length === 0 ? names.length : available.length;

  let name = available[Math.floor(Math.random() * availableLength)];
  if (useFallback) {
    name = `${name}-${fallbackId}`;
  }

  return name;
}

export const DEFAULT_MINION_PROMPT = `You are a minion — an autonomous subagent in an isolated context with no conversation history. Be concise; your output goes to a parent agent, not a human.

Use tools to investigate and complete the task. Prefer grep/find/ls before reading files. Use absolute paths.

File boundaries: research output goes to /tmp/ only.
Project files can be modified only when explicitly requested.
When in doubt, report findings first.

On failure: STOP. Report what happened. Do NOT fabricate information. Do NOT silently retry.

Respond with:

## Result
What was accomplished or found.

## Files
File paths modified or referenced.

## Notes
Issues, assumptions, or follow-up needed.`;

export function defaultMinionTemplate(
  name: string,
  overrides?: Partial<Pick<AgentConfig, "model" | "thinking" | "tools" | "steps" | "timeout">>,
): AgentConfig {
  return {
    name,
    description: "Ephemeral minion",
    systemPrompt: DEFAULT_MINION_PROMPT,
    source: "ephemeral",
    filePath: "",
    ...overrides,
  };
}
