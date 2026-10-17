import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { isOwnMinion, type MinionMetadata, parseMinionMetadata } from "./spawn.js";

export const MINIONS_CHANNEL = "minions";
export const SHOW_LIMIT = 50_000;
export const INVALIDATE_DELAY_MS = 250;
const PAGE_SIZE = 100;
const METADATA_BATCH = 200;
const PREVIEW_LIMIT = 300;
const QUESTS_PLUGIN_ID = "quests";
const RUNNING = new Set(["active", "starting", "pending"]);
const BUSY = new Set([...RUNNING, "stopping"]);
const MINION_EVENTS = [
  "thread.created",
  "thread.active",
  "thread.idle",
  "thread.failed",
  "thread.archived",
  "thread.unarchived",
  "thread.deleted",
  "interaction.pending",
] as const;

export type QuestProgress = { done: number; total: number; current: string | null };

export type MinionCounts = { running: number; waiting: number; done: number; failed: number };

export type MinionRow = {
  id: string;
  title: string;
  persona: string;
  task: string;
  status: string;
  providerId: string;
  model: string;
  createdAt: number;
  needsInput: boolean;
  progress: QuestProgress | null;
  outputPreview: string | null;
};

type Bb = BbPluginApi;
type Thread = Awaited<ReturnType<Bb["sdk"]["threads"]["get"]>>;
type ThreadRow = Awaited<ReturnType<Bb["sdk"]["threads"]["list"]>>[number];

const questProgressSchema = z.object({
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  current: z.string().nullable(),
});

function isPlainChildOf(
  thread: Pick<Thread, "parentThreadId" | "originKind">,
  parentThreadId: string,
) {
  return thread.parentThreadId === parentThreadId && thread.originKind === null;
}

async function listChildren(bb: Bb, parentThreadId: string): Promise<ThreadRow[]> {
  const children: ThreadRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await bb.sdk.threads.list({
      parentThreadId,
      originPluginId: bb.pluginId,
      includeHidden: true,
      limit: PAGE_SIZE,
      offset,
    });
    children.push(...page);
    if (page.length < PAGE_SIZE) return children;
  }
}

async function readNamespace(bb: Bb, threadIds: string[], pluginId: string) {
  const found = new Map<string, unknown>();
  for (let start = 0; start < threadIds.length; start += METADATA_BATCH) {
    const { threads } = await bb.sdk.threads.experimental_listPluginMetadata({
      threadIds: threadIds.slice(start, start + METADATA_BATCH),
      pluginId,
    });
    for (const { threadId, metadata } of threads) found.set(threadId, metadata);
  }
  return found;
}

async function ownMinions(bb: Bb, parentThreadId: string) {
  const children = (await listChildren(bb, parentThreadId)).filter(
    (thread) =>
      isPlainChildOf(thread, parentThreadId) &&
      isOwnMinion(bb, thread) &&
      thread.archivedAt === null &&
      thread.deletedAt === null,
  );
  const metadata = await readNamespace(
    bb,
    children.map((thread) => thread.id),
    bb.pluginId,
  );
  return children.flatMap((thread) => {
    const parsed = parseMinionMetadata(metadata.get(thread.id));
    return parsed ? [{ thread, metadata: parsed }] : [];
  });
}

