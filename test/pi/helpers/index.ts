export { type HarnessOptions, TestHarness } from "./harness.js";
export { MockAgentSession, MockSubsessionManager } from "./mock-subsession.js";
export { MockAgentTree } from "./mock-tree.js";
export { MockTUI, type RenderLogEntry } from "./mock-tui.js";

import { type HarnessOptions, TestHarness } from "./harness.js";

export function createTestHarness(options?: HarnessOptions): TestHarness {
  return new TestHarness(options);
}
