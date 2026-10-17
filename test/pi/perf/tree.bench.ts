import { bench, describe } from "vitest";
import { AgentTree } from "../../../extensions/pi/tree.js";

describe("AgentTree performance", () => {
  bench(
    "add 1000 nodes",
    () => {
      const tree = new AgentTree();
      for (let i = 0; i < 1000; i++) {
        tree.add(`id${i}`, `name${i}`, `task${i}`);
      }
    },
    { time: 1000 },
  );

  bench(
    "getRunning with 1000 nodes",
    () => {
      const tree = new AgentTree();
      for (let i = 0; i < 1000; i++) {
        tree.add(`id${i}`, `name${i}`, `task${i}`);
      }

      tree.getRunning();
    },
    { time: 1000 },
  );

  bench(
    "getTotalUsage with 1000 nodes",
    () => {
      const tree = new AgentTree();
      for (let i = 0; i < 1000; i++) {
        tree.add(`id${i}`, `name${i}`, `task${i}`);
        tree.updateUsage(`id${i}`, { input: 100, output: 50, cost: 0.001 });
      }

      tree.getTotalUsage();
    },
    { time: 1000 },
  );

  bench(
    "updateStatus 1000 times",
    () => {
      const tree = new AgentTree();
      for (let i = 0; i < 1000; i++) {
        tree.add(`id${i}`, `name${i}`, `task${i}`);
      }

      for (let i = 0; i < 1000; i++) {
        tree.updateStatus(`id${i}`, "completed", 0);
      }
    },
    { time: 1000 },
  );
});