function preview(output: string | null): string | null {
  if (output === null) return null;
  const text = output.trim();
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT - 1)}…` : text;
}

function questProgress(questMetadata: unknown): QuestProgress | null {
  if (typeof questMetadata !== "object" || questMetadata === null) return null;
  const parsed = questProgressSchema.safeParse((questMetadata as { progress?: unknown }).progress);
  return parsed.success ? parsed.data : null;
}

export async function listMinions(bb: Bb, parentThreadId: string): Promise<MinionRow[]> {
  const minions = await ownMinions(bb, parentThreadId);
  const quests = await readNamespace(
    bb,
    minions.map(({ thread }) => thread.id),
    QUESTS_PLUGIN_ID,
  );
  return Promise.all(
    minions.map(async ({ thread, metadata }) => {
      const { output } = await bb.sdk.threads.output({ threadId: thread.id });
      return {
        id: thread.id,
        title: thread.title ?? thread.titleFallback ?? metadata.persona,
        persona: metadata.persona,
        task: metadata.task,
        status: thread.status,
        providerId: thread.providerId,
        model: metadata.model,
        createdAt: thread.createdAt,
        needsInput: thread.hasPendingInteraction,
        progress: questProgress(quests.get(thread.id)),
        outputPreview: preview(output),
      };
    }),
  );
}

export async function countMinions(bb: Bb, parentThreadId: string): Promise<MinionCounts> {
  const counts: MinionCounts = { running: 0, waiting: 0, done: 0, failed: 0 };
  for (const { thread } of await ownMinions(bb, parentThreadId)) {
    if (thread.hasPendingInteraction) counts.waiting += 1;
    else if (BUSY.has(thread.status)) counts.running += 1;
    else if (thread.status === "error") counts.failed += 1;
    else counts.done += 1;
  }
  return counts;
}

export async function getMinionIdentity(
  bb: Bb,
  threadId: string,
): Promise<{ persona: string; parentThreadId: string } | null> {
  const thread = await bb.sdk.threads.get({ threadId });
  if (thread.parentThreadId === null || !isOwnMinion(bb, thread)) return null;
  const metadata = parseMinionMetadata(await bb.sdk.threads.getPluginMetadata({ threadId }));
  return metadata ? { persona: metadata.persona, parentThreadId: thread.parentThreadId } : null;
}

async function requireMinion(
  bb: Bb,
  parentThreadId: string,
  id: string,
): Promise<{ thread: Thread; metadata: MinionMetadata }> {
  const thread = await bb.sdk.threads.get({ threadId: id });
  const metadata =
    isPlainChildOf(thread, parentThreadId) && isOwnMinion(bb, thread)
      ? parseMinionMetadata(await bb.sdk.threads.getPluginMetadata({ threadId: id }))
      : null;
  if (!metadata) throw new Error(`Thread ${id} is not a minion of this thread.`);
  return { thread, metadata };
}

function capOutput(output: string): string {
  if (output.length <= SHOW_LIMIT) return output;
  const shown = SHOW_LIMIT.toLocaleString("en-US");
  const total = output.length.toLocaleString("en-US");
  return `${output.slice(0, SHOW_LIMIT)}\n\n[Output truncated: showing the first ${shown} of ${total} characters.]`;
}

export async function showMinion(
  bb: Bb,
  parentThreadId: string,
  id: string,
): Promise<{ status: string; output: string | null }> {
  const { thread } = await requireMinion(bb, parentThreadId, id);
  const { output } = await bb.sdk.threads.output({ threadId: id });
  return { status: thread.status, output: output === null ? null : capOutput(output) };
}

export async function stopMinion(bb: Bb, parentThreadId: string, id: string): Promise<void> {
  await requireMinion(bb, parentThreadId, id);
  await bb.sdk.threads.stop({ threadId: id });
}

export async function stopAllMinions(bb: Bb, parentThreadId: string): Promise<number> {
  const running = (await ownMinions(bb, parentThreadId)).filter(({ thread }) =>
    RUNNING.has(thread.status),
  );
  for (const { thread } of running) await bb.sdk.threads.stop({ threadId: thread.id });
  return running.length;
}

export async function archiveMinion(bb: Bb, parentThreadId: string, id: string): Promise<void> {
  await requireMinion(bb, parentThreadId, id);
  await bb.sdk.threads.archive({ threadId: id });
}

export async function tellMinion(
  bb: Bb,
  parentThreadId: string,
  id: string,
  text: string,
): Promise<void> {
  await requireMinion(bb, parentThreadId, id);
  await bb.sdk.threads.send({
    threadId: id,
    mode: "auto",
    input: [{ type: "text", text, mentions: [] }],
  });
}

// Lifecycle events arrive in bursts and every open tab, chip and banner refetches on each signal,
// so a parent gets at most one signal per window, sent after the window's last change.
export function createInvalidator(bb: Bb): (parentThreadId: string) => void {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  bb.onDispose(() => {
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
  });
  return (parentThreadId) => {
    if (pending.has(parentThreadId)) return;
    const timer = setTimeout(() => {
      pending.delete(parentThreadId);
      bb.realtime.publish(MINIONS_CHANNEL, { threadId: parentThreadId });
    }, INVALIDATE_DELAY_MS);
    timer.unref?.();
    pending.set(parentThreadId, timer);
  };
}

// bb does not replay events missed while the plugin was unloaded, so open views refetch on load.
export function registerMinionEvents(bb: Bb, invalidate: (parentThreadId: string) => void): void {
  for (const event of MINION_EVENTS) {
    bb.events.on(event, ({ thread }) => {
      if (thread.parentThreadId !== null && isOwnMinion(bb, thread)) {
        invalidate(thread.parentThreadId);
      }
    });
  }
  bb.realtime.publish(MINIONS_CHANNEL, { threadId: null });
}
