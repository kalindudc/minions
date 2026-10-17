import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAgentDir } from "../../src/persona-frontmatter.js";

describe("getAgentDir, mirroring pi 1.2.0", () => {
  const home = "/home/tester";

  beforeEach(() => {
    vi.stubEnv("HOME", home);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to ~/.pi/agent when PI_CODING_AGENT_DIR is unset or empty", () => {
    vi.stubEnv("PI_CODING_AGENT_DIR", undefined);
    expect(getAgentDir()).toBe(join(home, ".pi", "agent"));

    vi.stubEnv("PI_CODING_AGENT_DIR", "");
    expect(getAgentDir()).toBe(join(home, ".pi", "agent"));
  });

  it.each([
    ["~", home],
    ["~/custom", join(home, "custom")],
    ["~/custom/../agent", join(home, "agent")],
    ["file:///opt/pi%20agent", "/opt/pi agent"],
    ["/srv/pi-agent", "/srv/pi-agent"],
    ["relative/agent", "relative/agent"],
  ])("resolves PI_CODING_AGENT_DIR=%s to %s", (value, expected) => {
    vi.stubEnv("PI_CODING_AGENT_DIR", value);

    expect(getAgentDir()).toBe(expected);
  });
});
