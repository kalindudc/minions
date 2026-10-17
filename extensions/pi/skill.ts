export const MINIONS_SKILL = `# pi-minions

Use minions when independent work can run in isolated foreground agent sessions and you need the result before continuing.

Available surfaces:
- Use the \`spawn\` tool with a required, non-empty \`tasks\` array. Each item has a required \`task\` and optional \`agent\` and \`model\`. These fields belong inside each item, not at the top level.
- One item runs a single foreground minion with a single-minion result and display, not a batch wrapper.
- Two or more items run foreground minions concurrently as a batch with combined results and a batch display.
- Use \`/spawn <task> [--model <model>]\` to request a single foreground minion from the command line.
- Use \`list_agents\` before selecting named agents when you are unsure what is available.
- Use \`halt\` with a minion id, name, or \`all\` to abort running foreground minions.
- Use \`list_minions\` to see current foreground minion activity.
- Use \`show_minion\` or \`/minions show <id|name>\` to inspect detailed foreground activity.

Background minions are not available.
Live detach is not available.
User steering is not available.
`;

export function getMinionsSkill(): string {
  return MINIONS_SKILL;
}
