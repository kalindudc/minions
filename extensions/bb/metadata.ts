import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const MAX_DEPTH = 2;

export const minionMetadataSchema = z.object({
  persona: z.string().min(1),
  name: z.string().min(1).optional(),
  trait: z.string().min(1).optional(),
  personaPath: z.string().min(1).nullable(),
  depth: z.number().int().min(1).max(MAX_DEPTH),
  delegate: z.boolean(),
  batchId: z.string().min(1),
  providerId: z.string().min(1),
  model: z.string().min(1),
  task: z.string(),
  environment: z.enum(["shared", "worktree"]),
});

export type MinionMetadata = z.infer<typeof minionMetadataSchema>;

type Thread = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["get"]>>;

export function parseMinionMetadata(value: unknown): MinionMetadata | null {
  const parsed = minionMetadataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function mayDelegate(metadata: MinionMetadata): boolean {
  return metadata.delegate && metadata.depth < MAX_DEPTH;
}

// bb records which plugin created a thread and no metadata write can change it, so this, not metadata,
// decides whether a thread is one of this plugin's minions.
export function isOwnMinion(
  bb: BbPluginApi,
  thread: Pick<Thread, "originKind" | "originPluginId">,
) {
  return thread.originKind === null && thread.originPluginId === bb.pluginId;
}
