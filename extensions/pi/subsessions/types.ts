import type { AgentConfig } from "../../../src/types.js";

export interface MinionSessionMetadata {
  sessionId: string;
  parentSession: string;
  spawnedBy: string;
  name: string;
  task: string;
  agent?: string;
  createdAt: number;
  status: "running" | "completed" | "failed" | "aborted";
  exitCode?: number;
  error?: string;
}

export interface MinionSessionHandle {
  id: string;
  path: string;
  steer(text: string): Promise<void>;
  abort(): void;
}

export interface CreateMinionSessionOptions {
  id: string;
  name: string;
  task: string;
  config: AgentConfig;
  spawnedBy: string;
  cwd: string;
  modelRegistry: import("@earendil-works/pi-coding-agent").ModelRegistry;
  // biome-ignore lint/suspicious/noExplicitAny: external API type
  parentModel?: import("@earendil-works/pi-ai").Model<any>;
  parentSystemPrompt?: string;
  signal?: AbortSignal;
  customTools?: import("@earendil-works/pi-coding-agent").ToolDefinition[];
  parentToolNames?: string[];
  toolSyncEnabled?: boolean;
  toolSyncMaxWait?: number;
  onToolActivity?: (activity: {
    type: "start" | "end";
    toolName: string;
    args?: Record<string, unknown>;
  }) => void;
  onToolOutput?: (toolName: string, delta: string) => void;
  onTextDelta?: (delta: string, fullText: string) => void;
  onTurnEnd?: (turnCount: number) => void;
  onUsageUpdate?: (usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
  }) => void;
  onComplete?: (result: { exitCode: number; output: string }) => void;
}
