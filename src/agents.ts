import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { getAgentDir, parseFrontmatter } from "./persona-frontmatter.js";
import type { AgentConfig, AgentSource, PersonaWarning, ThinkingLevel } from "./types.js";

const BB_CHOICES = {
  reasoning: ["none", "low", "medium", "high", "xhigh", "max"],
  permission: ["accept-edits", "auto", "full"],
  environment: ["shared", "worktree"],
} as const;

const PROJECT_PERSONA_DIRS: readonly (readonly [string, string])[] = [
  [".pi", "agents"],
  [".pi", "minions"],
  [".agents", "agents"],
  [".agents", "minions"],
];

function userPersonaDirs(): string[] {
  const agentDir = getAgentDir();
  return [
    join(agentDir, "agents"),
    join(agentDir, "minions"),
    join(homedir(), ".agents", "agents"),
    join(homedir(), ".agents", "minions"),
  ];
}

const THINKING_LEVELS = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

type PersonaEntry = AgentConfig | PersonaWarning;

function isWarning(entry: PersonaEntry): entry is PersonaWarning {
  return "reason" in entry;
}

function firstLine(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split("\n")[0]?.trim() ?? "";
}

function bbFieldProblem(frontmatter: Record<string, unknown>): string | null {
  for (const [field, allowed] of Object.entries(BB_CHOICES)) {
    const value = frontmatter[field];
    if (value !== undefined && !(allowed as readonly unknown[]).includes(value)) {
      return `invalid ${field} ${JSON.stringify(value)}; expected one of: ${allowed.join(", ")}`;
    }
  }
  const { provider, delegate } = frontmatter;
  if (provider !== undefined && (typeof provider !== "string" || provider.trim() === "")) {
    return `invalid provider ${JSON.stringify(provider)}; expected a bb provider id`;
  }
  if (delegate !== undefined && ![true, false, "true", "false"].includes(delegate as string)) {
    return `invalid delegate ${JSON.stringify(delegate)}; expected true or false`;
  }
  return null;
}

// A broken file becomes a warning that still claims its persona name, so it cannot let a lower-precedence
// persona of the same name take its place.
function loadPersonaFile(
  filePath: string,
  source: AgentSource,
  defaultName: string,
): PersonaEntry | null {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  let parsed: ReturnType<typeof parseFrontmatter>;
  try {
    parsed = parseFrontmatter(content);
  } catch (err) {
    return {
      name: defaultName,
      path: filePath,
      reason: `invalid YAML frontmatter: ${firstLine(err)}`,
    };
  }
  // Existing persona fields keep pi's raw YAML values; only the bb fields are validated.
  const frontmatter = parsed.frontmatter as Record<string, string>;
  if (!frontmatter.description) return null;

  const name = frontmatter.name ?? defaultName;
  const problem = bbFieldProblem(parsed.frontmatter);
  if (problem) return { name, path: filePath, reason: problem };
  try {
    return toAgentConfig(frontmatter, parsed.body, name, source, filePath);
  } catch (err) {
    return { name, path: filePath, reason: `invalid persona: ${firstLine(err)}` };
  }
}

function toAgentConfig(
  frontmatter: Record<string, string>,
  body: string,
  name: string,
  source: AgentSource,
  filePath: string,
): AgentConfig {
  const tools = frontmatter.tools
    ?.split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const thinking =
    frontmatter.thinking && THINKING_LEVELS.has(frontmatter.thinking as ThinkingLevel)
      ? (frontmatter.thinking as ThinkingLevel)
      : undefined;

  const steps =
    frontmatter.steps || frontmatter.max_turns
      ? parseInt(frontmatter.steps, 10) || parseInt(frontmatter.max_turns, 10) || undefined
      : undefined;
  const timeout = frontmatter.timeout ? parseInt(frontmatter.timeout, 10) || undefined : undefined;

  return {
    name,
    displayName: frontmatter.displayName,
    description: frontmatter.description,
    tools: tools && tools.length > 0 ? tools : undefined,
    model: frontmatter.model,
    thinking,
    provider: frontmatter.provider,
    reasoning: frontmatter.reasoning as AgentConfig["reasoning"],
    permission: frontmatter.permission as AgentConfig["permission"],
    environment: frontmatter.environment as AgentConfig["environment"],
    delegate:
      frontmatter.delegate === undefined
        ? undefined
        : String(frontmatter.delegate as string | boolean) === "true",
    steps,
    timeout,
    systemPrompt: body.trim(),
    source,
    filePath,
  };
}

