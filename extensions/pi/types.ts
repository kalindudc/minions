export type AgentStatus = "pending" | "running" | "completed" | "failed" | "aborted";

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

export function emptyUsage(): UsageStats {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    contextTokens: 0,
    turns: 0,
  };
}

export interface SpawnResult {
  exitCode: number;
  finalOutput: string;
  usage: UsageStats;
  error?: string;
}

export interface AgentNode {
  id: string;
  name: string;
  agentName?: string;
  task: string;
  status: AgentStatus;
  parentId?: string;
  children: string[];
  usage: UsageStats;
  startTime: number;
  endTime?: number;
  exitCode?: number;
  error?: string;
  /** Live activity line, e.g. "→ $ grep -r TODO src/" */
  lastActivity?: string;
  /** Persistent activity history for observability widget */
  activityHistory?: string[];
  /** Model used by this minion */
  model?: string;
}
