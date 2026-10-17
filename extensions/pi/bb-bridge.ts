import { existsSync, readFileSync } from "node:fs";

// bb omits `spawn` for a child that may not delegate; its remaining minion tools still mark a bb minion.
const BB_CHILD_TOOLS = ["list_agents", "list_minions", "show_minion", "halt"];

export function shouldStepAside(
  toolsFile: string | undefined = process.env.PI_BB_TOOLS_FILE,
): boolean {
  if (!toolsFile || !existsSync(toolsFile)) return false;
  let tools: unknown;
  try {
    tools = JSON.parse(readFileSync(toolsFile, "utf8"));
  } catch {
    return false;
  }
  if (!Array.isArray(tools)) return false;
  const names = new Set(
    tools.map((tool) =>
      tool !== null && typeof tool === "object" ? (tool as { name?: unknown }).name : undefined,
    ),
  );
  return names.has("spawn") || BB_CHILD_TOOLS.every((name) => names.has(name));
}
