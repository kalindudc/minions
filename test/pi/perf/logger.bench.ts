import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench, describe, it } from "vitest";

describe("Logger I/O performance", () => {
  let tempDir: string;
  let tempFile: string;

  bench(
    "log 1000 messages (sync)",
    () => {
      for (let i = 0; i < 1000; i++) {
        appendFileSync(tempFile, `[${i}] Test log message\n`);
      }
    },
    {
      time: 2000,
      setup: () => {
        tempDir = mkdtempSync(join(tmpdir(), "perf-test-"));
        tempFile = join(tempDir, "test.log");
        writeFileSync(tempFile, "");
      },
      teardown: () => {
        try {
          rmSync(tempDir, { recursive: true });
        } catch {
          /* ignore */
        }
      },
    },
  );

  bench(
    "log 100 messages large payload",
    () => {
      const largePayload = "x".repeat(10 * 1024); // 10KB
      for (let i = 0; i < 100; i++) {
        appendFileSync(tempFile, `[${i}] ${largePayload}\n`);
      }
    },
    {
      time: 1000,
      setup: () => {
        tempDir = mkdtempSync(join(tmpdir(), "perf-test-"));
        tempFile = join(tempDir, "test.log");
        writeFileSync(tempFile, "");
      },
      teardown: () => {
        try {
          rmSync(tempDir, { recursive: true });
        } catch {
          /* ignore */
        }
      },
    },
  );

  it("sync I/O blocks event loop", () => {
    const tempDir2 = mkdtempSync(join(tmpdir(), "perf-test-"));
    const tempFile2 = join(tempDir2, "test.log");
    writeFileSync(tempFile2, "");

    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      appendFileSync(tempFile2, `[${i}] Test log message for sync I/O test\n`);
    }
    const duration = Date.now() - start;

    try {
      rmSync(tempDir2, { recursive: true });
    } catch {
      /* ignore */
    }

    // This demonstrates sync I/O bottleneck - synchronous writes block
    // the event loop. With async I/O, this would be faster.
    console.log(`  100 sync writes took ${duration}ms`);
  });
});
