import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

/**
 * Creates a mock ExtensionContext for testing.
 *
 * @param cwd - The working directory to use in the mock context
 * @returns A mock ExtensionContext suitable for unit tests
 */
export function createMockContext(cwd: string): ExtensionContext {
  return {
    ui: {
      setStatus: vi.fn(),
      setWidget: vi.fn(),
      onTerminalInput: vi.fn().mockReturnValue(() => {}),
      notify: vi.fn(),
      theme: { fg: vi.fn((_, text: string) => text) } as any,
    } as any,
    hasUI: true,
    cwd,
    sessionManager: {
      getCwd: vi.fn().mockReturnValue(cwd),
      getSessionDir: vi.fn().mockReturnValue(join(cwd, ".pi", "sessions")),
      getSessionId: vi.fn().mockReturnValue("test-session"),
      getSessionFile: vi.fn(),
      getLeafId: vi.fn(),
      getLeafEntry: vi.fn(),
      getEntry: vi.fn(),
      getLabel: vi.fn(),
      getBranch: vi.fn().mockReturnValue([]),
      getHeader: vi.fn(),
      getEntries: vi.fn().mockReturnValue([]),
      getTree: vi.fn().mockReturnValue([]),
      getSessionName: vi.fn(),
    } as any,
    modelRegistry: {} as any,
    model: undefined,
    isIdle: vi.fn().mockReturnValue(true),
    signal: undefined,
    abort: vi.fn(),
    hasPendingMessages: vi.fn().mockReturnValue(false),
    shutdown: vi.fn(),
    getContextUsage: vi.fn(),
    compact: vi.fn(),
    getSystemPrompt: vi.fn().mockReturnValue(""),
  };
}