function readPersonaDir(dir: string, source: AgentSource) {
  const entries = new Map<string, PersonaEntry>();
  const warnings: PersonaWarning[] = [];
  if (!existsSync(dir)) return { entries, warnings };

  let dirents: import("node:fs").Dirent[];
  try {
    dirents = readdirSync(dir, { withFileTypes: true, encoding: "utf-8" });
  } catch {
    return { entries, warnings };
  }

  // Top-level files win over MINION.md files of the same name, broken or not.
  const add = (entry: PersonaEntry | null, yieldsToExisting: boolean) => {
    if (!entry || (yieldsToExisting && entries.has(entry.name))) return;
    entries.set(entry.name, entry);
    if (isWarning(entry)) warnings.push(entry);
  };

  for (const dirent of dirents) {
    if (!dirent.name.endsWith(".md")) continue;
    if (!dirent.isFile() && !dirent.isSymbolicLink()) continue;
    add(loadPersonaFile(join(dir, dirent.name), source, dirent.name.replace(/\.md$/, "")), false);
  }

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;

    const filePath = join(dir, dirent.name, "MINION.md");
    let isFile = false;
    try {
      isFile = existsSync(filePath) && statSync(filePath).isFile();
    } catch {
      continue;
    }
    if (!isFile) continue;
    add(loadPersonaFile(filePath, source, dirent.name), true);
  }

  return { entries, warnings };
}

export function loadAgentsFromDir(dir: string, source: AgentSource): AgentConfig[] {
  return [...readPersonaDir(dir, source).entries.values()].filter(
    (entry): entry is AgentConfig => !isWarning(entry),
  );
}

function findProjectDir(cwd: string, ...subpath: string[]): string | null {
  let current = cwd;
  while (true) {
    const candidate = join(current, ...subpath);
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;

    // Stop at git root
    if (existsSync(join(current, ".git"))) return null;

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function discoverAgents(
  cwd: string,
  scope: "user" | "project" | "both",
): { agents: AgentConfig[]; projectAgentsDir: string | null; warnings: PersonaWarning[] } {
  const projectDirs = PROJECT_PERSONA_DIRS.map((subpath) => findProjectDir(cwd, ...subpath));
  const dirs: (readonly [string, AgentSource])[] = [
    ...(scope !== "project" ? userPersonaDirs().map((dir) => [dir, "user"] as const) : []),
    ...(scope !== "user"
      ? projectDirs.flatMap((dir) => (dir ? [[dir, "project"] as const] : []))
      : []),
  ];

  // Later directories override earlier ones, so project personas override user personas.
  const winners = new Map<string, PersonaEntry>();
  const warnings: PersonaWarning[] = [];
  for (const [dir, source] of dirs) {
    const found = readPersonaDir(dir, source);
    for (const [name, entry] of found.entries) winners.set(name, entry);
    warnings.push(...found.warnings);
  }

  return {
    agents: [...winners.values()].filter((entry): entry is AgentConfig => !isWarning(entry)),
    projectAgentsDir: projectDirs.find((dir) => dir !== null) ?? null,
    warnings,
  };
}

// Warnings come in precedence order, so when no valid persona has a name, the last warning with that name
// is the file that would have defined it.
export function skippedPersona(
  warnings: readonly PersonaWarning[],
  name: string,
): PersonaWarning | undefined {
  return [...warnings].reverse().find((warning) => warning.name === name);
}

export function describePersonaWarning(warning: PersonaWarning): string {
  return `${warning.path}: ${warning.reason}`;
}

export function formatPersonaWarnings(warnings: readonly PersonaWarning[]): string {
  return [
    "Skipped persona files (fix them to use these personas):",
    ...warnings.map((warning) => `- ${describePersonaWarning(warning)}`),
  ].join("\n");
}

function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function personaRoots(cwd: string | null): Set<string> {
  const projectDirs =
    cwd === null ? [] : PROJECT_PERSONA_DIRS.map((subpath) => findProjectDir(cwd, ...subpath));
  const roots = new Set<string>();
  for (const dir of [...userPersonaDirs(), ...projectDirs]) {
    const real = dir === null ? null : realpathOrNull(dir);
    if (real) roots.add(real);
  }
  return roots;
}

// A persona path can come from untrusted input such as thread metadata, so it must resolve into a directory
// that discovery reads for this thread: a user directory, or a project directory found from `cwd`.
export function isAllowedPersonaPath(path: string, cwd: string | null): boolean {
  const real = realpathOrNull(path);
  if (!real?.endsWith(".md")) return false;
  const roots = personaRoots(cwd);
  if (roots.has(dirname(real))) return true;
  return basename(real) === "MINION.md" && roots.has(dirname(dirname(real)));
}

const personaBodies = new Map<string, { mtimeMs: number; body: string }>();

export function readPersonaBody(path: string, cwd: string | null): string {
  if (!isAllowedPersonaPath(path, cwd)) {
    throw new Error(`Persona file ${path} is not inside an agent or minion directory.`);
  }
  const real = realpathSync(path);
  const { mtimeMs } = statSync(real);
  const cached = personaBodies.get(real);
  if (cached?.mtimeMs === mtimeMs) return cached.body;
  const body = parseFrontmatter(readFileSync(real, "utf8")).body.trim();
  personaBodies.set(real, { mtimeMs, body });
  return body;
}
