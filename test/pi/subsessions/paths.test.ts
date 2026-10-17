import { describe, expect, it } from "vitest";
import {
  getMinionsDir,
  getTempSessionPath,
  hashCwd,
} from "../../../extensions/pi/subsessions/paths.js";

describe("hashCwd", () => {
  it("should return a base64url encoded string", () => {
    const hash = hashCwd("/home/user/project");
    expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
    // Hash is now full base64url encoding of the path
    expect(hash.length).toBeGreaterThan(0);
  });

  it("should return consistent hashes for the same cwd", () => {
    const hash1 = hashCwd("/home/user/project");
    const hash2 = hashCwd("/home/user/project");
    expect(hash1).toBe(hash2);
  });

  it("should return different hashes for different cwds", () => {
    const hash1 = hashCwd("/home/user/project-alpha");
    const hash2 = hashCwd("/home/user/project-beta");
    expect(hash1).not.toBe(hash2);
  });
});

describe("getMinionsDir", () => {
  it("should return a path under ~/.pi/agent/sessions", () => {
    const dir = getMinionsDir("/home/user/project");
    expect(dir).toContain(".pi/agent/sessions");
    expect(dir).toContain("minions");
  });

  it("should include safe cwd in path using pi's standard format", () => {
    const cwd = "/home/user/project";
    const dir = getMinionsDir(cwd);
    // Pi's standard format replaces path separators with dashes
    // /home/user/project becomes --home-user-project--
    expect(dir).toContain("--home-user-project--");
  });

  it("should handle paths with special characters", () => {
    const cwd = "/path/with:colon";
    const dir = getMinionsDir(cwd);
    // Colons should be replaced with dashes
    expect(dir).toContain("--path-with-colon--");
  });
});

describe("getTempSessionPath", () => {
  it("should return a path under /tmp/pi-minions", () => {
    const path = getTempSessionPath("/home/user/project");
    expect(path.startsWith("/tmp/pi-minions/")).toBe(true);
    expect(path.endsWith(".jsonl")).toBe(true);
  });

  it("should include hashed cwd in path", () => {
    const cwd = "/home/user/project";
    const path = getTempSessionPath(cwd);
    const hash = hashCwd(cwd);
    expect(path).toContain(hash);
  });

  it("should be different for different cwds", () => {
    const path1 = getTempSessionPath("/home/user/project-alpha");
    const path2 = getTempSessionPath("/home/user/project-beta");
    expect(path1).not.toBe(path2);
  });
});
