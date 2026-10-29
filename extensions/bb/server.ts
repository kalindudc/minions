import { type BbPluginApi, defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { formatPersonaWarnings, readPersonaBody } from "../../src/agents.js";
import { mayDelegate, parseMinionMetadata } from "./metadata.js";
import {
  EPHEMERAL_PERSONA,
  identityLine,
  listPersonas,
  MAX_TASKS,
  personaInstructions,
  type SpawnOutcome,
  spawnBatch,
} from "./spawn.js";
import {
  archiveMinion,
  countMinions,
  createInvalidator,
  getMinionIdentity,
  listMinions,
  type MinionRow,
  registerMinionEvents,
  showMinion,
  stopAllMinions,
  stopMinion,
  tellMinion,
} from "./state.js";

const ALL_TOOLS = ["spawn", "list_agents", "list_minions", "show_minion", "halt"];
const CHILD_TOOLS = ALL_TOOLS.filter((tool) => tool !== "spawn");
const SKILLS = ["minions"];
const DESCRIPTION_LIMIT = 300;
// bb skips the parent notice when a child's turn was stopped by hand.
const STOPPED_NOTE = "bb sends no report for a stopped minion.";
const TASK_LIMIT = 100;

const threadIdSchema = z.string().trim().min(1);
const environmentSchema = z.enum(["shared", "worktree"]);
const taskSchema = z
  .object({
    task: z
      .string()
      .trim()
      .min(1)
      .describe("Self-contained task; the minion sees none of your conversation."),
    agent: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Persona name from list_agents. Omit for a general-purpose minion."),
    model: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Exact model id, or a unique suffix after '/'. Omit to use the persona or thread model.",
      ),
    thinking: z
      .enum(["off", "minimal", "low", "medium", "high", "xhigh"])
      .optional()
      .describe(
        "Thinking level for this minion, overriding the persona. off maps to none; minimal maps to low. Unsupported levels fail the task. Omit to use persona or thread defaults.",
      ),
    environment: environmentSchema
      .optional()
      .describe(
        "shared (default) works in this thread's checkout; worktree gets an isolated Git worktree.",
      ),
  })
  .strict();
const outcomeSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    id: z.string(),
    name: z.string(),
    persona: z.string(),
    model: z.string(),
    environment: environmentSchema,
  }),
  z.object({ ok: z.literal(false), task: z.string(), error: z.string() }),
]);
const minionRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  persona: z.string(),
  name: z.string().nullable(),
  trait: z.string().nullable(),
  task: z.string(),
  status: z.string(),
  providerId: z.string(),
  model: z.string(),
  createdAt: z.number(),
  needsInput: z.boolean(),
  progress: z
    .object({ done: z.number(), total: z.number(), current: z.string().nullable() })
    .nullable(),
  outputPreview: z.string().nullable(),
});
const personaWarningSchema = z.object({ name: z.string(), path: z.string(), reason: z.string() });
const minionTarget = z.object({ threadId: threadIdSchema, id: threadIdSchema }).strict();
const okSchema = z.object({ ok: z.literal(true) });

export const rpcContract = defineRpcContract({
  threadInfo: {
    input: z.object({ threadId: threadIdSchema }).strict(),
    output: z
      .object({
        persona: z.string(),
        name: z.string().nullable(),
        trait: z.string().nullable(),
        parentThreadId: z.string(),
      })
      .nullable(),
  },
  listMinions: {
    input: z.object({ threadId: threadIdSchema }).strict(),
    output: z.object({ minions: z.array(minionRowSchema) }),
  },
  minionCounts: {
    input: z.object({ threadId: threadIdSchema }).strict(),
    output: z.object({
      running: z.number(),
      waiting: z.number(),
      done: z.number(),
      failed: z.number(),
    }),
  },
  listAgents: {
    input: z.object({ threadId: threadIdSchema }).strict(),
    output: z.object({
      agents: z.array(
        z.object({
          name: z.string(),
          description: z.string(),
          provider: z.string().nullable(),
          model: z.string().nullable(),
        }),
      ),
      warnings: z.array(personaWarningSchema),
    }),
  },
  showMinion: {
    input: minionTarget,
    output: z.object({ status: z.string(), output: z.string().nullable() }),
  },
  spawnMinion: {
    input: z
      .object({
        threadId: threadIdSchema,
        task: taskSchema.shape.task,
        agent: taskSchema.shape.agent,
        environment: taskSchema.shape.environment,
      })
      .strict(),
    output: outcomeSchema,
  },
  stop: { input: minionTarget, output: okSchema },
  archive: { input: minionTarget, output: okSchema },
  tell: {
    input: minionTarget.extend({ text: z.string().trim().min(1).max(20_000) }).strict(),
    output: okSchema,
  },
});

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function formatOutcome(outcome: SpawnOutcome): string {
  if (!outcome.ok) return `- failed "${clip(outcome.task, 60)}": ${outcome.error}`;
  return `- ${outcome.name} (${outcome.persona}): thread ${outcome.id}, model ${outcome.model}, ${outcome.environment} environment`;
}

