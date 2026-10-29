import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  describePersonaWarning,
  discoverAgents,
  isAllowedPersonaPath,
  skippedPersona,
} from "../../src/agents.js";
import type { AgentConfig, PersonaWarning, ThinkingLevel } from "../../src/types.js";
import { isOwnMinion, MAX_DEPTH, type MinionMetadata, parseMinionMetadata } from "./metadata.js";
import { personalityLine, pickName, pickTrait } from "./personality.js";
import { minionNamesInUse } from "./state.js";

export const MAX_TASKS = 8;
export const EPHEMERAL_PERSONA = "minion";
const INSTRUCTION_LIMIT = 4096;
const CHOICE_LIMIT = 20;
const FINAL_ANSWER_REQUEST =
  "When you are done, reply with your complete final answer in your last message. " +
  "The parent thread receives only that message, so include every result it needs.";

export type SpawnTask = {
  task: string;
  agent?: string;
  model?: string;
  thinking?: ThinkingLevel;
  environment?: "shared" | "worktree";
};

export type SpawnOutcome =
  | {
      ok: true;
      id: string;
      name: string;
      persona: string;
      model: string;
      environment: "shared" | "worktree";
    }
  | { ok: false; task: string; error: string };

export type MinionIdentity = Pick<MinionMetadata, "persona" | "name" | "trait">;

type Bb = BbPluginApi;
type Thread = Awaited<ReturnType<Bb["sdk"]["threads"]["get"]>>;
type Environment = Awaited<ReturnType<Bb["sdk"]["environments"]["get"]>>;
type Catalog = Awaited<ReturnType<Bb["sdk"]["providers"]["models"]>>;
type CatalogModel = Catalog["models"][number];
type ExecutionDefaults = Awaited<ReturnType<Bb["sdk"]["threads"]["defaultExecutionOptions"]>>;
type SpawnEnvironment = Parameters<Bb["sdk"]["threads"]["spawn"]>[0]["environment"];
type Permission = NonNullable<AgentConfig["permission"]>;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function listChoices(values: readonly string[]): string {
  if (values.length === 0) return "none";
  const shown = values.slice(0, CHOICE_LIMIT).join(", ");
  return values.length > CHOICE_LIMIT ? `${shown} and ${values.length - CHOICE_LIMIT} more` : shown;
}

export function identityLine({ persona, name, trait }: MinionIdentity): string {
  const who = name ? `You are ${JSON.stringify(name)}, a bb minion` : "You are a bb minion";
  const line =
    `${who}: a child thread working as the persona ${JSON.stringify(persona)} ` +
    "for a parent thread, which receives your final message automatically.";
  const personality = personalityLine(trait);
  return personality === null ? line : `${line} ${personality}`;
}

export function personaInstructions(identity: MinionIdentity, body: string): string | null {
  const text = body ? `${identityLine(identity)}\n\n${body}` : identityLine(identity);
  return text.length <= INSTRUCTION_LIMIT ? text : null;
}

function personaCwd(environment: Environment | null): string | null {
  const path = environment?.path;
  return path && existsSync(path) ? path : null;
}

type Personas = { agents: AgentConfig[]; warnings: PersonaWarning[] };

const loggedWarnings = new WeakMap<Bb, Set<string>>();

function discoverPersonas(bb: Bb, cwd: string | null): Personas {
  const { agents, warnings } = discoverAgents(cwd ?? homedir(), cwd ? "both" : "user");
  let logged = loggedWarnings.get(bb);
  if (!logged) {
    logged = new Set();
    loggedWarnings.set(bb, logged);
  }
  for (const warning of warnings) {
    const text = describePersonaWarning(warning);
    if (logged.has(text)) continue;
    logged.add(text);
    bb.log.warn(`Skipped persona file ${text}`);
  }
  return { agents, warnings };
}

export async function listPersonas(bb: Bb, threadId: string): Promise<Personas> {
  const thread = await bb.sdk.threads.get({ threadId });
  const environment = thread.environmentId
    ? await bb.sdk.environments.get({ environmentId: thread.environmentId })
    : null;
  return discoverPersonas(bb, personaCwd(environment));
}

export function matchModel(reference: string, models: readonly { id: string }[]): string {
  const wanted = reference.trim();
  if (!wanted) throw new Error("Model is empty.");
  if (models.some((model) => model.id === wanted)) return wanted;
  const suffixed = models
    .filter((model) => model.id.endsWith(`/${wanted}`))
    .map((model) => model.id);
  if (suffixed.length === 1) return suffixed[0];
  if (suffixed.length > 1) {
    throw new Error(`Model "${wanted}" is ambiguous: ${listChoices(suffixed)}.`);
  }
  const available = listChoices(models.map((model) => model.id));
  throw new Error(`Model "${wanted}" is not available. Available: ${available}.`);
}

const THINKING_REASONING: Record<ThinkingLevel, string> = {
  off: "none",
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
};

const PERMISSION_RANK: Record<Permission, number> = { "accept-edits": 0, auto: 1, full: 2 };

