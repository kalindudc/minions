import { describe, expect, it, vi } from "vitest";

const mockReadFileSync = vi.fn();
vi.mock("node:fs", () => ({
  readFileSync: mockReadFileSync,
}));

vi.mock("../../extensions/pi/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("version module", () => {
  it("exports VERSION from package.json", async () => {
    mockReadFileSync.mockReturnValueOnce(JSON.stringify({ version: "1.2.3-test" }));

    const { VERSION } = await import("../../extensions/pi/version.js");

    expect(VERSION).toBe("1.2.3-test");
  });
});
