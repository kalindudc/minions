import { mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";

const LOG_DIR = join("/tmp", "logs", "pi-minions");
export const LOG_FILE = join(LOG_DIR, "debug.log");

// Ensure directory exists at module load time
try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch {
  /* ignore */
}

const val = process.env.PI_MINIONS_DEBUG;
const debugEnabled = val === "1" || val === "true";

let _batch: string[] = [];
let _flushTimer: ReturnType<typeof setImmediate> | null = null;
let _writePromise: Promise<void> = Promise.resolve();

function scheduleFlush(): void {
  if (_flushTimer !== null) return;
  _flushTimer = setImmediate(() => {
    _flushTimer = null;
    if (_batch.length === 0) return;
    const data = _batch.join("");
    _batch = [];
    _writePromise = appendFile(LOG_FILE, data).catch(() => {});
  });
}

function write(level: string, scope: string, msg: string, data?: unknown): void {
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const suffix = data !== undefined ? ` ${JSON.stringify(data)}` : "";
  _batch.push(`[${ts}] [${level}] [${scope}] ${msg}${suffix}\n`);
  scheduleFlush();
}

/** Drain pending log writes. */
export async function flushLogger(): Promise<void> {
  if (_flushTimer !== null) {
    clearImmediate(_flushTimer);
    _flushTimer = null;
  }
  if (_batch.length > 0) {
    const data = _batch.join("");
    _batch = [];
    _writePromise = appendFile(LOG_FILE, data).catch(() => {});
  }
  await _writePromise;
}

export const logger = {
  debug(scope: string, msg: string, data?: unknown): void {
    if (!debugEnabled) return;
    write("DEBUG", scope, msg, data);
  },
  info(scope: string, msg: string, data?: unknown): void {
    write("INFO", scope, msg, data);
  },
  warn(scope: string, msg: string, data?: unknown): void {
    write("WARN", scope, msg, data);
  },
  error(scope: string, msg: string, data?: unknown): void {
    write("ERROR", scope, msg, data);
  },
};
