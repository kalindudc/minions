import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const USAGE = "Usage: /spawn <task> [--model <model>]";

export function parseSpawnArgs(args: string): { task: string; model?: string } | { error: string } {
  const tokens = args.trim().split(/\s+/);

  if (tokens.length === 0 || tokens[0] === "") {
    return { error: USAGE };
  }

  if (tokens.includes("--bg")) {
    return { error: `Background spawning is not available. ${USAGE}` };
  }

  const unsupported = tokens.find((token) => token.startsWith("--") && token !== "--model");
  if (unsupported) {
    return { error: `Unsupported flag: ${unsupported}. ${USAGE}` };
  }

  const modelFlagIdx = tokens.indexOf("--model");
  let model: string | undefined;
  const remaining: string[] = [];

  if (modelFlagIdx !== -1) {
    const modelValue = tokens[modelFlagIdx + 1];
    if (!modelValue || modelValue.startsWith("--")) {
      return { error: `${USAGE} -- --model requires a value` };
    }
    model = modelValue;
    for (let i = 0; i < tokens.length; i++) {
      if (i === modelFlagIdx || i === modelFlagIdx + 1) continue;
      const token = tokens[i];
      if (token) remaining.push(token);
    }
  } else {
    remaining.push(...tokens);
  }

  const task = remaining.join(" ").trim();
  if (!task) {
    return { error: `${USAGE} -- task cannot be empty` };
  }

  return { task, model };
}

export function createSpawnHandler(pi: ExtensionAPI) {
  return async function handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const parsed = parseSpawnArgs(args);
    if ("error" in parsed) {
      ctx.ui.notify(parsed.error, "error");
      return;
    }

    const directive = `Use the spawn tool with these arguments:\n${JSON.stringify({ tasks: [parsed] })}`;
    pi.sendUserMessage(directive, { deliverAs: "steer" });
  };
}
