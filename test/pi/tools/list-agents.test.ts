import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/agents.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/agents.js")>()),
  discoverAgents: vi.fn(),
}));
vi.mock("../../../extensions/pi/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../extensions/pi/config.js")>();
  return {
    ...actual,
    getConfig: vi.fn(actual.getConfig),
  };
});

import { getConfig } from "../../../extensions/pi/config.js";
import { listAgents } from "../../../extensions/pi/tools/list-agents.js";
import { discoverAgents } from "../../../src/agents.js";

const mockAgent = {
  name: "scout",
  description: "Fast recon",
  systemPrompt: "You are a scout.",
  source: "user" as const,
  filePath: "/tmp/scout.md",
};

function createCtx() {
  return {
    cwd: "/tmp",
    modelRegistry: {},
    model: undefined,
    ui: {},
  } as any;
}

function defaultConfig() {
  return {
    minionNames: ["test"],
    allowEphemeral: true,
    display: {
      outputPreviewLines: 20,
      observabilityLines: 6,
      showStatusHints: true,
      spinnerFrames: ["[oo]"],
    },
    toolSync: { enabled: true, maxWait: 5 },
  };
}

beforeEach(() => {
  vi.mocked(discoverAgents).mockReturnValue({
    agents: [mockAgent],
    projectAgentsDir: null,
    warnings: [],
  });
  vi.mocked(getConfig).mockReturnValue(defaultConfig());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("list-agents", () => {
  it("includes ephemeral minion when allowEphemeral is true", async () => {
    const execute = listAgents();
    const result = await execute("tc", {} as never, undefined, undefined, createCtx());

    expect(result.content[0]).toHaveProperty("text");
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("minion (built-in)");
    expect(text).toContain("scout");

    expect(result.details).toHaveLength(2);
    expect(result.details![0].name).toBe("minion");
    expect(result.details![1].name).toBe("scout");
  });

  it("hides ephemeral minion when allowEphemeral is false", async () => {
    vi.mocked(getConfig).mockReturnValue({ ...defaultConfig(), allowEphemeral: false });

    const execute = listAgents();
    const result = await execute("tc", {} as never, undefined, undefined, createCtx());

    const text = (result.content[0] as { text: string }).text;
    expect(text).not.toContain("minion (built-in)");
    expect(text).toContain("scout");

    expect(result.details).toHaveLength(1);
    expect(result.details![0].name).toBe("scout");
  });

  it("shows only named agents when ephemeral is disabled and multiple agents exist", async () => {
    const anotherAgent = {
      ...mockAgent,
      name: "builder",
      description: "Builds things",
    };
    vi.mocked(discoverAgents).mockReturnValue({
      agents: [mockAgent, anotherAgent],
      projectAgentsDir: null,
      warnings: [],
    });
    vi.mocked(getConfig).mockReturnValue({ ...defaultConfig(), allowEphemeral: false });

    const execute = listAgents();
    const result = await execute("tc", {} as never, undefined, undefined, createCtx());

    expect(result.details).toHaveLength(2);
    expect(result.details!.map((d) => d.name)).toEqual(["scout", "builder"]);
  });

  it("lists the persona files it skipped, with each file and reason", async () => {
    vi.mocked(discoverAgents).mockReturnValue({
      agents: [mockAgent],
      projectAgentsDir: null,
      warnings: [{ name: "broken", path: "/tmp/broken.md", reason: 'invalid reasoning "extreme"' }],
    });

    const result = await listAgents()("tc", {} as never, undefined, undefined, createCtx());

    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("scout (user): Fast recon");
    expect(text).toMatch(
      /Skipped persona files[^\n]*\n- \/tmp\/broken\.md: invalid reasoning "extreme"/,
    );
    expect(result.details!.map((d) => d.name)).not.toContain("broken");
  });
});