type Persona = { config: AgentConfig | null; name: string; body: string };

type Batch = {
  bb: Bb;
  caller: Thread;
  environment: Environment;
  defaults: ExecutionDefaults | Error;
  personas: Personas | Error;
  personaCwd: string | null;
  catalogs: Map<string, Promise<Catalog>>;
  batchId: string;
  depth: number;
  names: Set<string>;
};

function resolvePersona(
  agent: string | undefined,
  personas: Personas | Error,
  cwd: string | null,
): Persona {
  if (agent === undefined) {
    return { config: null, name: EPHEMERAL_PERSONA, body: "" };
  }
  if (personas instanceof Error) throw personas;
  const config = personas.agents.find((persona) => persona.name === agent);
  if (!config) {
    const skipped = skippedPersona(personas.warnings, agent);
    if (skipped)
      throw new Error(`Persona "${agent}" was skipped: ${describePersonaWarning(skipped)}`);
    const available = listChoices(personas.agents.map((persona) => persona.name));
    throw new Error(`Unknown persona "${agent}". Available: ${available}.`);
  }
  if (!isAllowedPersonaPath(config.filePath, cwd)) {
    throw new Error(`Persona file ${config.filePath} resolves outside the agent directories.`);
  }
  return { config, name: config.name, body: config.systemPrompt };
}

function catalogFor(batch: Batch, providerId: string): Promise<Catalog> {
  let catalog = batch.catalogs.get(providerId);
  if (!catalog) {
    catalog = batch.bb.sdk.providers
      .models({ providerId, environmentId: batch.environment.id })
      .then((loaded) => {
        if (loaded.modelLoadError) {
          const { code, detail } = loaded.modelLoadError;
          throw new Error(`Could not load models for provider "${providerId}": ${detail ?? code}.`);
        }
        if (loaded.models.length === 0) {
          throw new Error(`Provider "${providerId}" has no models available.`);
        }
        return loaded;
      });
    batch.catalogs.set(providerId, catalog);
  }
  return catalog;
}

function inheritedModel(defaults: ExecutionDefaults | Error): string {
  if (defaults instanceof Error) {
    throw new Error(`Could not read this thread's default model: ${defaults.message}`);
  }
  if (!defaults) {
    throw new Error(
      "This thread has no default model to inherit; name a model or a persona with one.",
    );
  }
  return defaults.model;
}

function chooseModel(
  batch: Batch,
  task: SpawnTask,
  persona: Persona,
  catalog: Catalog,
  providerId: string,
) {
  const reference = task.model ?? persona.config?.model;
  let id: string;
  if (reference !== undefined) id = matchModel(reference, catalog.models);
  else if (providerId === batch.caller.providerId)
    id = matchModel(inheritedModel(batch.defaults), catalog.models);
  else id = (catalog.models.find((model) => model.isDefault) ?? catalog.models[0]).id;
  const model = catalog.models.find((candidate) => candidate.id === id);
  if (!model) throw new Error(`Model "${id}" is not available for provider "${providerId}".`);
  return model;
}

// Always name a level: left out, bb would resolve one itself, including remembered project defaults.
function chooseReasoning(
  task: SpawnTask,
  persona: Persona,
  inherited: string | undefined,
  model: CatalogModel,
): string {
  const supported = model.supportedReasoningEfforts.map((effort) => effort.reasoningEffort);
  const thinking = persona.config?.thinking;
  const requested =
    task.thinking !== undefined
      ? THINKING_REASONING[task.thinking]
      : (persona.config?.reasoning ?? (thinking ? THINKING_REASONING[thinking] : undefined));
  if (requested === undefined) {
    return inherited !== undefined && supported.includes(inherited)
      ? inherited
      : model.defaultReasoningEffort;
  }
  if (!supported.includes(requested)) {
    throw new Error(
      `Model "${model.id}" does not support reasoning "${requested}". Supported: ${listChoices(supported)}.`,
    );
  }
  return requested;
}

function choosePermission(persona: Persona, ceiling: Permission): Permission | undefined {
  const wanted = persona.config?.permission;
  if (wanted && PERMISSION_RANK[wanted] > PERMISSION_RANK[ceiling]) {
    throw new Error(
      `Persona permission "${wanted}" is above this host's permission ceiling "${ceiling}".`,
    );
  }
  return wanted;
}

function environmentFor(kind: "shared" | "worktree", environment: Environment): SpawnEnvironment {
  if (kind === "shared") return { type: "reuse", environmentId: environment.id };
  if (!environment.isGitRepo || !environment.hostId) {
    throw new Error(
      "A worktree minion needs a Git project on a known host; use the shared environment.",
    );
  }
  return {
    type: "host",
    hostId: environment.hostId,
    workspace: {
      type: "managed-worktree",
      baseBranch: environment.branchName
        ? { kind: "named", name: environment.branchName }
        : { kind: "default" },
    },
  };
}

