import { describe, expect, it } from "vitest";
import { getMinionsSkill, MINIONS_SKILL } from "../../extensions/pi/skill.js";

describe("minions skill", () => {
  it("teaches the foreground minion delegation surface", () => {
    const text = getMinionsSkill();

    expect(text).toBe(MINIONS_SKILL);
    expect(text).toContain("spawn");
    expect(text).toContain("tasks");
    expect(text).toContain("agent");
    expect(text).toContain("model");
    expect(text).toContain("halt");
    expect(text).toContain("list_agents");
    expect(text).toContain("foreground");
  });

  it("teaches tasks-only inputs for single minions and parallel batches", () => {
    const text = getMinionsSkill();

    expect(text).toContain("required, non-empty `tasks` array");
    expect(text).toContain("required `task`");
    expect(text).toContain("optional `agent` and `model`");
    expect(text).toContain("One item");
    expect(text).toContain("Two or more items");
    expect(text).toContain("/spawn <task> [--model <model>]");
    expect(text).not.toContain("Provide `task`, optional `agent`");
  });

  it("states removed delegation surfaces are unavailable without naming removed tool commands", () => {
    const text = getMinionsSkill();

    expect(text).toContain("Background minions are not available");
    expect(text).toContain("Live detach is not available");
    expect(text).toContain("User steering is not available");
    expect(text).not.toContain("spawn" + "_bg");
    expect(text).not.toContain("/spawn " + "--bg");
    expect(text).not.toContain("/minions " + "steer");
  });
});
