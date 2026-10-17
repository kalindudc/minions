import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SKILL = readFileSync(
  join(import.meta.dirname, "..", "..", "extensions", "bb", "skills", "minions", "SKILL.md"),
  "utf8",
);

describe("bb minions skill", () => {
  it("is the minions skill that bb selects for every thread", () => {
    expect(SKILL).toMatch(/^---\nname: minions\n/);
  });

  it("teaches that spawn returns at once and that agents must not poll", () => {
    expect(SKILL).toMatch(/returns at once/);
    expect(SKILL).toMatch(/NEVER poll/);
  });

  it("says bb delivers an answer only for a completed minion, cut at 4,000 characters", () => {
    expect(SKILL).toMatch(/only for a minion that completed/);
    expect(SKILL).toMatch(/4,000 characters/);
  });

  it("says failed, interrupted and blocked minions arrive as status notices without an answer", () => {
    expect(SKILL).toMatch(
      /failed or interrupted minion, or one that needs help, arrives as a status notice without an answer/,
    );
  });

  it("says minions finishing within about 2 seconds arrive as one list without answers", () => {
    expect(SKILL).toMatch(
      /within about 2 seconds of each other arrive as one list without answers/,
    );
  });

  it("says a minion stopped with halt or from the Minions tab sends no report", () => {
    expect(SKILL).toMatch(
      /A minion that you or the user stop, with `halt` or from the Minions tab, sends no report/,
    );
  });

  it("points to show_minion for the full answer", () => {
    expect(SKILL).toMatch(/`show_minion` returns the full answer/);
  });
});
