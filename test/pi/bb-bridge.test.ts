import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import registerExtension from "../../extensions/pi/index.js";

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

function registeredSurfaces(pi: ReturnType<typeof createMockPi>) {
  return {
    tools: pi.registerTool.mock.calls.map((call: any[]) => call[0].name),
    commands: pi.registerCommand.mock.calls.map((call: any[]) => call[0]),
    renderers: pi.registerMessageRenderer.mock.calls.map((call: any[]) => call[0]),
    hooks: pi.on.mock.calls.map((call: any[]) => call[0]),
  };
}

const bbTool = (name: string) => ({ name, description: `${name} from bb`, inputSchema: {} });

describe("running inside bb's pi bridge", () => {
  let dir: string;

  function writeToolsFile(content: string): string {
    const path = join(dir, "pi-tools.json");
    writeFileSync(path, content);
    vi.stubEnv("PI_BB_TOOLS_FILE", path);
    return path;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pm-bridge-"));
    vi.stubEnv("PI_BB_TOOLS_FILE", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ["bb supplies spawn", ["spawn", "list_agents", "list_minions", "show_minion", "halt"]],
    ["bb supplies spawn alone", ["spawn"]],
    [
      "a non-delegating bb minion has every minion tool but spawn",
      ["list_agents", "list_minions", "show_minion", "halt", "read"],
    ],
  ])("registers no tools, commands, renderers or hooks when %s", (_label, names) => {
    writeToolsFile(JSON.stringify(names.map(bbTool)));
    const pi = createMockPi();

    registerExtension(pi);

    expect(registeredSurfaces(pi)).toEqual({ tools: [], commands: [], renderers: [], hooks: [] });
  });

  it.each([
    ["unrelated bb tools", JSON.stringify(["AskUserQuestion", "pr_status"].map(bbTool))],
    [
      "an incomplete minion tool set",
      JSON.stringify(["list_agents", "list_minions", "halt"].map(bbTool)),
    ],
    ["malformed JSON", '[{"name": "spawn"'],
    ["a JSON object instead of an array", JSON.stringify({ name: "spawn" })],
    ["bare tool-name strings", JSON.stringify(["spawn"])],
  ])("keeps the foreground pi surface for %s", (_label, content) => {
    writeToolsFile(content);
    const pi = createMockPi();

    registerExtension(pi);

    expect(registeredSurfaces(pi).tools).toContain("spawn");
    expect(registeredSurfaces(pi).commands).toEqual(["spawn", "minions", "halt"]);
  });

  it("keeps the foreground pi surface when the tools file is missing", () => {
    vi.stubEnv("PI_BB_TOOLS_FILE", join(dir, "gone.json"));
    const pi = createMockPi();

    registerExtension(pi);

    expect(registeredSurfaces(pi).tools).toContain("spawn");
  });

  it("keeps the foreground pi surface when PI_BB_TOOLS_FILE is unset", () => {
    vi.stubEnv("PI_BB_TOOLS_FILE", undefined);
    expect(process.env.PI_BB_TOOLS_FILE).toBeUndefined();
    const pi = createMockPi();

    registerExtension(pi);

    expect(registeredSurfaces(pi).tools).toContain("spawn");
    expect(registeredSurfaces(pi).commands).toEqual(["spawn", "minions", "halt"]);
  });

  // root reads files regardless of mode, so the unreadable case can only be built as another user.
  it.skipIf(process.getuid?.() === 0)(
    "keeps the foreground pi surface when the tools file exists but cannot be read",
    () => {
      const path = writeToolsFile(JSON.stringify([bbTool("spawn")]));
      chmodSync(path, 0o000);
      const pi = createMockPi();

      registerExtension(pi);

      expect(registeredSurfaces(pi).tools).toContain("spawn");
      expect(registeredSurfaces(pi).commands).toEqual(["spawn", "minions", "halt"]);
    },
  );
});
