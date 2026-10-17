import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";

export const PLUGIN_ID = "pi-minions";
export const PARENT_ID = "th_parent";

export type Thread = ReturnType<typeof makeThreadResponse> & { hasPendingInteraction?: boolean };

export interface CatalogModel {
  id: string;
  reasoning?: string[];
  defaultReasoning?: string;
}

export interface Catalog {
  models: CatalogModel[];
  permissionCeiling?: "accept-edits" | "auto" | "full";
  modelLoadError?: { code: string; detail: string | null; providerId: string } | null;
}

export interface World {
  threads: Map<string, Thread>;
  metadata: Map<string, Record<string, unknown>>;
  quests: Map<string, Record<string, unknown>>;
  outputs: Map<string, string | null>;
  catalogs: Record<string, Catalog>;
  defaults: { model: string; reasoningLevel: string; permissionMode: string } | null;
  environment: {
    id: string;
    hostId: string;
    isGitRepo: boolean;
    branchName: string | null;
    path: string | null;
  } | null;
  failSpawnsFor: Set<string>;
}

export function makeWorld(cwd: string | null): World {
  const world: World = {
    threads: new Map(),
    metadata: new Map(),
    quests: new Map(),
    outputs: new Map(),
    catalogs: {
      pi: {
        models: [
          {
            id: "openai/gpt-6-luna",
            reasoning: ["low", "medium", "high"],
            defaultReasoning: "low",
          },
          {
            id: "anthropic/claude-x",
            reasoning: ["none", "low", "medium", "high", "xhigh"],
            defaultReasoning: "high",
          },
        ],
        permissionCeiling: "full",
      },
      codex: {
        models: [
          {
            id: "gpt-5.2",
            reasoning: ["low", "medium", "high", "xhigh"],
            defaultReasoning: "high",
          },
        ],
      },
    },
    defaults: { model: "openai/gpt-6-luna", reasoningLevel: "medium", permissionMode: "auto" },
    environment: { id: "env_1", hostId: "host_1", isGitRepo: true, branchName: "main", path: cwd },
    failSpawnsFor: new Set(),
  };
  addThread(world, { id: PARENT_ID, providerId: "pi", environmentId: "env_1" });
  return world;
}

export function addThread(world: World, overrides: Partial<Thread>): Thread {
  const thread = { ...makeThreadResponse(overrides), ...overrides } as Thread;
  world.threads.set(thread.id, thread);
  return thread;
}

export function addMinion(
  world: World,
  id: string,
  options: {
    parent?: string;
    persona?: string;
    status?: Thread["status"];
    metadata?: Record<string, unknown>;
    thread?: Partial<Thread>;
  } = {},
): Thread {
  const parent = options.parent ?? PARENT_ID;
  const thread = addThread(world, {
    id,
    parentThreadId: parent,
    lifecycleOwnerThreadId: parent,
    originPluginId: PLUGIN_ID,
    providerId: "pi",
    status: options.status ?? "idle",
    title: `${options.persona ?? "minion"} · task for ${id}`,
    createdAt: world.threads.size,
    ...options.thread,
  });
  world.metadata.set(id, {
    persona: options.persona ?? "minion",
    personaPath: null,
    depth: 1,
    delegate: false,
    batchId: "batch-1",
    providerId: "pi",
    model: "openai/gpt-6-luna",
    task: `task for ${id}`,
    environment: "shared",
    ...options.metadata,
  });
  return thread;
}

function catalogResponse(catalog: Catalog | undefined, providerId: string) {
  if (!catalog) {
    return {
      modelLoadError: { code: "provider_unavailable", detail: null, providerId },
      models: [],
      permissionCeiling: "full",
      providers: [],
    };
  }
  return {
    modelLoadError: catalog.modelLoadError ?? null,
    // bb rejects a catalog model without reasoning levels or whose default is not one of them.
    models: catalog.models.map((model) => {
      const levels = model.reasoning ?? ["medium"];
      return {
        id: model.id,
        model: model.id,
        displayName: model.id,
        description: "",
        isDefault: false,
        defaultReasoningEffort: model.defaultReasoning ?? levels[0],
        supportedReasoningEfforts: levels.map((reasoningEffort) => ({
          reasoningEffort,
          description: reasoningEffort,
        })),
      };
    }),
    permissionCeiling: catalog.permissionCeiling ?? "full",
    providers: [],
  };
}

function requireThread(world: World, threadId: string): Thread {
  const thread = world.threads.get(threadId);
  if (!thread) throw new Error(`Thread ${threadId} not found`);
  return thread;
}

export function createBbHost(world: World) {
  let spawned = 0;
  return createFakePluginHost({
    pluginId: PLUGIN_ID,
    agentSkillIds: ["minions"],
    sdk: {
      threads: {
        get: async ({ threadId }) => requireThread(world, threadId),
        getPluginMetadata: async ({ threadId }) => world.metadata.get(threadId) ?? {},
        experimental_listPluginMetadata: async ({ threadIds, pluginId }) => {
          const source = pluginId === "quests" ? world.quests : world.metadata;
          return {
            threads: threadIds
              .filter((threadId) => source.has(threadId))
              .map((threadId) => ({ threadId, metadata: source.get(threadId) })),
          };
        },
        defaultExecutionOptions: async () =>
          world.defaults && {
            ...world.defaults,
            serviceTier: "default",
            source: "client/turn/start",
          },
        list: async (args) => {
          const { parentThreadId, limit = 50, offset = 0 } = args ?? {};
          return [...world.threads.values()]
            .filter((thread) => thread.parentThreadId === parentThreadId)
            .filter((thread) => thread.archivedAt === null)
            .sort((a, b) => a.createdAt - b.createdAt)
            .slice(offset, offset + limit)
            .map((thread) => ({ hasPendingInteraction: false, ...thread }));
        },
        output: async ({ threadId }) => ({ output: world.outputs.get(threadId) ?? null }),
        spawn: async (args) => {
          if ([...world.failSpawnsFor].some((marker) => args.prompt?.includes(marker))) {
            throw new Error("spawn exploded");
          }
          spawned += 1;
          const id = `th_child_${spawned}`;
          const thread = addThread(world, {
            id,
            parentThreadId: args.parentThreadId ?? null,
            lifecycleOwnerThreadId: args.lifecycleOwnerThreadId ?? null,
            originPluginId: PLUGIN_ID,
            providerId: args.providerId ?? "pi",
            status: "starting",
            title: args.title ?? null,
            createdAt: 1000 + spawned,
          });
          if (args.pluginMetadata) world.metadata.set(id, args.pluginMetadata);
          return thread;
        },
        stop: async ({ threadId }) => {
          requireThread(world, threadId).status = "idle";
          return { ok: true };
        },
        archive: async ({ threadId }) => {
          requireThread(world, threadId).archivedAt = Date.now();
          return { archivedThreadIds: [threadId] };
        },
        send: async () => ({ ok: true, delivery: "sent" }),
      },
      environments: {
        get: async () => {
          if (!world.environment) throw new Error("Environment not found");
          return world.environment;
        },
      },
      providers: {
        models: async (args) =>
          catalogResponse(world.catalogs[args?.providerId ?? ""], args?.providerId ?? ""),
      },
    },
  });
}

export function spawnCalls(harness: ReturnType<typeof createBbHost>["harness"]) {
  return harness.inspection.sdk.callsTo("threads.spawn").map((args) => args[0] as any);
}