async function spawnOne(batch: Batch, task: SpawnTask): Promise<SpawnOutcome> {
  const persona = resolvePersona(task.agent, batch.personas, batch.personaCwd);
  const providerId = persona.config?.provider ?? batch.caller.providerId;
  const catalog = await catalogFor(batch, providerId);
  const model = chooseModel(batch, task, persona, catalog, providerId);
  const inherited =
    providerId === batch.caller.providerId && batch.defaults && !(batch.defaults instanceof Error)
      ? batch.defaults.reasoningLevel
      : undefined;
  const reasoning = chooseReasoning(task, persona, inherited, model);
  const permission = choosePermission(persona, catalog.permissionCeiling);
  const name = pickName(persona.config?.displayName, batch.names);
  batch.names.add(name);
  const identity = { persona: persona.name, name, trait: pickTrait() };
  const environment = task.environment ?? persona.config?.environment ?? "shared";
  // configure checks the persona path against the minion's own environment, and a worktree minion
  // cannot vouch for a project persona in the caller's checkout, so that body travels in the prompt.
  const verifiable = persona.config?.source !== "project" || environment === "shared";
  const inPrompt =
    persona.body !== "" && (!verifiable || personaInstructions(identity, persona.body) === null);
  const request = `${task.task}\n\n${FINAL_ANSWER_REQUEST}`;
  const metadata: MinionMetadata = {
    ...identity,
    personaPath: verifiable ? (persona.config?.filePath ?? null) : null,
    depth: batch.depth,
    delegate: persona.config?.delegate === true,
    batchId: batch.batchId,
    providerId,
    model: model.id,
    task: task.task,
    environment,
  };

  const child = await batch.bb.sdk.threads.spawn({
    projectId: batch.caller.projectId,
    parentThreadId: batch.caller.id,
    lifecycleOwnerThreadId: batch.caller.id,
    environment: environmentFor(environment, batch.environment),
    providerId,
    model: model.id,
    reasoningLevel: reasoning,
    ...(permission ? { permissionMode: permission } : {}),
    title: `${name} · ${task.task.replace(/\s+/g, " ").trim().slice(0, 60)}`,
    prompt: inPrompt ? `${persona.body}\n\n${request}` : request,
    pluginMetadata: metadata,
  });
  return { ok: true, id: child.id, name, persona: persona.name, model: model.id, environment };
}

// Depth comes from the thread tree; metadata only says whether the minion's persona may delegate.
async function childDepth(bb: Bb, caller: Thread): Promise<number> {
  if (!isOwnMinion(bb, caller)) return 1;
  const metadata = parseMinionMetadata(
    await bb.sdk.threads.getPluginMetadata({ threadId: caller.id }),
  );
  if (!metadata) {
    throw new Error("This minion's metadata is missing or malformed, so it may not spawn minions.");
  }
  if (!metadata.delegate) {
    throw new Error("This minion may not spawn minions: its persona does not set delegate: true.");
  }
  if (caller.parentThreadId !== null) {
    const parent = await bb.sdk.threads.get({ threadId: caller.parentThreadId });
    if (isOwnMinion(bb, parent)) {
      throw new Error("This minion may not spawn minions: it is already two levels deep.");
    }
  }
  return MAX_DEPTH;
}

export async function spawnBatch(
  bb: Bb,
  callerThreadId: string,
  tasks: SpawnTask[],
  signal?: AbortSignal,
): Promise<SpawnOutcome[]> {
  if (tasks.length < 1 || tasks.length > MAX_TASKS) {
    throw new Error(`Pass one to eight tasks; got ${tasks.length}.`);
  }
  const caller = await bb.sdk.threads.get({ threadId: callerThreadId });
  if (!caller.canSpawnChild)
    throw new Error("bb does not allow this thread to spawn child threads.");
  const depth = await childDepth(bb, caller);
  if (!caller.environmentId) throw new Error("This thread has no environment to start minions in.");

  const environment = await bb.sdk.environments.get({ environmentId: caller.environmentId });
  const names = await minionNamesInUse(bb, caller.id);
  let defaults: ExecutionDefaults | Error;
  try {
    defaults = await bb.sdk.threads.defaultExecutionOptions({ threadId: callerThreadId });
  } catch (err) {
    defaults = new Error(message(err));
  }
  const cwd = personaCwd(environment);
  let personas: Personas | Error = { agents: [], warnings: [] };
  if (tasks.some((task) => task.agent !== undefined)) {
    try {
      personas = discoverPersonas(bb, cwd);
    } catch (err) {
      personas = new Error(message(err));
    }
  }

  const batch: Batch = {
    bb,
    caller,
    environment,
    defaults,
    personas,
    personaCwd: cwd,
    catalogs: new Map(),
    batchId: randomUUID().slice(0, 8),
    depth,
    names,
  };
  const outcomes: SpawnOutcome[] = [];
  for (const task of tasks) {
    if (signal?.aborted) {
      outcomes.push({ ok: false, task: task.task, error: "Cancelled before this minion started." });
      continue;
    }
    try {
      outcomes.push(await spawnOne(batch, task));
    } catch (err) {
      outcomes.push({ ok: false, task: task.task, error: message(err) });
    }
  }
  return outcomes;
}
