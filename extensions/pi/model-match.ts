import type { Model } from "@earendil-works/pi-ai";

/** Minimal structural surface of ModelRegistry needed for model matching. */
export interface ModelMatcher {
  // biome-ignore lint/suspicious/noExplicitAny: external API type
  getAll(): Model<any>[];
}

/**
 * Resolve a model reference string to a model from the registry.
 *
 * Accepted forms (case-insensitive):
 * - "provider/id"  — canonical form, also handles ids that contain "/" (e.g. "openrouter/z-ai/glm-5.3-flash")
 * - "id"           — bare model id when unambiguous across providers
 *
 * Throws with an actionable message when the reference matches nothing or is
 * ambiguous. Never falls back silently to another model.
 */
// biome-ignore lint/suspicious/noExplicitAny: external API type
export function resolveModelString(registry: ModelMatcher, reference: string): Model<any> {
  const trimmed = reference.trim();
  if (!trimmed) {
    throw new Error("Model override is empty.");
  }
  const models = registry.getAll();
  const normalized = trimmed.toLowerCase();

  // 1. Canonical "provider/id" exact match (ids may contain "/" themselves).
  const canonical = models.filter((m) => `${m.provider}/${m.id}`.toLowerCase() === normalized);
  if (canonical.length === 1) return canonical[0];

  // 2. Split on the first "/" as provider prefix when the canonical form above
  //    did not match (e.g. reference "kimi-coding/k3" against provider "kimi-coding").
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex !== -1) {
    const provider = trimmed.slice(0, slashIndex).trim();
    const modelId = trimmed.slice(slashIndex + 1).trim();
    if (provider && modelId) {
      const matches = models.filter(
        (m) =>
          m.provider.toLowerCase() === provider.toLowerCase() &&
          m.id.toLowerCase() === modelId.toLowerCase(),
      );
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) {
        throw new Error(
          `Model override "${reference}" is ambiguous (matches ${matches.length} models). Qualify it further.`,
        );
      }
    }
  }

  // 3. Bare model id, exact match.
  const byId = models.filter((m) => m.id.toLowerCase() === normalized);
  if (byId.length === 1) return byId[0];
  if (byId.length > 1) {
    const providers = [...new Set(byId.map((m) => m.provider))].join(", ");
    throw new Error(
      `Model override "${reference}" is ambiguous across providers: ${providers}. Use "provider/id".`,
    );
  }

  const sample = models
    .map((m) => `${m.provider}/${m.id}`)
    .sort()
    .slice(0, 12)
    .join(", ");
  throw new Error(
    `Model override "${reference}" did not match any model. Use "provider/id" form, e.g. ${sample}${models.length > 12 ? ", ..." : ""}.`,
  );
}
