import { bench, describe, expect, it } from "vitest";

describe("Spinner interval performance", () => {
  bench(
    "setInterval 80ms (current)",
    async () => {
      let _counter = 0;
      const interval = setInterval(() => {
        _counter++;
      }, 80);

      await new Promise((resolve) => setTimeout(resolve, 1000));
      clearInterval(interval);
    },
    { time: 2000 },
  );

  bench(
    "setInterval 200ms (proposed)",
    async () => {
      let _counter = 0;
      const interval = setInterval(() => {
        _counter++;
      }, 200);

      await new Promise((resolve) => setTimeout(resolve, 1000));
      clearInterval(interval);
    },
    { time: 2000 },
  );

  it("compare update frequency", async () => {
    // Run 80ms interval for 5 seconds
    let counter80 = 0;
    const interval80 = setInterval(() => {
      counter80++;
    }, 80);

    await new Promise((resolve) => setTimeout(resolve, 5000));
    clearInterval(interval80);

    // Run 200ms interval for 5 seconds
    let counter200 = 0;
    const interval200 = setInterval(() => {
      counter200++;
    }, 200);

    await new Promise((resolve) => setTimeout(resolve, 5000));
    clearInterval(interval200);

    // 80ms fires ~62 times in 5s, 200ms fires ~25 times in 5s
    // This shows a 60% reduction in updates
    console.log(`  80ms interval fired ${counter80} times`);
    console.log(`  200ms interval fired ${counter200} times`);
    console.log(`  Reduction: ${Math.round((1 - counter200 / counter80) * 100)}%`);

    // Rough assertions to verify the math
    expect(counter80).toBeGreaterThan(55); // ~62 expected
    expect(counter80).toBeLessThan(70);
    expect(counter200).toBeGreaterThan(20); // ~25 expected
    expect(counter200).toBeLessThan(30);
  }, 15000);
});
