// @vitest-environment jsdom
import {
  loadPluginApp,
  type PluginRpcTestHandlers,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { rpcContract } from "../../extensions/bb/server.js";
import type { MinionRow } from "../../extensions/bb/state.js";

type Contract = typeof rpcContract;
const PARENT = "th_parent";

function row(overrides: Partial<MinionRow> = {}): MinionRow {
  return {
    id: "th_a",
    title: "researcher · Find the bug",
    persona: "researcher",
    task: "Find the bug",
    status: "active",
    providerId: "codex",
    model: "gpt-5.2",
    createdAt: Date.now() - 5 * 60_000,
    needsInput: false,
    progress: null,
    outputPreview: null,
    ...overrides,
  };
}

function handlers(overrides: Partial<PluginRpcTestHandlers<Contract>> = {}) {
  const unexpected = (method: string) => () => {
    throw new Error(`unexpected ${method} call`);
  };
  return {
    threadInfo: () => null,
    listMinions: () => ({ minions: [] }),
    minionCounts: () => ({ running: 0, waiting: 0, done: 0, failed: 0 }),
    listAgents: () => ({ agents: [], warnings: [] }),
    showMinion: unexpected("showMinion"),
    spawnMinion: unexpected("spawnMinion"),
    stop: () => ({ ok: true as const }),
    archive: () => ({ ok: true as const }),
    tell: () => ({ ok: true as const }),
    ...overrides,
  } as PluginRpcTestHandlers<Contract>;
}

async function loadApp() {
  return loadPluginApp(() => import("../../extensions/bb/app.js"));
}

async function renderPanel(rpc: PluginRpcTestHandlers<Contract>) {
  const app = await loadApp();
  return renderSlot(
    app.threadPanelActions[0]!,
    { threadId: PARENT, params: null },
    { rpc, realtimeConnectionState: "connected" },
  );
}

async function renderButton(
  rpc: PluginRpcTestHandlers<Contract>,
  options: { threadId?: string; openThreadPanel?: () => boolean } = {},
) {
  const app = await loadApp();
  return renderSlot(
    app.composerCustomizations[0]!.actions![0]!,
    {},
    {
      rpc,
      realtimeConnectionState: "connected",
      composer: { scope: { kind: "thread", threadId: options.threadId ?? PARENT } },
      ...(options.openThreadPanel ? { openThreadPanel: options.openThreadPanel } : {}),
    },
  );
}

type Slot = Awaited<ReturnType<typeof renderButton>>;

function hover(slot: Slot, button: HTMLElement) {
  fireEvent.pointerMove(button, { pointerType: "mouse" });
  return slot.findByRole("tooltip");
}

// bb's tooltip opens on focus only after a key press, as it does for keyboard users.
function focusWithKeyboard(slot: Slot, button: HTMLElement) {
  fireEvent.keyDown(document.body, { key: "Tab" });
  act(() => button.focus());
  return slot.findByRole("tooltip");
}

// One full pass through the blink frames, so a blink anywhere in the cycle is seen.
const BLINK_CYCLE_MS = 1_000;

// Each wait gets its own act() so React renders the frame before the next sample.
async function marksShownFor(button: HTMLElement, ms: number): Promise<Set<string>> {
  const seen = new Set([button.textContent ?? ""]);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await act(async () => {
      await new Promise((settle) => setTimeout(settle, 25));
    });
    seen.add(button.textContent ?? "");
  }
  return seen;
}

const callsTo = (slot: { inspection: { rpcCalls: { method: string }[] } }, method: string) =>
  slot.inspection.rpcCalls.filter((call) => call.method === method).length;

const listCalls = (slot: { inspection: { rpcCalls: { method: string }[] } }) =>
  callsTo(slot, "listMinions");

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Minions app registration", () => {
  it("registers a flush Minions tab and a Minions button in the thread composer, and nothing in the header", async () => {
    const app = await loadApp();

    expect(app.threadPanelActions).toMatchObject([
      { id: "minions", title: "Minions", layout: "flush" },
    ]);
    expect(app.threadHeaderActions).toEqual([]);
    expect(app.composerCustomizations).toMatchObject([
      { id: "minions", scopes: ["thread"], actions: [{ id: "minions-status" }] },
    ]);
    expect(app.composerCustomizations[0]!.banners ?? []).toEqual([]);
  });
});

