import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describePersonaWarning,
  discoverAgents,
  isAllowedPersonaPath,
  loadAgentsFromDir,
  readPersonaBody,
  skippedPersona,
} from "../../src/agents.js";

const FIXTURES = join(import.meta.dirname, "fixtures", "agents");

const tempDirs: string[] = [];

function tempAgentsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pm-persona-"));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function isolatedHome(): string {
  const home = mkdtempSync(join(tmpdir(), "pm-home-"));
  tempDirs.push(home);
  vi.stubEnv("HOME", home);
  vi.stubEnv("PI_CODING_AGENT_DIR", join(home, "pi-agent"));
  return home;
}

function writeFiles(dir: string, files: Record<string, string>): string {
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

function tempProject(files: Record<string, string>): string {
  const project = mkdtempSync(join(tmpdir(), "pm-project-"));
  tempDirs.push(project);
  mkdirSync(join(project, ".git"));
  writeFiles(join(project, ".pi", "agents"), files);
  return project;
}

describe("loadAgentsFromDir", () => {
  it("returns empty array for a missing directory", () => {
    const agents = loadAgentsFromDir("/nonexistent/path", "user");
    expect(agents).toEqual([]);
  });

  it("skips non-.md files", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const names = agents.map((a) => a.name);
    expect(names).not.toContain("not-markdown");
  });

  it("skips agents with no description", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const names = agents.map((a) => a.name);
    expect(names).not.toContain("broken");
  });

  it("parses name and description", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const scout = agents.find((a) => a.name === "scout");
    expect(scout).toBeDefined();
    expect(scout?.description).toBe("Fast codebase recon");
  });

  it("parses tools as trimmed string array", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const scout = agents.find((a) => a.name === "scout");
    expect(scout?.tools).toEqual(["read", "grep", "find", "ls", "bash"]);
  });

  it("leaves tools undefined when not specified", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const worker = agents.find((a) => a.name === "worker");
    expect(worker?.tools).toBeUndefined();
  });

  it("parses model field", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const scout = agents.find((a) => a.name === "scout");
    expect(scout?.model).toBe("claude-haiku-4-5");
  });

  it("leaves model undefined when not specified", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const worker = agents.find((a) => a.name === "worker");
    expect(worker?.model).toBeUndefined();
  });

  it("parses thinking and bb persona fields", () => {
    const scout = loadAgentsFromDir(FIXTURES, "user").find((a) => a.name === "scout");
    expect(scout?.thinking).toBe("low");

    const dir = tempAgentsDir({
      "luna.md":
        "---\ndescription: bb persona\nprovider: codex\nreasoning: xhigh\npermission: accept-edits\nenvironment: worktree\ndelegate: true\n---\nYou are Luna.",
    });
    expect(loadAgentsFromDir(dir, "user")[0]).toMatchObject({
      name: "luna",
      provider: "codex",
      reasoning: "xhigh",
      permission: "accept-edits",
      environment: "worktree",
      delegate: true,
      systemPrompt: "You are Luna.",
    });
  });

  it("leaves bb persona fields unset when a persona omits them", () => {
    const worker = loadAgentsFromDir(FIXTURES, "user").find((a) => a.name === "worker");
    expect(worker).toBeDefined();
    expect([
      worker?.provider,
      worker?.reasoning,
      worker?.permission,
      worker?.environment,
      worker?.delegate,
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("reads delegate written as a quoted string or as false", () => {
    const dir = tempAgentsDir({
      "quoted.md": '---\ndescription: Quoted\ndelegate: "true"\n---\nQuoted.',
      "solo.md": "---\ndescription: Solo\ndelegate: false\n---\nSolo.",
    });
    const agents = loadAgentsFromDir(dir, "user");
    expect(agents.find((a) => a.name === "quoted")?.delegate).toBe(true);
    expect(agents.find((a) => a.name === "solo")?.delegate).toBe(false);
  });

  it("leaves out a broken persona file instead of failing the whole directory", () => {
    const dir = tempAgentsDir({
      "bad.md": "---\ndescription: Bad\nreasoning: extreme\n---\nBad.",
      "good.md": "---\ndescription: Good\n---\nGood.",
    });

    expect(loadAgentsFromDir(dir, "user").map((agent) => agent.name)).toEqual(["good"]);
  });

  it("strips a byte-order mark and Windows line endings before reading frontmatter", () => {
    const dir = tempAgentsDir({
      "win.md":
        "\uFEFF---\r\ndescription: Windows persona\r\nreasoning: low\r\n---\r\nLine one.\r\nLine two.\r\n",
    });
    expect(loadAgentsFromDir(dir, "user")[0]).toMatchObject({
      name: "win",
      description: "Windows persona",
      reasoning: "low",
      systemPrompt: "Line one.\nLine two.",
    });
  });

  it("treats a file without a closing fence as having no frontmatter", () => {
    const dir = tempAgentsDir({ "open.md": "---\ndescription: Never closed\nBody." });
    expect(loadAgentsFromDir(dir, "user")).toEqual([]);
  });

  it("parses steps as number", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const thinker = agents.find((a) => a.name === "thinker");
    expect(thinker?.steps).toBe(30);
  });

  it("parses steps from opencode-compat agents", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const researcher = agents.find((a) => a.name === "researcher");
    expect(researcher).toBeDefined();
    expect(researcher?.steps).toBe(30);
  });

  it("silently ignores unknown opencode frontmatter fields", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const researcher = agents.find((a) => a.name === "researcher");
    expect(researcher).toBeDefined();
    expect(researcher?.description).toBe("Research agent");
    // Extra fields from opencode (mode, temperature, color) must not throw
    expect(researcher?.model).toBe("claude-sonnet-4-5");
  });

  it("parses displayName field", () => {
    const tmpBase = join(tmpdir(), `pm-test-${Date.now()}`);
    const agentsDir = join(tmpBase, "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, "bob.md"),
      "---\nname: researcher\ndisplayName: Bob\ndescription: Research agent\n---\nYou are Bob.",
    );
    const agents = loadAgentsFromDir(agentsDir, "user");
    const bob = agents.find((a) => a.name === "researcher");
    expect(bob?.displayName).toBe("Bob");
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("sets source on each agent", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    expect(agents.every((a) => a.source === "user")).toBe(true);
  });

  it("sets filePath on each agent", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    expect(agents.every((a) => a.filePath.endsWith(".md"))).toBe(true);
  });

  it("body after frontmatter becomes systemPrompt", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const scout = agents.find((a) => a.name === "scout");
    expect(scout?.systemPrompt.trim()).toBe("You are a scout.");
  });

  it("loads MINION.md from immediate child directories", () => {
    const tmpBase = join(tmpdir(), `pm-test-${Date.now()}`);
    const agentsDir = join(tmpBase, "agents");
    const reviewerDir = join(agentsDir, "reviewer");
    mkdirSync(reviewerDir, { recursive: true });

    writeFileSync(
      join(reviewerDir, "MINION.md"),
      "---\ndescription: Reviewer agent\n---\nYou are a reviewer.",
    );

    const agents = loadAgentsFromDir(agentsDir, "user");
    const reviewer = agents.find((a) => a.name === "reviewer");
    expect(reviewer).toBeDefined();
    expect(reviewer?.description).toBe("Reviewer agent");
    expect(reviewer?.filePath).toBe(join(reviewerDir, "MINION.md"));

    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("uses frontmatter name from MINION.md when provided", () => {
    const tmpBase = join(tmpdir(), `pm-test-${Date.now()}`);
    const agentsDir = join(tmpBase, "agents");
    const reviewerDir = join(agentsDir, "reviewer");
    mkdirSync(reviewerDir, { recursive: true });

    writeFileSync(
      join(reviewerDir, "MINION.md"),
      "---\nname: strict-reviewer\ndescription: Reviewer agent\n---\nYou are a reviewer.",
    );

    const agents = loadAgentsFromDir(agentsDir, "user");
    expect(agents.find((a) => a.name === "reviewer")).toBeUndefined();
    expect(agents.find((a) => a.name === "strict-reviewer")).toBeDefined();

    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("prefers top-level markdown files over MINION.md on name collision", () => {
    const tmpBase = join(tmpdir(), `pm-test-${Date.now()}`);
    const agentsDir = join(tmpBase, "agents");
    const reviewerDir = join(agentsDir, "reviewer");
    mkdirSync(reviewerDir, { recursive: true });

    writeFileSync(
      join(agentsDir, "reviewer.md"),
      "---\ndescription: Top-level reviewer\n---\nTop-level prompt.",
    );
    writeFileSync(
      join(reviewerDir, "MINION.md"),
      "---\ndescription: Nested reviewer\n---\nNested prompt.",
    );

    const agents = loadAgentsFromDir(agentsDir, "user");
    const reviewer = agents.find((a) => a.name === "reviewer");
    expect(reviewer?.description).toBe("Top-level reviewer");
    expect(reviewer?.filePath).toBe(join(agentsDir, "reviewer.md"));

    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("does not discover MINION.md deeper than one directory level", () => {
    const tmpBase = join(tmpdir(), `pm-test-${Date.now()}`);
    const agentsDir = join(tmpBase, "agents");
    const nestedDir = join(agentsDir, "team", "reviewer");
    mkdirSync(nestedDir, { recursive: true });

    writeFileSync(
      join(nestedDir, "MINION.md"),
      "---\ndescription: Deep reviewer\n---\nDeep prompt.",
    );

    const agents = loadAgentsFromDir(agentsDir, "user");
    expect(agents).toEqual([]);

    rmSync(tmpBase, { recursive: true, force: true });
  });
});

describe("invalid persona files", () => {
  it.each([
    ["reasoning: extreme", /reasoning "extreme"/],
    ["permission: yolo", /permission "yolo"/],
    ["permission:\n  edit: deny", /permission/],
    ["environment: cloud", /environment "cloud"/],
    ["delegate: maybe", /delegate "maybe"/],
    ["provider: 42", /provider 42/],
    ["reasoning:", /reasoning null/],
  ])("skips a persona with an invalid bb value and reports the file and reason (%s)", (line, reason) => {
    isolatedHome();
    const project = tempProject({
      "bad.md": `---\ndescription: Bad\n${line}\n---\nBad.`,
      "good.md": "---\ndescription: Good\n---\nGood.",
    });

    const { agents, warnings } = discoverAgents(project, "both");

    expect(agents.map((agent) => agent.name)).toEqual(["good"]);
    expect(warnings).toEqual([
      {
        name: "bad",
        path: join(project, ".pi", "agents", "bad.md"),
        reason: expect.stringMatching(reason),
      },
    ]);
  });

  it("skips a persona with malformed YAML frontmatter and reports the file", () => {
    isolatedHome();
    const project = tempProject({
      "broken.md": "---\ndescription: [unclosed\nname: broken\n---\nBroken.",
      "good.md": "---\ndescription: Good\n---\nGood.",
    });

    const { agents, warnings } = discoverAgents(project, "both");

    expect(agents.map((agent) => agent.name)).toEqual(["good"]);
    expect(warnings).toEqual([
      {
        name: "broken",
        path: join(project, ".pi", "agents", "broken.md"),
        reason: expect.stringMatching(/^invalid YAML frontmatter: \S/),
      },
    ]);
    expect(warnings[0]?.reason).not.toContain("\n");
  });

  it("names a skipped persona by its frontmatter name when the YAML parses", () => {
    isolatedHome();
    const project = tempProject({
      "file.md": "---\nname: rex\ndescription: Rex\nenvironment: cloud\n---\nRex.",
    });

    const { warnings } = discoverAgents(project, "both");

    expect(warnings.map((warning) => warning.name)).toEqual(["rex"]);
    expect(describePersonaWarning(warnings[0]!)).toBe(
      `${join(project, ".pi", "agents", "file.md")}: ${warnings[0]!.reason}`,
    );
  });

  it("does not fall back to a user persona that a broken project persona would override", () => {
    const home = isolatedHome();
    writeFiles(join(home, ".agents", "agents"), {
      "scout.md": "---\ndescription: User scout\n---\nUser.",
    });
    const project = tempProject({
      "scout.md": "---\ndescription: Project scout\nreasoning: extreme\n---\nProject.",
    });

    const { agents, warnings } = discoverAgents(project, "both");

    expect(agents.find((agent) => agent.name === "scout")).toBeUndefined();
    expect(skippedPersona(warnings, "scout")?.path).toBe(
      join(project, ".pi", "agents", "scout.md"),
    );
  });

  it("still reports a broken user persona that a valid project persona overrides", () => {
    const home = isolatedHome();
    const userFile = join(home, ".agents", "agents", "scout.md");
    writeFiles(join(home, ".agents", "agents"), {
      "scout.md": "---\ndescription: User scout\npermission: yolo\n---\nUser.",
    });
    const project = tempProject({ "scout.md": "---\ndescription: Project scout\n---\nProject." });

    const { agents, warnings } = discoverAgents(project, "both");

    expect(agents.find((agent) => agent.name === "scout")?.description).toBe("Project scout");
    expect(warnings.map((warning) => warning.path)).toEqual([userFile]);
  });

  it("lets a broken top-level persona file shadow a MINION.md of the same name", () => {
    isolatedHome();
    const project = tempProject({
      "reviewer.md": "---\ndescription: Top\ndelegate: maybe\n---\nTop.",
    });
    writeFiles(join(project, ".pi", "agents", "reviewer"), {
      "MINION.md": "---\ndescription: Nested\n---\nNested.",
    });

    const { agents, warnings } = discoverAgents(project, "both");

    expect(agents.find((agent) => agent.name === "reviewer")).toBeUndefined();
    expect(skippedPersona(warnings, "reviewer")?.path).toBe(
      join(project, ".pi", "agents", "reviewer.md"),
    );
  });
});

describe("discoverAgents scope", () => {
  it("reads user personas from PI_CODING_AGENT_DIR, expanding a leading ~", () => {
    const home = mkdtempSync(join(tmpdir(), "pm-home-"));
    tempDirs.push(home);
    mkdirSync(join(home, "custom-agent", "agents"), { recursive: true });
    writeFileSync(
      join(home, "custom-agent", "agents", "envy.md"),
      "---\ndescription: From the env dir\n---\nEnvy.",
    );
    vi.stubEnv("HOME", home);
    vi.stubEnv("PI_CODING_AGENT_DIR", "~/custom-agent");

    const { agents } = discoverAgents(home, "user");
    expect(agents.map((a) => a.name)).toEqual(["envy"]);
    expect(agents[0]?.filePath).toBe(join(home, "custom-agent", "agents", "envy.md"));
  });

  it("scope=user returns agents with source=user", () => {
    const { agents } = discoverAgents(FIXTURES, "user");
    expect(agents.every((a) => a.source === "user")).toBe(true);
  });

  it("scope=project returns empty when no .pi/agents dir exists", () => {
    const { agents } = discoverAgents("/nonexistent", "project");
    expect(agents).toEqual([]);
  });

  it("scope=both: project agents override user agents with same name", () => {
    const tmpBase = join(tmpdir(), `pm-test-${Date.now()}`);
    const projectAgentsDir = join(tmpBase, ".pi", "agents");
    mkdirSync(projectAgentsDir, { recursive: true });

    writeFileSync(
      join(projectAgentsDir, "scout.md"),
      "---\nname: scout\ndescription: Project scout override\n---\nProject version.",
    );

    const cwd = tmpBase;
    const { agents } = discoverAgents(cwd, "both");

    const scout = agents.find((a) => a.name === "scout");
    // The project version should win since it exists in .pi/agents under cwd
    expect(scout?.description).toBe("Project scout override");
    expect(scout?.source).toBe("project");

    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("discovers agents from .pi/minions/ project directory via MINION.md", () => {
    const tmpBase = join(tmpdir(), `pm-test-${Date.now()}`);
    const minionDir = join(tmpBase, ".pi", "minions", "reviewer");
    mkdirSync(minionDir, { recursive: true });

    writeFileSync(
      join(minionDir, "MINION.md"),
      "---\ndescription: Project reviewer\n---\nProject reviewer prompt.",
    );

    mkdirSync(join(tmpBase, ".git"), { recursive: true });

    const { agents } = discoverAgents(tmpBase, "project");
    const reviewer = agents.find((a) => a.name === "reviewer");
    expect(reviewer).toBeDefined();
    expect(reviewer?.description).toBe("Project reviewer");
    expect(reviewer?.source).toBe("project");

    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("discovers agents from .agents/agents/ project directory", () => {
    const tmpBase = join(tmpdir(), `pm-test-${Date.now()}`);
    const dotAgentsDir = join(tmpBase, ".agents", "agents");
    mkdirSync(dotAgentsDir, { recursive: true });

    writeFileSync(
      join(dotAgentsDir, "helper.md"),
      "---\nname: helper\ndescription: Dot-agents helper\n---\nHelper prompt.",
    );

    // Create .git so findProjectDir stops here
    mkdirSync(join(tmpBase, ".git"), { recursive: true });

    const { agents } = discoverAgents(tmpBase, "project");
    const helper = agents.find((a) => a.name === "helper");
    expect(helper).toBeDefined();
    expect(helper?.description).toBe("Dot-agents helper");
    expect(helper?.source).toBe("project");

    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("project .agents/agents/ overrides global on name collision", () => {
    const tmpBase = join(tmpdir(), `pm-test-${Date.now()}`);
    const dotAgentsDir = join(tmpBase, ".agents", "agents");
    mkdirSync(dotAgentsDir, { recursive: true });
    mkdirSync(join(tmpBase, ".git"), { recursive: true });

    writeFileSync(
      join(dotAgentsDir, "scout.md"),
      "---\nname: scout\ndescription: Dot-agents scout override\n---\nDot-agents version.",
    );

    const { agents } = discoverAgents(tmpBase, "both");
    const scout = agents.find((a) => a.name === "scout");
    // Project .agents/agents/ should override global user agents
    expect(scout?.description).toBe("Dot-agents scout override");
    expect(scout?.source).toBe("project");

    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("both .pi/agents/ and .agents/agents/ agents are returned together", () => {
    const tmpBase = join(tmpdir(), `pm-test-${Date.now()}`);
    const piAgentsDir = join(tmpBase, ".pi", "agents");
    const dotAgentsDir = join(tmpBase, ".agents", "agents");
    mkdirSync(piAgentsDir, { recursive: true });
    mkdirSync(dotAgentsDir, { recursive: true });
    mkdirSync(join(tmpBase, ".git"), { recursive: true });

    writeFileSync(
      join(piAgentsDir, "alpha.md"),
      "---\nname: alpha\ndescription: Pi alpha agent\n---\nAlpha prompt.",
    );
    writeFileSync(
      join(dotAgentsDir, "beta.md"),
      "---\nname: beta\ndescription: Dot-agents beta agent\n---\nBeta prompt.",
    );

    const { agents } = discoverAgents(tmpBase, "project");
    const names = agents.map((a) => a.name);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
    expect(agents).toHaveLength(2);

    rmSync(tmpBase, { recursive: true, force: true });
  });
});

describe("persona files", () => {
  let home: string;
  let project: string;

  function writePersona(dir: string, name: string, body: string): string {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${name}.md`);
    writeFileSync(path, `---\ndescription: ${name} persona\n---\n${body}\n`);
    return path;
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "pm-persona-files-"));
    tempDirs.push(home);
    project = join(home, "project");
    mkdirSync(join(project, ".git"), { recursive: true });
    vi.stubEnv("HOME", home);
    vi.stubEnv("PI_CODING_AGENT_DIR", join(home, "pi-agent"));
    writePersona(join(home, ".agents", "agents"), "researcher", "You are researcher.");
    writePersona(join(project, ".pi", "agents"), "scout", "You are scout.");
  });

  it("accepts persona files in the user directories and in the thread's project directories", () => {
    const userMinion = join(home, ".agents", "minions", "reviewer");
    writeFiles(userMinion, { "MINION.md": "---\ndescription: Reviewer\n---\nReview." });
    const projectMinion = join(project, ".pi", "minions", "builder");
    writeFiles(projectMinion, { "MINION.md": "---\ndescription: Builder\n---\nBuild." });
    mkdirSync(join(project, "src"));

    expect(isAllowedPersonaPath(join(home, ".agents", "agents", "researcher.md"), null)).toBe(true);
    expect(isAllowedPersonaPath(join(userMinion, "MINION.md"), null)).toBe(true);
    expect(isAllowedPersonaPath(join(project, ".pi", "agents", "scout.md"), project)).toBe(true);
    expect(
      isAllowedPersonaPath(join(project, ".pi", "agents", "scout.md"), join(project, "src")),
    ).toBe(true);
    expect(isAllowedPersonaPath(join(projectMinion, "MINION.md"), project)).toBe(true);
  });

  it("rejects a project persona when the thread works somewhere else", () => {
    const other = join(home, "other");
    mkdirSync(join(other, ".git"), { recursive: true });

    expect(isAllowedPersonaPath(join(project, ".pi", "agents", "scout.md"), null)).toBe(false);
    expect(isAllowedPersonaPath(join(project, ".pi", "agents", "scout.md"), other)).toBe(false);
  });

  it("rejects a folder named like a persona directory that discovery would not read", () => {
    const stray = writePersona(join(home, "stray", ".pi", "agents"), "y", "Stray.");
    const aboveGitRoot = writePersona(join(home, ".pi", "minions"), "above", "Above.");

    expect(isAllowedPersonaPath(stray, project)).toBe(false);
    expect(isAllowedPersonaPath(stray, null)).toBe(false);
    expect(isAllowedPersonaPath(aboveGitRoot, project)).toBe(false);
  });

  it("follows a symlinked agent directory to its real location", () => {
    const dotfiles = join(home, "dotfiles", "agents");
    writePersona(dotfiles, "linked", "Linked.");
    mkdirSync(join(home, "pi-agent"), { recursive: true });
    symlinkSync(dotfiles, join(home, "pi-agent", "agents"));

    expect(isAllowedPersonaPath(join(home, "pi-agent", "agents", "linked.md"), null)).toBe(true);
  });

  it("rejects files outside agent directories, escapes, symlinks out and non-markdown files", () => {
    writeFileSync(join(home, "secret.md"), "secret");
    writeFileSync(join(home, ".agents", "agents", "notes.txt"), "notes");
    symlinkSync(join(home, "secret.md"), join(home, ".agents", "agents", "escape.md"));
    const allowed = (path: string) => isAllowedPersonaPath(path, project);

    expect(allowed(join(home, "secret.md"))).toBe(false);
    expect(allowed(join(home, ".agents", "agents", "..", "..", "secret.md"))).toBe(false);
    expect(allowed(join(home, ".agents", "agents", "escape.md"))).toBe(false);
    expect(allowed(join(home, ".agents", "agents", "notes.txt"))).toBe(false);
    expect(allowed(join(home, ".agents", "agents", "missing.md"))).toBe(false);
  });

  it("reads a persona's body without its frontmatter and picks up later edits", () => {
    const path = join(home, ".agents", "agents", "researcher.md");

    expect(readPersonaBody(path, null)).toBe("You are researcher.");

    writeFileSync(
      path,
      "---\ndescription: researcher persona\n---\nYou are a careful researcher.\n",
    );
    const later = new Date(Date.now() + 60_000);
    utimesSync(path, later, later);

    expect(readPersonaBody(path, null)).toBe("You are a careful researcher.");
  });

  it("reads a project persona only for a thread working in that project", () => {
    const path = join(project, ".pi", "agents", "scout.md");

    expect(readPersonaBody(path, project)).toBe("You are scout.");
    expect(() => readPersonaBody(path, null)).toThrow(/not inside an agent or minion/);
  });

  it("refuses to read a file outside the persona directories", () => {
    writeFileSync(join(home, "secret.md"), "---\ndescription: Secret\n---\nsecret contents");

    expect(() => readPersonaBody(join(home, "secret.md"), project)).toThrow(
      /not inside an agent or minion/,
    );
  });
});
