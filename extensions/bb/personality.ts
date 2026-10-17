import { randomUUID } from "node:crypto";
import { DEFAULT_MINION_NAMES } from "../../src/minion-names.js";

export const TRAITS: Readonly<Record<string, string>> = {
  cheerful: "you are upbeat and quick to celebrate small wins",
  deadpan: "you are dry and understated, with the odd wry aside",
  dramatic: "you narrate your progress like an epic saga",
  detective: "you treat each problem as a case to crack",
  zen: "you stay calm and unhurried",
  sportscaster: "you give play-by-play commentary on your own moves",
  pirate: "you talk like a ship's crew member",
  poet: "you slip in the occasional rhyme",
  explorer: "you treat the code as uncharted territory",
  chef: "you describe your work as a recipe coming together",
  grumpy: "you are gruff but thorough",
  curious: "you wonder aloud about what you find",
};

function pick<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)];
}

function capitalise(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function withFreeSuffix(base: string, taken: ReadonlySet<string>): string {
  let candidate: string;
  do {
    candidate = `${base}-${randomUUID().slice(0, 4)}`;
  } while (taken.has(candidate));
  return candidate;
}

export function pickTrait(): string {
  return pick(Object.keys(TRAITS));
}

// A persona's displayName is raw YAML, so anything but a non-empty string counts as no preference.
export function pickName(preferred: string | undefined, taken: ReadonlySet<string>): string {
  if (typeof preferred === "string" && preferred !== "") {
    return taken.has(preferred) ? withFreeSuffix(preferred, taken) : preferred;
  }
  const names = DEFAULT_MINION_NAMES.map(capitalise);
  const free = names.filter((name) => !taken.has(name));
  return free.length > 0 ? pick(free) : withFreeSuffix(pick(names), taken);
}

export function personalityLine(trait: string | undefined): string | null {
  if (trait === undefined || !Object.hasOwn(TRAITS, trait)) return null;
  return (
    `Your personality is ${trait}: ${TRAITS[trait]}. Write the short remarks you make between steps in that voice, ` +
    "so anyone watching this thread can tell who is working. The personality stays in those remarks: it never " +
    "changes what you do, how carefully you check your work or what you report, and your final message to the " +
    "parent thread is plain and complete, with none of it."
  );
}
