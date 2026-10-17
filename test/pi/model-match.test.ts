import { describe, expect, it } from "vitest";
import { resolveModelString } from "../../extensions/pi/model-match.js";

function makeRegistry(models: Array<{ provider: string; id: string }>) {
  return {
    getAll: () => models.map((m) => ({ ...m })),
  };
}

const registry = makeRegistry([
  { provider: "openrouter", id: "z-ai/glm-5.3-flash" },
  { provider: "openrouter", id: "z-ai/glm-5.3" },
  { provider: "openrouter", id: "deepseek/deepseek-v4.1-flash" },
  { provider: "kimi-coding", id: "k3" },
  { provider: "kimi-coding", id: "kimi-for-coding" },
]);

describe("resolveModelString", () => {
  it("resolves canonical provider/id including ids that contain slashes", () => {
    const model = resolveModelString(registry as any, "openrouter/z-ai/glm-5.3-flash");
    expect(model.provider).toBe("openrouter");
    expect(model.id).toBe("z-ai/glm-5.3-flash");
  });

  it("resolves provider/id case-insensitively", () => {
    const model = resolveModelString(registry as any, "Kimi-Coding/K3");
    expect(model.provider).toBe("kimi-coding");
    expect(model.id).toBe("k3");
  });

  it("resolves an unambiguous bare id", () => {
    const model = resolveModelString(registry as any, "kimi-for-coding");
    expect(model.provider).toBe("kimi-coding");
  });

  it("resolves a bare id that looks like provider/id", () => {
    const model = resolveModelString(registry as any, "z-ai/glm-5.3-flash");
    expect(model.provider).toBe("openrouter");
  });

  it("trims whitespace", () => {
    const model = resolveModelString(registry as any, "  kimi-coding/k3  ");
    expect(model.id).toBe("k3");
  });

  it("throws on unknown model with guidance", () => {
    expect(() => resolveModelString(registry as any, "openrouter/nope-model")).toThrow(
      /did not match any model/,
    );
  });

  it("throws on ambiguous bare id", () => {
    const dup = makeRegistry([
      { provider: "a", id: "same" },
      { provider: "b", id: "same" },
    ]);
    expect(() => resolveModelString(dup as any, "same")).toThrow(/ambiguous across providers/);
  });

  it("throws on empty override", () => {
    expect(() => resolveModelString(registry as any, "   ")).toThrow(/empty/);
  });
});
