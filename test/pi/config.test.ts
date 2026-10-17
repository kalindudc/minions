import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MINION_NAMES,
  DEFAULT_SPINNER_FRAMES,
  getConfig,
  type PiMinionsConfig,
  type ResolvedConfig,
} from "../../extensions/pi/config.js";
import { createMockContext } from "./helpers/mock-context.js";

describe("getConfig", () => {
  let tempDir: string;
  let agentDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = join(tmpdir(), `pi-minions-test-${Date.now()}`);
    agentDir = join(tempDir, "agent");
    mkdirSync(join(tempDir, ".pi"), { recursive: true });
    mkdirSync(agentDir, { recursive: true });

    originalEnv = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalEnv;
    }

    try {
      rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("returns slim defaults when no settings files exist", () => {
    const config = getConfig(createMockContext(tempDir));

    expect(config.minionNames).toEqual(DEFAULT_MINION_NAMES);
    expect(config.allowEphemeral).toBe(true);
    expect(config.display.outputPreviewLines).toBe(20);
    expect(config.display.observabilityLines).toBe(6);
    expect(config.display.showStatusHints).toBe(true);
    expect(config.display.spinnerFrames).toEqual(DEFAULT_SPINNER_FRAMES);
    expect(config.toolSync.enabled).toBe(true);
    expect(config.toolSync.maxWait).toBe(5);
  });

  it("keeps the built-in minion name and spinner pools stable", () => {
    expect(DEFAULT_MINION_NAMES).toHaveLength(61);
    expect(DEFAULT_MINION_NAMES[0]).toBe("kevin");
    expect(DEFAULT_MINION_NAMES).toContain("stuart");
    expect(DEFAULT_SPINNER_FRAMES).toHaveLength(10);
  });

  it("reads minionNames and allowEphemeral from global settings", () => {
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({
        "pi-minions": {
          minionNames: ["alpha", "beta"],
          allowEphemeral: false,
        },
      }),
    );

    const config = getConfig(createMockContext(tempDir));

    expect(config.minionNames).toEqual(["alpha", "beta"]);
    expect(config.allowEphemeral).toBe(false);
  });

  it("reads display and toolSync settings from global settings", () => {
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({
        "pi-minions": {
          display: {
            outputPreviewLines: 30,
            observabilityLines: 8,
            showStatusHints: false,
            spinnerFrames: ["◐", "◓"],
          },
          toolSync: {
            enabled: false,
            maxWait: 10,
          },
        },
      }),
    );

    const config = getConfig(createMockContext(tempDir));

    expect(config.display.outputPreviewLines).toBe(30);
    expect(config.display.observabilityLines).toBe(8);
    expect(config.display.showStatusHints).toBe(false);
    expect(config.display.spinnerFrames).toEqual(["◐", "◓"]);
    expect(config.toolSync.enabled).toBe(false);
    expect(config.toolSync.maxWait).toBe(10);
  });

  it("project settings override global settings and deep-merge display/toolSync", () => {
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({
        "pi-minions": {
          minionNames: ["global"],
          display: { outputPreviewLines: 40, observabilityLines: 9 },
          toolSync: { enabled: false, maxWait: 20 },
        },
      }),
    );
    writeFileSync(
      join(tempDir, ".pi", "settings.json"),
      JSON.stringify({
        "pi-minions": {
          minionNames: ["project"],
          display: { outputPreviewLines: 12 },
          toolSync: { maxWait: 3 },
        },
      }),
    );

    const config = getConfig(createMockContext(tempDir));

    expect(config.minionNames).toEqual(["project"]);
    expect(config.display.outputPreviewLines).toBe(12);
    expect(config.display.observabilityLines).toBe(9);
    expect(config.toolSync.enabled).toBe(false);
    expect(config.toolSync.maxWait).toBe(3);
  });

  it("uses defaults when settings are partial, malformed, or missing the pi-minions key", () => {
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ other: true }));
    writeFileSync(join(tempDir, ".pi", "settings.json"), "not-json");

    const config = getConfig(createMockContext(tempDir));

    expect(config.minionNames).toEqual(DEFAULT_MINION_NAMES);
    expect(config.allowEphemeral).toBe(true);
    expect(config.display.outputPreviewLines).toBe(20);
    expect(config.toolSync.maxWait).toBe(5);
  });
});

describe("Config types", () => {
  it("ResolvedConfig has only supported foreground-era sections", () => {
    const mockResolved: ResolvedConfig = {
      minionNames: ["a"],
      allowEphemeral: true,
      display: {
        outputPreviewLines: 20,
        observabilityLines: 6,
        showStatusHints: true,
        spinnerFrames: ["-"],
      },
      toolSync: {
        enabled: true,
        maxWait: 5,
      },
    };

    expect(mockResolved.display.observabilityLines).toBe(6);
    expect(mockResolved.toolSync.enabled).toBe(true);
  });

  it("PiMinionsConfig allows partial supported configuration", () => {
    const partial: PiMinionsConfig = { minionNames: ["a", "b"] };
    const partial2: PiMinionsConfig = { display: { showStatusHints: false } };

    expect(partial.minionNames).toEqual(["a", "b"]);
    expect(partial2.display?.showStatusHints).toBe(false);
  });
});