describe("Minions tab", () => {
  it("shows an empty state when the thread has no minions", async () => {
    const slot = await renderPanel(handlers());

    expect(await slot.findByText(/No minions yet/)).toBeTruthy();
    expect(slot.inspection.rpcCalls).toEqual([
      { method: "listMinions", input: { threadId: PARENT } },
    ]);
  });

  it("lists each minion's persona, task, model, status, quest progress and preview", async () => {
    const slot = await renderPanel(
      handlers({
        listMinions: () => ({
          minions: [
            row({
              progress: { done: 2, total: 5, current: "Reading auth.ts" },
              outputPreview: "Found it in the session check",
            }),
            row({
              id: "th_b",
              persona: "minion",
              task: "Summarize",
              status: "idle",
              needsInput: true,
            }),
          ],
        }),
      }),
    );

    expect(await slot.findByText("Find the bug")).toBeTruthy();
    expect(slot.getByText("Summarize")).toBeTruthy();
    expect(slot.getAllByText(/codex · gpt-5\.2/)).toHaveLength(2);
    expect(slot.getByText(/quests 2\/5/)).toBeTruthy();
    expect(slot.getByText("Reading auth.ts")).toBeTruthy();
    expect(slot.getByText("Found it in the session check")).toBeTruthy();
    expect(slot.getByText("active")).toBeTruthy();
    expect(slot.getByText("waiting for input")).toBeTruthy();
    expect(slot.getAllByText("5m")).toHaveLength(2);
  });

  it("opens a minion's conversation and acts on it", async () => {
    const slot = await renderPanel(handlers({ listMinions: () => ({ minions: [row()] }) }));

    fireEvent.click(await slot.findByText("Find the bug"));
    const chat = await slot.findByTestId("bb-thread-chat");
    expect(chat.dataset).toMatchObject({
      threadId: "th_a",
      variant: "compact",
      layout: "contained",
    });

    fireEvent.click(slot.getByRole("button", { name: "Stop" }));
    fireEvent.click(slot.getByRole("button", { name: "Open" }));
    fireEvent.click(slot.getByRole("button", { name: "Message" }));
    fireEvent.change(await slot.findByLabelText("Message to the minion"), {
      target: { value: "Also check the tests" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
    fireEvent.click(slot.getByRole("button", { name: "Archive" }));

    await waitFor(() =>
      expect(slot.inspection.rpcCalls.filter((call) => call.method !== "listMinions")).toEqual([
        { method: "stop", input: { threadId: PARENT, id: "th_a" } },
        { method: "tell", input: { threadId: PARENT, id: "th_a", text: "Also check the tests" } },
        { method: "archive", input: { threadId: PARENT, id: "th_a" } },
      ]),
    );
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "th_a" }]);
  });

  it("shows persona files that could not be loaded in the new-minion form", async () => {
    const slot = await renderPanel(
      handlers({
        listAgents: () => ({
          agents: [],
          warnings: [
            {
              name: "broken",
              path: "/work/.pi/agents/broken.md",
              reason: 'invalid reasoning "extreme"',
            },
          ],
        }),
      }),
    );

    fireEvent.click(await slot.findByRole("button", { name: "New minion" }));

    expect(
      await slot.findByText('/work/.pi/agents/broken.md: invalid reasoning "extreme"'),
    ).toBeTruthy();
  });

  it("starts a minion from the new-minion form", async () => {
    const spawned: unknown[] = [];
    const slot = await renderPanel(
      handlers({
        listAgents: () => ({
          agents: [
            { name: "researcher", description: "Researches", provider: "codex", model: "gpt-5.2" },
          ],
          warnings: [],
        }),
        spawnMinion: (input) => {
          spawned.push(input);
          return {
            ok: true,
            id: "th_new",
            persona: "researcher",
            model: "gpt-5.2",
            environment: "worktree",
          };
        },
      }),
    );

    fireEvent.click(await slot.findByRole("button", { name: "New minion" }));
    await slot.findByRole("option", { name: /researcher/ });
    fireEvent.change(slot.getByLabelText("Persona"), { target: { value: "researcher" } });
    fireEvent.change(slot.getByLabelText("Task"), {
      target: { value: "Investigate the flaky test" },
    });
    fireEvent.change(slot.getByLabelText("Environment"), { target: { value: "worktree" } });
    fireEvent.click(slot.getByRole("button", { name: "Start minion" }));

    await waitFor(() =>
      expect(spawned).toEqual([
        {
          threadId: PARENT,
          task: "Investigate the flaky test",
          agent: "researcher",
          environment: "worktree",
        },
      ]),
    );
  });

  it("keeps RPC failures and refused spawns visible", async () => {
    const failing = await renderPanel(
      handlers({
        listMinions: () => {
          throw new Error("bb is unreachable");
        },
      }),
    );
    expect((await failing.findByRole("alert")).textContent).toContain("bb is unreachable");
    failing.lifecycle.unmount();

    const refused = await renderPanel(
      handlers({
        spawnMinion: (input) => ({ ok: false, task: input.task, error: 'Unknown persona "ghost"' }),
      }),
    );
    fireEvent.click(await refused.findByRole("button", { name: "New minion" }));
    fireEvent.change(await refused.findByLabelText("Task"), { target: { value: "Haunt" } });
    fireEvent.click(refused.getByRole("button", { name: "Start minion" }));
    expect((await refused.findByRole("alert")).textContent).toContain('Unknown persona "ghost"');
  });

  it("ignores an older list response that arrives after a newer one", async () => {
    const first = deferred<{ minions: MinionRow[] }>();
    let calls = 0;
    const slot = await renderPanel(
      handlers({
        listMinions: () => {
          calls += 1;
          return calls === 1
            ? first.promise
            : { minions: [row({ id: "th_new", task: "Newer task" })] };
        },
      }),
    );
    await waitFor(() => expect(calls).toBe(1));

    await slot.behavior.emitRealtime("minions", { threadId: PARENT });
    expect(await slot.findByText("Newer task")).toBeTruthy();
    await act(async () => {
      first.resolve({ minions: [row({ id: "th_old", task: "Older task" })] });
      await new Promise((settle) => setTimeout(settle, 20));
    });

    expect(slot.queryByText("Older task")).toBeNull();
    expect(slot.getByText("Newer task")).toBeTruthy();
  });

  it("refetches when the realtime connection comes back, since missed signals are not replayed", async () => {
    const slot = await renderPanel(handlers());
    await waitFor(() => expect(listCalls(slot)).toBe(1));

    await slot.behavior.setRealtimeConnectionState("reconnecting");
    expect(listCalls(slot)).toBe(1);
    await slot.behavior.setRealtimeConnectionState("connected");

    await waitFor(() => expect(listCalls(slot)).toBe(2));
  });

  it("refetches when this thread's minions change but not for another thread", async () => {
    const slot = await renderPanel(handlers());
    await waitFor(() => expect(listCalls(slot)).toBe(1));

    await slot.behavior.emitRealtime("minions", { threadId: "th_other" });
    expect(listCalls(slot)).toBe(1);
    await slot.behavior.emitRealtime("minions", { threadId: PARENT });
    await waitFor(() => expect(listCalls(slot)).toBe(2));
    await slot.behavior.emitRealtime("minions", { threadId: null });
    await waitFor(() => expect(listCalls(slot)).toBe(3));
  });
});

