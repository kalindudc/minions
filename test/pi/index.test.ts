import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import registerExtension from "../../extensions/pi/index.js";
import { createMockContext } from "./helpers/mock-context.js";

function createMockPi() {
  return {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerMessageRenderer: vi.fn(),
    on: vi.fn(),
    getThinkingLevel: vi.fn(),
    getAllTools: vi.fn().mockReturnValue([]),
  } as any;
}

describe("extension registration", () => {
  beforeEach(() => {
    vi.stubEnv("PI_BB_TOOLS_FILE", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("registers the foreground-only public tool surface outside bb", () => {
    const pi = createMockPi();

    registerExtension(pi);

    const toolNames = pi.registerTool.mock.calls.map((call: any[]) => call[0].name);
    expect(toolNames).toEqual([
      "spawn",
      "list_agents",
      "halt",
      "list_minion_types",
      "list_minions",
      "show_minion",
      "learn_minions",
    ]);
  });

  it("does not register removed background or steering surfaces", () => {
    const pi = createMockPi();

    registerExtension(pi);

    const toolNames = pi.registerTool.mock.calls.map((call: any[]) => call[0].name);
    const commandNames = pi.registerCommand.mock.calls.map((call: any[]) => call[0]);
    const rendererNames = pi.registerMessageRenderer.mock.calls.map((call: any[]) => call[0]);

    expect(toolNames).not.toContain("spawn" + "_bg");
    expect(toolNames).not.toContain("steer" + "_minion");
    expect(commandNames).toEqual(["spawn", "minions", "halt"]);
    expect(rendererNames).toEqual(["minion-spawn"]);
  });

  it("learn_minions returns the built-in skill text", async () => {
    const pi = createMockPi();
    registerExtension(pi);
    const learnTool = pi.registerTool.mock.calls
      .map((call: any[]) => call[0])
      .find((tool: { name: string }) => tool.name === "learn_minions");

    const result = await learnTool.execute("tc", {}, undefined, undefined, {});

    expect((result.content[0] as any).text).toContain("# pi-minions");
    expect((result.content[0] as any).text).toContain("Background minions are not available");
  });
});

describe("persona file warnings", () => {
  let home: string;
  let project: string;

  function startSession() {
    const pi = createMockPi();
    registerExtension(pi);
    const [, sessionStart] = pi.on.mock.calls.find(
      ([event]: [string]) => event === "session_start",
    );
    const ctx = createMockContext(project);
    (ctx.ui as any).setFooter = vi.fn();
    sessionStart({}, ctx);
    return ctx;
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "pm-index-"));
    project = join(home, "project");
    mkdirSync(join(project, ".git"), { recursive: true });
    mkdirSync(join(project, ".pi", "agents"), { recursive: true });
    vi.stubEnv("HOME", home);
    vi.stubEnv("PI_CODING_AGENT_DIR", join(home, "pi-agent"));
    vi.stubEnv("PI_BB_TOOLS_FILE", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it("notifies once when a session starts with persona files it had to skip", () => {
    writeFileSync(
      join(project, ".pi", "agents", "bad.md"),
      "---\ndescription: Bad\nreasoning: extreme\n---\nBad.\n",
    );

    const ctx = startSession();

    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringMatching(/bad\.md: invalid reasoning "extreme"/),
      "warning",
    );
  });

  it("does not notify when every persona file loads", () => {
    writeFileSync(
      join(project, ".pi", "agents", "good.md"),
      "---\ndescription: Good\n---\nGood.\n",
    );

    const ctx = startSession();

    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });
});
