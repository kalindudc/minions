import type { AgentNode, AgentStatus } from "../../../extensions/pi/types.js";
import { emptyUsage } from "../../../extensions/pi/types.js";

export class MockAgentTree {
  nodes = new Map<string, AgentNode>();
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

  add(id: string, name: string, task: string, parentId?: string): AgentNode {
    const node: AgentNode = {
      id,
      name,
      task,
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

  getRunning(): AgentNode[] {
    return Array.from(this.nodes.values()).filter((n) => n.status === "running");
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
}
