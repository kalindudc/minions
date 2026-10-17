import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveMinion,
  countMinions,
  createInvalidator,
  getMinionIdentity,
  INVALIDATE_DELAY_MS,
  listMinions,
  registerMinionEvents,
  showMinion,
  stopAllMinions,
  stopMinion,
  tellMinion,
} from "../../extensions/bb/state.js";
import {
  addMinion,
  addThread,
  createBbHost,
  makeWorld,
  PARENT_ID,
  PLUGIN_ID,
  type World,
} from "./helpers/bb-world.js";

let world: World;

beforeEach(() => {
  world = makeWorld(null);
});

describe("listing a thread's minions", () => {
  it("lists only this thread's own minion children with name, trait, status, model, progress and preview", async () => {
    const a = addMinion(world, "th_a", {
      persona: "researcher",
      status: "active",
      metadata: { name: "Rex", trait: "dramatic" },
    });
    const b = addMinion(world, "th_b", { status: "idle" });
    world.outputs.set("th_b", "Done: found 3 bugs");
    world.quests.set("th_a", {
      progress: { done: 2, total: 5, current: "Read the code" },
      log: { quests: [{ id: "q1" }] },
      pendingUserChanges: ["toggle q1"],
    });
    addMinion(world, "th_fork", { thread: { originKind: "fork" } });
    addThread(world, { id: "th_plain", parentThreadId: PARENT_ID });
    addMinion(world, "th_forged", { thread: { originPluginId: null } });
    addMinion(world, "th_elsewhere_child", { parent: "th_elsewhere" });
    const { bb } = createBbHost(world);

    const rows = await listMinions(bb, PARENT_ID);

    expect(rows).toEqual([
      {
        id: "th_a",
        title: a.title,
        persona: "researcher",
        name: "Rex",
        trait: "dramatic",
        task: "task for th_a",
        status: "active",
        providerId: "pi",
        model: "openai/gpt-6-luna",
        createdAt: a.createdAt,
        needsInput: false,
        progress: { done: 2, total: 5, current: "Read the code" },
        outputPreview: null,
      },
      {
        id: "th_b",
        title: b.title,
        persona: "minion",
        name: null,
        trait: null,
        task: "task for th_b",
        status: "idle",
        providerId: "pi",
        model: "openai/gpt-6-luna",
        createdAt: b.createdAt,
        needsInput: false,
        progress: null,
        outputPreview: "Done: found 3 bugs",
      },
    ]);
  });

  it("flags minions waiting for input and keeps failed ones", async () => {
    addMinion(world, "th_wait", { thread: { hasPendingInteraction: true } });
    addMinion(world, "th_failed", { status: "error" });
    const { bb } = createBbHost(world);

    const rows = await listMinions(bb, PARENT_ID);

    expect(rows.map(({ id, status, needsInput }) => ({ id, status, needsInput }))).toEqual([
      { id: "th_wait", status: "idle", needsInput: true },
      { id: "th_failed", status: "error", needsInput: false },
    ]);
  });

  it("drops archived minions from the active list", async () => {
    addMinion(world, "th_a");
    addMinion(world, "th_b");
    const { bb } = createBbHost(world);

    await archiveMinion(bb, PARENT_ID, "th_a");

    expect((await listMinions(bb, PARENT_ID)).map((row) => row.id)).toEqual(["th_b"]);
  });

  it("shows no progress when the quests namespace has no valid progress object", async () => {
    addMinion(world, "th_a");
    world.quests.set("th_a", { progress: { done: "two", total: 5, current: null } });
    const { bb } = createBbHost(world);

    expect((await listMinions(bb, PARENT_ID))[0]?.progress).toBeNull();
  });

  it("cuts a long output preview", async () => {
    addMinion(world, "th_a");
    world.outputs.set("th_a", "x".repeat(5000));
    const { bb } = createBbHost(world);

    const preview = (await listMinions(bb, PARENT_ID))[0]?.outputPreview ?? "";

    expect(preview.length).toBeLessThanOrEqual(300);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("pages through every child and reads metadata in batches of at most 200 threads", async () => {
    for (let index = 0; index < 250; index += 1) addMinion(world, `th_${index}`);
    const { bb, harness } = createBbHost(world);

    const rows = await listMinions(bb, PARENT_ID);

    expect(rows).toHaveLength(250);
    const batches = harness.inspection.sdk
      .callsTo("threads.experimental_listPluginMetadata")
      .map(([args]) => args as { threadIds: string[]; pluginId: string });
    expect(batches.map((args) => `${args.pluginId}:${args.threadIds.length}`).sort()).toEqual([
      `${PLUGIN_ID}:200`,
      `${PLUGIN_ID}:50`,
      "quests:200",
      "quests:50",
    ]);
  });
});

describe("acting on a minion", () => {
  it("shows a minion's status and full output to its parent, capped with a notice", async () => {
    addMinion(world, "th_a", { status: "idle" });
    world.outputs.set("th_a", "y".repeat(60_000));
    const { bb } = createBbHost(world);

    const shown = await showMinion(bb, PARENT_ID, "th_a");

    expect(shown.status).toBe("idle");
    expect(shown.output?.startsWith("y".repeat(50_000))).toBe(true);
    expect(shown.output).toContain("truncated");
    expect(shown.output).not.toContain("y".repeat(50_001));
  });

  it("stops, archives and messages an owned minion through bb", async () => {
    addMinion(world, "th_a", { status: "active" });
    const { bb, harness } = createBbHost(world);

    await stopMinion(bb, PARENT_ID, "th_a");
    await tellMinion(bb, PARENT_ID, "th_a", "Also check the tests");
    await archiveMinion(bb, PARENT_ID, "th_a");

    expect(harness.inspection.sdk.callsTo("threads.stop")).toEqual([[{ threadId: "th_a" }]]);
    expect(harness.inspection.sdk.callsTo("threads.send")).toEqual([
      [
        {
          threadId: "th_a",
          mode: "auto",
          input: [{ type: "text", text: "Also check the tests", mentions: [] }],
        },
      ],
    ]);
    expect(harness.inspection.sdk.callsTo("threads.archive")).toEqual([[{ threadId: "th_a" }]]);
  });

  it("refuses to act on a thread that is not one of this thread's minions", async () => {
    addMinion(world, "th_elsewhere_child", { parent: "th_elsewhere" });
    addThread(world, { id: "th_plain", parentThreadId: PARENT_ID });
    addMinion(world, "th_fork", { thread: { originKind: "fork" } });
    addMinion(world, "th_forged", { thread: { originPluginId: null } });
    const { bb, harness } = createBbHost(world);

    for (const id of ["th_elsewhere_child", "th_plain", "th_fork", "th_forged"]) {
      await expect(showMinion(bb, PARENT_ID, id)).rejects.toThrow(/not a minion of this thread/);
      await expect(stopMinion(bb, PARENT_ID, id)).rejects.toThrow(/not a minion of this thread/);
      await expect(archiveMinion(bb, PARENT_ID, id)).rejects.toThrow(/not a minion/);
      await expect(tellMinion(bb, PARENT_ID, id, "hi")).rejects.toThrow(/not a minion/);
    }
    expect(harness.inspection.sdk.callsTo("threads.output")).toHaveLength(0);
    expect(harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(0);
    expect(harness.inspection.sdk.callsTo("threads.archive")).toHaveLength(0);
    expect(harness.inspection.sdk.callsTo("threads.send")).toHaveLength(0);
  });

  it("stops every running minion and reports how many it stopped", async () => {
    addMinion(world, "th_active", { status: "active" });
    addMinion(world, "th_idle", { status: "idle" });
    addMinion(world, "th_starting", { status: "starting" });
    const { bb, harness } = createBbHost(world);

    const count = await stopAllMinions(bb, PARENT_ID);

    expect(count).toBe(2);
    expect(harness.inspection.sdk.callsTo("threads.stop")).toEqual([
      [{ threadId: "th_active" }],
      [{ threadId: "th_starting" }],
    ]);
  });
});

describe("minion identity", () => {
  it("identifies a minion thread's persona, name, trait and parent", async () => {
    addMinion(world, "th_a", {
      persona: "researcher",
      metadata: { name: "Rex", trait: "dramatic" },
    });
    const { bb } = createBbHost(world);

    expect(await getMinionIdentity(bb, "th_a")).toEqual({
      persona: "researcher",
      name: "Rex",
      trait: "dramatic",
      parentThreadId: PARENT_ID,
    });
  });

  it("reports no name or trait for a minion started before minions had them", async () => {
    addMinion(world, "th_old", { persona: "researcher" });
    const { bb } = createBbHost(world);

    expect(await getMinionIdentity(bb, "th_old")).toEqual({
      persona: "researcher",
      name: null,
      trait: null,
      parentThreadId: PARENT_ID,
    });
  });

  it("returns null for ordinary threads, forks, malformed metadata and threads bb did not create for this plugin", async () => {
    addMinion(world, "th_fork", { thread: { originKind: "fork" } });
    addMinion(world, "th_bad", { metadata: { depth: 7 } });
    addMinion(world, "th_forged", { thread: { originPluginId: null } });
    const { bb } = createBbHost(world);

    expect(await getMinionIdentity(bb, PARENT_ID)).toBeNull();
    expect(await getMinionIdentity(bb, "th_fork")).toBeNull();
    expect(await getMinionIdentity(bb, "th_bad")).toBeNull();
    expect(await getMinionIdentity(bb, "th_forged")).toBeNull();
  });
});

describe("counting a thread's minions", () => {
  it("counts running, waiting, done and failed minions without reading answers or quest progress", async () => {
    addMinion(world, "th_active", { status: "active" });
    addMinion(world, "th_starting", { status: "starting" });
    addMinion(world, "th_stopping", { status: "stopping" });
    addMinion(world, "th_waiting", { status: "active", thread: { hasPendingInteraction: true } });
    addMinion(world, "th_done", { status: "idle" });
    addMinion(world, "th_failed", { status: "error" });
    addMinion(world, "th_forged", { status: "active", thread: { originPluginId: null } });
    addThread(world, { id: "th_plain", parentThreadId: PARENT_ID, status: "active" });
    const { bb, harness } = createBbHost(world);

    const counts = await countMinions(bb, PARENT_ID);

    expect(counts).toEqual({ running: 3, waiting: 1, done: 1, failed: 1 });
    expect(harness.inspection.sdk.callsTo("threads.output")).toHaveLength(0);
    const metadataReads = harness.inspection.sdk
      .callsTo("threads.experimental_listPluginMetadata")
      .map(([args]) => (args as { pluginId: string }).pluginId);
    expect(metadataReads).not.toContain("quests");
  });
});

describe("live updates for the Minions views", () => {
  const invalidations = (harness: ReturnType<typeof createBbHost>["harness"]) =>
    harness.inspection.realtimeSignals
      .filter((signal) => signal.channel === "minions")
      .map((signal) => signal.payload);

  function watch(host: ReturnType<typeof createBbHost>) {
    registerMinionEvents(host.bb, createInvalidator(host.bb));
  }

  const emit = (harness: ReturnType<typeof createBbHost>["harness"], thread: unknown) =>
    harness.behavior.emitThreadEvent("thread.idle", { thread, lastAssistantText: null } as any);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks every open Minions view to refetch at once when the plugin starts", () => {
    const host = createBbHost(world);

    watch(host);

    expect(invalidations(host.harness)).toEqual([{ threadId: null }]);
  });

  it.each([
    "thread.created",
    "thread.active",
    "thread.idle",
    "thread.failed",
    "thread.archived",
    "thread.unarchived",
    "thread.deleted",
    "interaction.pending",
  ] as const)("tells the parent's view to refetch shortly after a minion's %s event", async (event) => {
    const minion = addMinion(world, "th_a");
    const host = createBbHost(world);
    watch(host);

    const { errors } = await host.harness.behavior.emitThreadEvent(event, {
      thread: minion,
      lastAssistantText: null,
      error: null,
      interaction: {},
    } as any);
    expect(invalidations(host.harness)).toEqual([{ threadId: null }]);
    vi.advanceTimersByTime(INVALIDATE_DELAY_MS);

    expect(errors).toEqual([]);
    expect(invalidations(host.harness)).toEqual([{ threadId: null }, { threadId: PARENT_ID }]);
  });

  it("coalesces a burst of minion events into one refetch per parent", async () => {
    const a = addMinion(world, "th_a");
    const b = addMinion(world, "th_b");
    addThread(world, { id: "th_other_parent" });
    const c = addMinion(world, "th_c", { parent: "th_other_parent" });
    const host = createBbHost(world);
    watch(host);

    for (const thread of [a, b, a, c, b]) await emit(host.harness, thread);
    vi.advanceTimersByTime(INVALIDATE_DELAY_MS);
    await emit(host.harness, a);
    vi.advanceTimersByTime(INVALIDATE_DELAY_MS);

    expect(invalidations(host.harness)).toEqual([
      { threadId: null },
      { threadId: PARENT_ID },
      { threadId: "th_other_parent" },
      { threadId: PARENT_ID },
    ]);
  });

  it("drops a pending refetch when the plugin unloads", async () => {
    const minion = addMinion(world, "th_a");
    const host = createBbHost(world);
    watch(host);

    await emit(host.harness, minion);
    await host.harness.lifecycle.dispose();

    expect(() => vi.advanceTimersByTime(INVALIDATE_DELAY_MS)).not.toThrow();
    expect(invalidations(host.harness)).toEqual([{ threadId: null }]);
  });

  it("stays quiet for threads that are not this plugin's minions", async () => {
    const plain = addThread(world, { id: "th_plain", parentThreadId: PARENT_ID });
    const fork = addMinion(world, "th_fork", { thread: { originKind: "fork" } });
    const forged = addMinion(world, "th_forged", { thread: { originPluginId: null } });
    const host = createBbHost(world);
    watch(host);

    for (const thread of [plain, fork, forged, world.threads.get(PARENT_ID)!]) {
      await emit(host.harness, thread);
    }
    vi.advanceTimersByTime(INVALIDATE_DELAY_MS);

    expect(invalidations(host.harness)).toEqual([{ threadId: null }]);
  });
});
