import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { BatchMinionItem, SpawnToolDetails } from "../tools/spawn.js";
import type { AgentStatus, UsageStats } from "../types.js";
import { emptyUsage } from "../types.js";

export function formatBatchOutput(minions: BatchMinionItem[], isSingleMinion: boolean): string {
  if (isSingleMinion && minions.length === 1) {
    return minions[0]?.finalOutput;
  }
  return minions.map((m) => `=== ${m.name} ===\n${m.finalOutput}`).join("\n\n");
}

export class BatchCoordinator {
  private minions: BatchMinionItem[];
  private isSingleMinion: boolean;
  private batchId: string;
  private batchName: string;
  private batchTask: string;
  private outputPreviewLines: number;
  private spinnerFrames: string[];
  private onUpdate?: (result: AgentToolResult<SpawnToolDetails>) => void;
  private completed = false;
  private spinnerInterval?: ReturnType<typeof setInterval>;

  constructor(opts: {
    minions: BatchMinionItem[];
    isSingleMinion: boolean;
    batchId: string;
    batchName?: string;
    batchTask: string;
    outputPreviewLines: number;
    spinnerFrames: string[];
    onUpdate?: (result: AgentToolResult<SpawnToolDetails>) => void;
  }) {
    this.minions = opts.minions;
    this.isSingleMinion = opts.isSingleMinion;
    this.batchId = opts.batchId;
    this.batchName = opts.batchName ?? `batch-${opts.batchId.slice(0, 8)}`;
    this.batchTask = opts.batchTask;
    this.outputPreviewLines = opts.outputPreviewLines;
    this.spinnerFrames = opts.spinnerFrames;
    this.onUpdate = opts.onUpdate;
  }

  start(): void {
    this.spinnerInterval = setInterval(() => {
      if (this.completed) return;
      let frameUpdated = false;
      for (const m of this.minions) {
        if (m.status === "running") {
          m.spinnerFrame = (m.spinnerFrame ?? 0) + 1;
          frameUpdated = true;
        }
      }
      if (frameUpdated) {
        this.emit();
      }
    }, 100);
  }

  stop(): void {
    this.completed = true;
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = undefined;
    }
  }

  /** Permanently disconnect from the parent agent's onUpdate callback.
   *  Call this after the final forced emit, before returning from the tool.
   *  Prevents stale events from reaching the parent after the tool call ends. */
  disconnect(): void {
    this.onUpdate = undefined;
  }

  emit(force = false): void {
    if (this.completed && !force) return;

    const firstMinion = this.minions[0];
    const status = this.getStatus();
    const totalUsage = this.getUsage();
    const finalOutput = this.getOutput();

    this.onUpdate?.({
      content: [{ type: "text", text: "" }],
      details: {
        id: this.isSingleMinion ? firstMinion?.id : this.batchId,
        name: this.isSingleMinion ? firstMinion?.name : this.batchName,
        agentName: this.isSingleMinion ? firstMinion?.agentName : "batch",
        task: this.isSingleMinion ? firstMinion?.task : this.batchTask,
        isBatch: !this.isSingleMinion,
        minions: [...this.minions],
        status,
        usage: totalUsage,
        model: firstMinion?.model,
        finalOutput,
        outputPreviewLines: this.outputPreviewLines,
        spinnerFrames: this.spinnerFrames,
      },
    });
  }

  getStatus(): AgentStatus {
    const anyAborted = this.minions.some((m) => m.status === "aborted");
    const anyFailed = this.minions.some((m) => m.status === "failed");
    const allCompleted =
      this.minions.length > 0 && this.minions.every((m) => m.status === "completed");
    const anyRunning = this.minions.some((m) => m.status === "running");

    if (anyAborted) return "aborted";
    if (anyFailed) return "failed";
    if (allCompleted) return "completed";
    if (anyRunning) return "running";
    return "failed";
  }

  getUsage(): UsageStats {
    return this.minions.reduce(
      (acc, m) => ({
        input: acc.input + m.usage.input,
        output: acc.output + m.usage.output,
        cacheRead: acc.cacheRead + m.usage.cacheRead,
        cacheWrite: acc.cacheWrite + m.usage.cacheWrite,
        cost: acc.cost + m.usage.cost,
        contextTokens: acc.contextTokens + m.usage.contextTokens,
        turns: acc.turns + m.usage.turns,
      }),
      emptyUsage(),
    );
  }

  getOutput(): string {
    return formatBatchOutput(this.minions, this.isSingleMinion);
  }

  getDetails(): SpawnToolDetails {
    const firstMinion = this.minions[0];
    return {
      id: this.isSingleMinion ? firstMinion?.id : this.batchId,
      name: this.isSingleMinion ? firstMinion?.name : this.batchName,
      agentName: this.isSingleMinion ? firstMinion?.agentName : "batch",
      task: this.isSingleMinion ? firstMinion?.task : this.batchTask,
      status: this.getStatus(),
      usage: this.getUsage(),
      model: firstMinion?.model,
      finalOutput: this.getOutput(),
      isBatch: !this.isSingleMinion,
      minions: [...this.minions],
      outputPreviewLines: this.outputPreviewLines,
      spinnerFrames: this.spinnerFrames,
    };
  }
}
