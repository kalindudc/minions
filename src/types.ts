export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type AgentSource = "user" | "project" | "ephemeral";

export interface AgentConfig {
  name: string;
  displayName?: string;
  description: string;
  tools?: string[];
  model?: string;
  thinking?: ThinkingLevel;
  provider?: string;
  reasoning?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  permission?: "accept-edits" | "auto" | "full";
  environment?: "shared" | "worktree";
  delegate?: boolean;
  steps?: number;
  timeout?: number;
  systemPrompt: string;
  source: AgentSource;
  filePath: string;
}

export interface PersonaWarning {
  name: string;
  path: string;
  reason: string;
}