function formatSpawn(outcomes: SpawnOutcome[]) {
  const started = outcomes.filter((outcome) => outcome.ok).length;
  const text = [
    `Started ${started} of ${outcomes.length} minions.`,
    ...outcomes.map(formatOutcome),
    "",
    started > 0
      ? "bb reports each minion to this thread on its own. A completed minion's report includes its answer, cut at 4,000 characters; a failed or interrupted minion, or one that needs help, comes as a status notice without an answer; reports that arrive within about 2 seconds of each other come as one list without answers. Do not poll; use show_minion to read a full answer."
      : "No minion started. Fix the errors above and spawn again.",
  ].join("\n");
  return { content: [{ type: "text" as const, text }], isError: started === 0 };
}

function formatRow(row: MinionRow): string {
  const status = row.needsInput ? "waiting for input" : row.status;
  const progress = row.progress
    ? ` · quests ${row.progress.done}/${row.progress.total}${row.progress.current ? `: ${clip(row.progress.current, 60)}` : ""}`
    : "";
  const who = row.name ? `${row.name} (${row.persona})` : row.persona;
  return `- ${row.id} · ${who} · ${status} · ${row.model}${progress} · ${clip(row.task, TASK_LIMIT)}`;
}

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const refresh = createInvalidator(bb);

  bb.agents.registerTool({
    name: "spawn",
    description:
      "Start one to eight minions as bb child threads of this thread, each with an optional persona, model, thinking level and shared or worktree environment. Returns at once with one line per task; bb reports each minion to this thread when it completes, fails or needs help.",
    instructions:
      "spawn returns immediately. NEVER poll list_minions or show_minion while minions run: bb sends each minion's result to this thread on its own.",
    presentation: { label: { pending: "Starting minions", completed: "Started minions" } },
    parameters: z.object({ tasks: z.array(taskSchema).min(1).max(MAX_TASKS) }).strict(),
    async execute({ tasks }, { threadId, signal }) {
      const outcomes = await spawnBatch(bb, threadId, tasks, signal);
      if (outcomes.some((outcome) => outcome.ok)) refresh(threadId);
      return formatSpawn(outcomes);
    },
  });

  bb.agents.registerTool({
    name: "list_agents",
    description: "List the personas a spawn task can name in its agent field.",
    presentation: { label: { pending: "Listing personas", completed: "Listed personas" } },
    parameters: z.object({}).strict(),
    async execute(_params, { threadId }) {
      const { agents, warnings } = await listPersonas(bb, threadId);
      const listed =
        agents.length === 0
          ? "No personas found. Omit agent to start a general-purpose minion."
          : agents
              .map((persona) => {
                const details = [
                  persona.provider ? `provider ${persona.provider}` : null,
                  persona.model ? `model ${persona.model}` : null,
                ].filter(Boolean);
                const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
                return `- ${persona.name}: ${clip(persona.description, DESCRIPTION_LIMIT)}${suffix}`;
              })
              .join("\n");
      return warnings.length > 0 ? `${listed}\n\n${formatPersonaWarnings(warnings)}` : listed;
    },
  });

  bb.agents.registerTool({
    name: "list_minions",
    description: "List this thread's minions with their status, model and quest progress.",
    presentation: { label: { pending: "Listing minions", completed: "Listed minions" } },
    parameters: z.object({}).strict(),
    async execute(_params, { threadId }) {
      const rows = await listMinions(bb, threadId);
      return rows.length === 0 ? "This thread has no minions." : rows.map(formatRow).join("\n");
    },
  });

  bb.agents.registerTool({
    name: "show_minion",
    description: "Show one of this thread's minions: its status and full final answer.",
    presentation: { label: { pending: "Reading minion", completed: "Read minion" } },
    parameters: z.object({ id: threadIdSchema.describe("The minion's thread id.") }).strict(),
    async execute({ id }, { threadId }) {
      const { status, output } = await showMinion(bb, threadId, id);
      return `Minion ${id} is ${status}.\n\n${output ?? "(no answer yet)"}`;
    },
  });

  bb.agents.registerTool({
    name: "halt",
    description:
      "Stop one of this thread's minions by thread id, or every running minion with id 'all'.",
    presentation: { label: { pending: "Stopping minions", completed: "Stopped minions" } },
    parameters: z.object({ id: threadIdSchema.describe("A minion thread id, or 'all'.") }).strict(),
    async execute({ id }, { threadId }) {
      if (id === "all") {
        const count = await stopAllMinions(bb, threadId);
        refresh(threadId);
        return `Stopped ${count} running minion${count === 1 ? "" : "s"}. ${STOPPED_NOTE}`;
      }
      await stopMinion(bb, threadId, id);
      refresh(threadId);
      return `Stopped minion ${id}. ${STOPPED_NOTE}`;
    },
  });

  // spawnBatch makes the authoritative delegation check; here metadata only picks the persona and hides spawn.
  bb.agents.configure((context) => {
    const isMinion = context.origin.kind === null && context.origin.pluginId === bb.pluginId;
    if (!isMinion) return { tools: ALL_TOOLS, skills: SKILLS };
    const metadata = parseMinionMetadata(context.pluginMetadata);
    if (!metadata) {
      return {
        tools: CHILD_TOOLS,
        skills: SKILLS,
        instructions: `${identityLine({ persona: EPHEMERAL_PERSONA })} This minion's metadata is missing or malformed, so it may not spawn minions.`,
      };
    }
    const tools = mayDelegate(metadata) ? ALL_TOOLS : CHILD_TOOLS;
    if (metadata.personaPath === null) {
      return { tools, skills: SKILLS, instructions: identityLine(metadata) };
    }
    try {
      const body = readPersonaBody(metadata.personaPath, context.environment.path);
      const instructions = personaInstructions(metadata, body) ?? identityLine(metadata);
      return { tools, skills: SKILLS, instructions };
    } catch (err) {
      bb.log.warn(
        `persona file unavailable for ${context.thread.id}: ${err instanceof Error ? err.message : err}`,
      );
      return {
        tools: CHILD_TOOLS,
        skills: SKILLS,
        instructions: `${identityLine(metadata)} Its persona file could not be read, so follow the task as written; delegation is disabled.`,
      };
    }
  });

  bb.rpc.register(rpcContract, {
    threadInfo: ({ threadId }) => getMinionIdentity(bb, threadId),
    listMinions: async ({ threadId }) => ({ minions: await listMinions(bb, threadId) }),
    minionCounts: ({ threadId }) => countMinions(bb, threadId),
    listAgents: async ({ threadId }) => {
      const { agents, warnings } = await listPersonas(bb, threadId);
      return {
        agents: agents.map((persona) => ({
          name: persona.name,
          description: persona.description,
          provider: persona.provider ?? null,
          model: persona.model ?? null,
        })),
        warnings,
      };
    },
    showMinion: ({ threadId, id }) => showMinion(bb, threadId, id),
    spawnMinion: async ({ threadId, ...task }) => {
      const [outcome] = await spawnBatch(bb, threadId, [task]);
      if (outcome.ok) refresh(threadId);
      return outcome;
    },
    stop: async ({ threadId, id }) => {
      await stopMinion(bb, threadId, id);
      refresh(threadId);
      return { ok: true as const };
    },
    archive: async ({ threadId, id }) => {
      await archiveMinion(bb, threadId, id);
      refresh(threadId);
      return { ok: true as const };
    },
    tell: async ({ threadId, id, text }) => {
      await tellMinion(bb, threadId, id, text);
      refresh(threadId);
      return { ok: true as const };
    },
  });

  registerMinionEvents(bb, refresh);
}
