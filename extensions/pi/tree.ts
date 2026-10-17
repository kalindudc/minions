import type { AgentNode, AgentStatus, UsageStats } from "./types.js";
import { emptyUsage } from "./types.js";

export class AgentTree {
  private nodes = new Map<string, AgentNode>();
  private listeners = new Set<() => void>();

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  add(
    id: string,
    name: string,
    task: string,
    parentId?: string,
    agentName?: string,
    model?: string,
  ): AgentNode {
    const node: AgentNode = {
      id,
      name,
      agentName,
      task,
      model,
      status: "running",
      parentId,
      children: [],
      usage: emptyUsage(),
      startTime: Date.now(),
    };
    this.nodes.set(id, node);

    if (parentId) {
      const parent = this.nodes.get(parentId);
      if (parent) parent.children.push(id);
    }

    this.notify();
    return node;
  }

  get(id: string): AgentNode | undefined {
    return this.nodes.get(id);
  }

  /** Find a node by ID or by minion name. ID takes priority. */
  resolve(idOrName: string): AgentNode | undefined {
    const byId = this.nodes.get(idOrName);
    if (byId) return byId;

    // Fall back to name match (most recent if multiple share a name)
    let match: AgentNode | undefined;
    for (const node of this.nodes.values()) {
      if (node.name === idOrName) {
        if (!match || node.startTime > match.startTime) match = node;
      }
    }

    return match;
  }

  getRunning(): AgentNode[] {
    return Array.from(this.nodes.values()).filter((n) => n.status === "running");
  }

  getRoots(): AgentNode[] {
    return Array.from(this.nodes.values()).filter((n) => n.parentId === undefined);
  }

  getDepth(id: string): number {
    const node = this.nodes.get(id);
    if (!node) return 0;

    let depth = 0;
    let current = node;
    while (current.parentId) {
      const parent = this.nodes.get(current.parentId);
      if (!parent) break;

      depth++;
      current = parent;
    }

    return depth;
  }

  updateStatus(id: string, status: AgentStatus, exitCode?: number, error?: string): void {
    const node = this.nodes.get(id);
    if (!node) return;

    node.status = status;
    if (exitCode !== undefined) node.exitCode = exitCode;
    if (error !== undefined) node.error = error;
    if (status !== "running" && status !== "pending") node.endTime = Date.now();

    this.notify();
  }

  updateUsage(id: string, partial: Partial<UsageStats>): void {
    const node = this.nodes.get(id);
    if (!node) return;

    Object.assign(node.usage, partial);
    this.notify();
  }

  getTotalUsage(): UsageStats {
    const total = emptyUsage();

    for (const node of this.nodes.values()) {
      total.input += node.usage.input;
      total.output += node.usage.output;
      total.cacheRead += node.usage.cacheRead;
      total.cacheWrite += node.usage.cacheWrite;
      total.cost += node.usage.cost;
      total.contextTokens += node.usage.contextTokens;
      total.turns += node.usage.turns;
    }
    return total;
  }

  updateActivity(id: string, activity: string): void {
    const node = this.nodes.get(id);
    if (node) {
      node.lastActivity = activity;
      this.notify();
    }
  }

  logActivity(id: string, activity: string): void {
    const node = this.nodes.get(id);
    if (node) {
      node.lastActivity = activity;
      if (!node.activityHistory) node.activityHistory = [];
      node.activityHistory.push(activity);
      this.notify();
    }
  }

  setActivityHistory(id: string, history: string[]): void {
    const node = this.nodes.get(id);
    if (node) {
      node.activityHistory = [...history];
      this.notify();
    }
  }

  remove(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;

    // Remove children recursively first
    for (const childId of [...node.children]) {
      this.remove(childId);
    }

    // Remove from parent's children list
    if (node.parentId) {
      const parent = this.nodes.get(node.parentId);
      if (parent) {
        parent.children = parent.children.filter((c) => c !== id);
      }
    }

    this.nodes.delete(id);
    this.notify();
  }
}
