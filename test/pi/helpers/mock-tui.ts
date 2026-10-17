import type { Component } from "@earendil-works/pi-tui";

export interface RenderLogEntry {
  component: string;
  lines: string[];
  width: number;
}

export class MockTUI {
  renderLog: RenderLogEntry[] = [];

  render(component: Component, width: number): string[] {
    const lines = component.render(width);
    this.renderLog.push({
      component: component.constructor.name,
      lines,
      width,
    });
    return lines;
  }

  getLastFrame(): string[] | undefined {
    return this.renderLog.at(-1)?.lines;
  }

  findFrames(predicate: (lines: string[]) => boolean): string[][] {
    return this.renderLog.filter((entry) => predicate(entry.lines)).map((entry) => entry.lines);
  }

  clear(): void {
    this.renderLog.length = 0;
  }
}