describe("Minions button", () => {
  it("counts running, waiting, done and failed minions separately and opens the Minions tab", async () => {
    const slot = await renderButton(
      handlers({ minionCounts: () => ({ running: 2, waiting: 1, done: 3, failed: 1 }) }),
    );

    const button = await slot.findByRole("button", {
      name: "Minions: 2 running · 1 waiting · 3 done · 1 failed",
    });
    fireEvent.click(button);

    expect(button.className).toContain("text-warning");
    expect(slot.inspection.navigateCalls).toEqual([
      { method: "openThreadPanel", options: { actionId: "minions" } },
    ]);
    expect(listCalls(slot)).toBe(0);
  });

  it("is muted when the thread has no minions and leaves out empty waiting and failed counts", async () => {
    const slot = await renderButton(handlers());

    const button = await slot.findByRole("button", { name: "Minions: 0 running · 0 done" });

    expect(button.className).toContain("text-muted-foreground");
    expect(button.className).not.toContain("text-warning");
  });

  it("shows that bb declined to open the Minions tab", async () => {
    const slot = await renderButton(handlers(), { openThreadPanel: () => false });

    fireEvent.click(await slot.findByRole("button", { name: /running/ }));

    expect(await slot.findByText(/could not open the Minions tab/)).toBeTruthy();
  });

  it("names the persona in a minion thread and goes back to its parent", async () => {
    const slot = await renderButton(
      handlers({ threadInfo: () => ({ persona: "researcher", parentThreadId: PARENT }) }),
      { threadId: "th_a" },
    );

    fireEvent.click(await slot.findByRole("button", { name: /researcher · minion/ }));

    expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: PARENT }]);
    expect(callsTo(slot, "minionCounts")).toBe(0);
  });

  it("retries thread info when the connection comes back and clears the error once it succeeds", async () => {
    let fail = true;
    const slot = await renderButton(
      handlers({
        threadInfo: () => {
          if (fail) throw new Error("bb is restarting");
          return null;
        },
      }),
    );
    expect(await slot.findByText("bb is restarting")).toBeTruthy();

    fail = false;
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    await slot.behavior.setRealtimeConnectionState("connected");

    expect(await slot.findByRole("button", { name: "Minions: 0 running · 0 done" })).toBeTruthy();
    expect(slot.queryByText("bb is restarting")).toBeNull();
  });

  it("keeps separate state for each thread's composer", async () => {
    const rpc = handlers({
      minionCounts: ({ threadId }) =>
        threadId === "th_one"
          ? { running: 1, waiting: 0, done: 0, failed: 0 }
          : { running: 0, waiting: 0, done: 2, failed: 0 },
    });

    const one = await renderButton(rpc, { threadId: "th_one" });
    const two = await renderButton(rpc, { threadId: "th_two" });

    expect(await one.findByRole("button", { name: "Minions: 1 running · 0 done" })).toBeTruthy();
    expect(await two.findByRole("button", { name: "Minions: 0 running · 2 done" })).toBeTruthy();
  });

  it("summarizes the thread's minions on hover from counts alone", async () => {
    const slot = await renderButton(
      handlers({ minionCounts: () => ({ running: 2, waiting: 1, done: 3, failed: 1 }) }),
    );

    const tooltip = await hover(slot, await slot.findByRole("button", { name: /^Minions: / }));

    expect(within(tooltip).getByText("Minions")).toBeTruthy();
    expect(within(tooltip).getByText("2 running · 1 waiting · 3 done · 1 failed")).toBeTruthy();
    expect(within(tooltip).getByText("Click to open the Minions tab")).toBeTruthy();
    expect(listCalls(slot)).toBe(0);
  });

  it("says the thread has no minions yet when focused from the keyboard", async () => {
    const slot = await renderButton(handlers());

    const tooltip = await focusWithKeyboard(
      slot,
      await slot.findByRole("button", { name: "Minions: 0 running · 0 done" }),
    );

    expect(within(tooltip).getByText("No minions yet")).toBeTruthy();
  });

  it("names the persona and points to the parent thread on hover in a minion thread", async () => {
    const slot = await renderButton(
      handlers({ threadInfo: () => ({ persona: "researcher", parentThreadId: PARENT }) }),
      { threadId: "th_a" },
    );

    const tooltip = await hover(slot, await slot.findByRole("button", { name: /researcher/ }));

    expect(within(tooltip).getByText("researcher minion")).toBeTruthy();
    expect(within(tooltip).getByText("Click to open the parent thread")).toBeTruthy();
  });

  it("blinks while a minion runs", async () => {
    const slot = await renderButton(
      handlers({ minionCounts: () => ({ running: 1, waiting: 0, done: 0, failed: 0 }) }),
    );

    const button = await slot.findByRole("button", { name: "Minions: 1 running · 0 done" });

    await waitFor(() => expect(button.textContent).not.toBe("[oo]"), { timeout: 1500 });
  });

  it("stays still and turns amber while minions only wait for input", async () => {
    const slot = await renderButton(
      handlers({ minionCounts: () => ({ running: 0, waiting: 1, done: 0, failed: 0 }) }),
    );

    const button = await slot.findByRole("button", {
      name: "Minions: 0 running · 1 waiting · 0 done",
    });

    expect(await marksShownFor(button, BLINK_CYCLE_MS)).toEqual(new Set(["[oo]"]));
    expect(button.className).toContain("text-warning");
  });

  it("stays still while a minion runs when the system asks for reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    try {
      const slot = await renderButton(
        handlers({ minionCounts: () => ({ running: 1, waiting: 0, done: 0, failed: 0 }) }),
      );
      const button = await slot.findByRole("button", { name: "Minions: 1 running · 0 done" });

      expect(await marksShownFor(button, BLINK_CYCLE_MS)).toEqual(new Set(["[oo]"]));
      slot.lifecycle.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
