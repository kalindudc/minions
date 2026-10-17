import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LOG_PATH = "/tmp/logs/pi-minions/debug.log";

function cleanLog() {
  try {
    if (existsSync(LOG_PATH)) unlinkSync(LOG_PATH);
  } catch {
    /* ignore */
  }
}

function readLog(): string {
  try {
    return readFileSync(LOG_PATH, "utf-8");
  } catch {
    return "";
  }
}

describe("logger", () => {
  beforeEach(() => {
    cleanLog();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("debug writes when PI_MINIONS_DEBUG=1", async () => {
    vi.stubEnv("PI_MINIONS_DEBUG", "1");
    const { logger, flushLogger } = await import("../../extensions/pi/logger.js");
    logger.debug("test", "hello debug");
    await flushLogger();
    const log = readLog();
    expect(log).toContain("[DEBUG]");
    expect(log).toContain("[test]");
    expect(log).toContain("hello debug");
  });

  it("debug is silent when PI_MINIONS_DEBUG is unset", async () => {
    vi.stubEnv("PI_MINIONS_DEBUG", "");
    const { logger } = await import("../../extensions/pi/logger.js");
    logger.debug("test", "should not appear");
    const log = readLog();
    expect(log).not.toContain("should not appear");
  });

  it("info always writes regardless of debug flag", async () => {
    vi.stubEnv("PI_MINIONS_DEBUG", "");
    const { logger, flushLogger } = await import("../../extensions/pi/logger.js");
    logger.info("test", "info message");
    await flushLogger();
    const log = readLog();
    expect(log).toContain("[INFO]");
    expect(log).toContain("info message");
  });

  it("warn always writes regardless of debug flag", async () => {
    vi.stubEnv("PI_MINIONS_DEBUG", "");
    const { logger, flushLogger } = await import("../../extensions/pi/logger.js");
    logger.warn("test", "warn message");
    await flushLogger();
    const log = readLog();
    expect(log).toContain("[WARN]");
    expect(log).toContain("warn message");
  });

  it("error always writes regardless of debug flag", async () => {
    vi.stubEnv("PI_MINIONS_DEBUG", "");
    const { logger, flushLogger } = await import("../../extensions/pi/logger.js");
    logger.error("test", "error message");
    await flushLogger();
    const log = readLog();
    expect(log).toContain("[ERROR]");
    expect(log).toContain("error message");
  });

  it("includes JSON data when provided", async () => {
    vi.stubEnv("PI_MINIONS_DEBUG", "1");
    const { logger, flushLogger } = await import("../../extensions/pi/logger.js");
    logger.info("test", "with data", { key: "value" });
    await flushLogger();
    const log = readLog();
    expect(log).toContain('{"key":"value"}');
  });

  it("writes to correct log path", async () => {
    const { LOG_FILE } = await import("../../extensions/pi/logger.js");
    expect(LOG_FILE).toBe(LOG_PATH);
  });

  it("uses correct format: [HH:MM:SS.mmm] [LEVEL] [scope] message", async () => {
    vi.stubEnv("PI_MINIONS_DEBUG", "1");
    const { logger, flushLogger } = await import("../../extensions/pi/logger.js");
    logger.info("myscope", "test format");
    await flushLogger();
    const log = readLog();
    expect(log).toMatch(/\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[INFO\] \[myscope\] test format/);
  });
});
