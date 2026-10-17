import {
  definePluginApp,
  type PluginRpcClient,
  type PluginThreadPanelProps,
  ThreadChat,
  useBbNavigate,
  useComposer,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { usePrefersReducedMotion } from "./components/ui/hooks/use-media-query";
import { Icon } from "./components/ui/icon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import { cn } from "./lib/utils";
import type { rpcContract } from "./server";
import type { MinionCounts, MinionRow } from "./state";

const ACTION_ID = "minions";
const RUNNING = new Set(["active", "starting", "pending", "stopping"]);
// Same frames as pi's DEFAULT_SPINNER_FRAMES; the extensions never import each other.
const BLINK_FRAMES = [
  "[oo]",
  "[oo]",
  "[oo]",
  "[oo]",
  "[o-]",
  "[--]",
  "[--]",
  "[-o]",
  "[oo]",
  "[oo]",
] as const;
const BLINK_TICK_MS = 100;
const FIELD_CLASS =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

type Rpc = PluginRpcClient<typeof rpcContract>;
type Identity = { persona: string; parentThreadId: string };
type Persona = { name: string; description: string };
type SkippedPersona = { path: string; reason: string };

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isForThread(payload: unknown, threadId: string): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  const target = (payload as { threadId?: unknown }).threadId;
  return target === null || target === threadId;
}

type Live<T> = { data: T | undefined; error: string | null };

// Loads `load` and reloads it on this thread's realtime signal and when the connection returns,
// keeping only the newest response.
function useLive<T>(load: (() => Promise<T>) | null, threadId: string | null) {
  const [state, setState] = useState<Live<T>>({ data: undefined, error: null });
  const latest = useRef(0);
  const refetch = useCallback(() => {
    const request = ++latest.current;
    if (load === null) return;
    load().then(
      (data) => {
        if (request === latest.current) setState({ data, error: null });
      },
      (cause: unknown) => {
        if (request === latest.current) {
          setState((previous) => ({ data: previous.data, error: errorText(cause) }));
        }
      },
    );
  }, [load]);
  useEffect(() => {
    setState((previous) =>
      previous.data === undefined && previous.error === null
        ? previous
        : { data: undefined, error: null },
    );
    refetch();
  }, [refetch]);
  useRealtime("minions", (payload) => {
    if (threadId !== null && isForThread(payload, threadId)) refetch();
  });
  // bb does not replay signals sent while the connection was down.
  const connection = useRealtimeConnectionState();
  const previousConnection = useRef(connection);
  useEffect(() => {
    if (previousConnection.current === "reconnecting" && connection === "connected") refetch();
    previousConnection.current = connection;
  }, [connection, refetch]);
  return { ...state, refetch };
}

function useMinionRows(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const load = useCallback(
    () => rpc.call("listMinions", { threadId }).then(({ minions }) => minions),
    [rpc, threadId],
  );
  return { rpc, ...useLive(load, threadId) };
}

function useMinionCounts(threadId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const load = useMemo(
    () => (threadId === null ? null : () => rpc.call("minionCounts", { threadId })),
    [rpc, threadId],
  );
  return useLive(load, threadId);
}

function useThreadIdentity(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const load = useCallback(() => rpc.call("threadInfo", { threadId }), [rpc, threadId]);
  return useLive<Identity | null>(load, threadId);
}

function useRerenderEvery(intervalMs: number): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
}

function useBlinkFrame(active: boolean): string {
  const reducedMotion = usePrefersReducedMotion();
  const blinking = active && !reducedMotion;
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!blinking) return;
    setFrame(0);
    const timer = setInterval(
      () => setFrame((index) => (index + 1) % BLINK_FRAMES.length),
      BLINK_TICK_MS,
    );
    return () => clearInterval(timer);
  }, [blinking]);
  return BLINK_FRAMES[blinking ? frame : 0];
}

function statusLabel(row: MinionRow): string {
  return row.needsInput ? "waiting for input" : row.status;
}

function elapsed(since: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - since) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="m-3 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

function ErrorLine({ message, className }: { message: string | null; className?: string }) {
  if (message === null) return null;
  return (
    <p role="alert" className={cn("text-sm text-destructive", className)}>
      {message}
    </p>
  );
}

function MinionList({
  rows,
  onSelect,
}: {
  rows: MinionRow[] | null;
  onSelect: (id: string) => void;
}) {
  useRerenderEvery(30_000);
  const now = Date.now();
  if (rows === null) return <Notice>Loading minions…</Notice>;
  if (rows.length === 0) {
    return <Notice>No minions yet. Agents start them with spawn, or use New minion.</Notice>;
  }
  return (
    <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            onClick={() => onSelect(row.id)}
            className="flex w-full flex-col gap-1 px-3 py-2.5 text-left text-sm hover:bg-state-hover"
          >
            <span className="flex items-center gap-2">
              <span className="font-medium">{row.persona}</span>
              <span
                className={cn("text-xs", row.needsInput ? "text-warning" : "text-muted-foreground")}
              >
                {statusLabel(row)}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {elapsed(row.createdAt, now)}
              </span>
            </span>
            <span className="truncate">{row.task}</span>
            <span className="text-xs text-muted-foreground">
              {row.providerId} · {row.model}
              {row.progress ? ` · quests ${row.progress.done}/${row.progress.total}` : ""}
            </span>
            {row.progress?.current ? (
              <span className="truncate text-xs text-muted-foreground">{row.progress.current}</span>
            ) : null}
            {row.outputPreview ? (
              <span className="line-clamp-2 text-xs text-muted-foreground">
                {row.outputPreview}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function MessageDialog({
  open,
  onOpenChange,
  onSend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (text: string) => Promise<unknown>;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    if (message === "" || pending) return;
    setPending(true);
    onSend(message)
      .then(
        () => {
          setText("");
          setError(null);
          onOpenChange(false);
        },
        (cause: unknown) => setError(errorText(cause)),
      )
      .finally(() => setPending(false));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Message the minion</DialogTitle>
            <DialogDescription>
              bb steers the minion if it is working, or starts a new turn if it is idle.
            </DialogDescription>
          </DialogHeader>
          <textarea
            aria-label="Message to the minion"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={4}
            className={FIELD_CLASS}
          />
          <ErrorLine message={error} />
          <DialogFooter>
            <Button type="submit" disabled={pending || text.trim() === ""}>
              Send
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewMinionDialog({
  open,
  onOpenChange,
  threadId,
  rpc,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId: string;
  rpc: Rpc;
  onStarted: (id: string) => void;
}) {
  const ids = useId();
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [skipped, setSkipped] = useState<SkippedPersona[]>([]);
  const [agent, setAgent] = useState("");
  const [task, setTask] = useState("");
  const [environment, setEnvironment] = useState<"shared" | "worktree">("shared");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    rpc.call("listAgents", { threadId }).then(
      ({ agents, warnings }) => {
        setPersonas(agents);
        setSkipped(warnings);
      },
      (cause: unknown) => setError(errorText(cause)),
    );
  }, [open, rpc, threadId]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = task.trim();
    if (text === "" || pending) return;
    setPending(true);
    rpc
      .call("spawnMinion", { threadId, task: text, ...(agent ? { agent } : {}), environment })
      .then(
        (outcome) => {
          if (!outcome.ok) {
            setError(outcome.error);
            return;
          }
          setTask("");
          setError(null);
          onOpenChange(false);
          onStarted(outcome.id);
        },
        (cause: unknown) => setError(errorText(cause)),
      )
      .finally(() => setPending(false));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New minion</DialogTitle>
            <DialogDescription>
              Start a child thread for one self-contained task. Its answer comes back to this
              thread.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5 text-sm">
            <label htmlFor={`${ids}-persona`}>Persona</label>
            <select
              id={`${ids}-persona`}
              value={agent}
              onChange={(event) => setAgent(event.target.value)}
              className={FIELD_CLASS}
            >
              <option value="">General-purpose minion</option>
              {(personas ?? []).map((persona) => (
                <option key={persona.name} value={persona.name}>
                  {persona.name} — {persona.description}
                </option>
              ))}
            </select>
            {skipped.length > 0 ? (
              <div role="note" className="grid gap-1 text-xs text-muted-foreground">
                <p>These persona files could not be loaded:</p>
                <ul className="grid gap-0.5">
                  {skipped.map((file) => (
                    <li key={file.path} className="break-all">
                      {`${file.path}: ${file.reason}`}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <div className="grid gap-1.5 text-sm">
            <label htmlFor={`${ids}-task`}>Task</label>
            <textarea
              id={`${ids}-task`}
              value={task}
              onChange={(event) => setTask(event.target.value)}
              rows={5}
              placeholder="Describe the work, the files involved and the answer you want."
              className={FIELD_CLASS}
            />
          </div>
          <div className="grid gap-1.5 text-sm">
            <label htmlFor={`${ids}-environment`}>Environment</label>
            <select
              id={`${ids}-environment`}
              value={environment}
              onChange={(event) => setEnvironment(event.target.value as "shared" | "worktree")}
              className={FIELD_CLASS}
            >
              <option value="shared">Shared checkout</option>
              <option value="worktree">New Git worktree</option>
            </select>
          </div>
          <ErrorLine message={error} />
          <DialogFooter>
            <Button type="submit" disabled={pending || task.trim() === ""}>
              Start minion
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MinionDetail({
  row,
  threadId,
  rpc,
  onChanged,
  onError,
}: {
  row: MinionRow;
  threadId: string;
  rpc: Rpc;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const navigate = useBbNavigate();
  const [messaging, setMessaging] = useState(false);
  const act = (call: Promise<unknown>) => {
    call.then(onChanged, (cause: unknown) => onError(errorText(cause)));
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{row.title}</p>
          <p className="text-xs text-muted-foreground">
            {statusLabel(row)} · {row.model}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => navigate.toThread(row.id)}>
          Open
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMessaging(true)}>
          Message
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!RUNNING.has(row.status)}
          onClick={() => act(rpc.call("stop", { threadId, id: row.id }))}
        >
          Stop
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => act(rpc.call("archive", { threadId, id: row.id }))}
        >
          Archive
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <ThreadChat threadId={row.id} variant="compact" layout="contained" />
      </div>
      <MessageDialog
        open={messaging}
        onOpenChange={setMessaging}
        onSend={(text) => rpc.call("tell", { threadId, id: row.id, text }).then(onChanged)}
      />
    </div>
  );
}

function MinionsPanel({ threadId }: PluginThreadPanelProps) {
  const { rpc, data, error: loadError, refetch } = useMinionRows(threadId);
  const rows = data ?? null;
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = rows?.find((row) => row.id === selectedId) ?? null;
  const error = actionError ?? loadError;
  const changed = () => {
    setActionError(null);
    refetch();
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {selected ? (
          <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>
            <Icon name="ChevronLeft" />
            All minions
          </Button>
        ) : (
          <p className="text-sm font-medium">
            {rows ? `${rows.length} minion${rows.length === 1 ? "" : "s"}` : "Minions"}
          </p>
        )}
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setCreating(true)}>
          <Icon name="Plus" />
          New minion
        </Button>
      </div>
      <ErrorLine message={error} className="px-3 py-2" />
      {selected ? (
        <MinionDetail
          row={selected}
          threadId={threadId}
          rpc={rpc}
          onChanged={changed}
          onError={setActionError}
        />
      ) : (
        <MinionList rows={rows} onSelect={setSelectedId} />
      )}
      <NewMinionDialog
        open={creating}
        onOpenChange={setCreating}
        threadId={threadId}
        rpc={rpc}
        onStarted={(id) => {
          setSelectedId(id);
          changed();
        }}
      />
    </div>
  );
}

const TONE_CLASS = {
  default: "",
  muted: "text-muted-foreground",
  warning: "text-warning",
} as const;

type ButtonView = {
  label: string;
  lines: string[];
  tone: keyof typeof TONE_CLASS;
  blinking: boolean;
  parentThreadId: string | null;
};

function describeMinions(
  identity: Identity | null | undefined,
  counts: MinionCounts | undefined,
): ButtonView {
  if (identity) {
    return {
      label: `${identity.persona} · minion`,
      lines: [`${identity.persona} minion`, "Click to open the parent thread"],
      tone: "default",
      blinking: false,
      parentThreadId: identity.parentThreadId,
    };
  }
  if (counts === undefined) {
    return {
      label: "Minions",
      lines: ["Loading minions…"],
      tone: "muted",
      blinking: false,
      parentThreadId: null,
    };
  }
  const { running, waiting, done, failed } = counts;
  const summary = [
    `${running} running`,
    waiting > 0 ? `${waiting} waiting` : null,
    `${done} done`,
    failed > 0 ? `${failed} failed` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const empty = running + waiting + done + failed === 0;
  let tone: ButtonView["tone"] = "default";
  if (waiting > 0) tone = "warning";
  else if (empty) tone = "muted";
  return {
    label: `Minions: ${summary}`,
    lines: ["Minions", empty ? "No minions yet" : summary, "Click to open the Minions tab"],
    tone,
    blinking: running > 0,
    parentThreadId: null,
  };
}

function MinionsButton({ threadId }: { threadId: string }) {
  const navigate = useBbNavigate();
  const identity = useThreadIdentity(threadId);
  const counts = useMinionCounts(identity.data === null ? threadId : null);
  const [openError, setOpenError] = useState<string | null>(null);
  const view = describeMinions(identity.data, counts.data);
  const mark = useBlinkFrame(view.blinking);
  const problem = openError ?? identity.error ?? counts.error;
  const { parentThreadId } = view;
  const open = () => {
    if (parentThreadId !== null) {
      navigate.toThread(parentThreadId);
    } else if (!navigate.openThreadPanel({ actionId: ACTION_ID })) {
      setOpenError("bb could not open the Minions tab here.");
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className={cn("h-8 px-2 font-mono text-xs", TONE_CLASS[view.tone])}
              aria-label={view.label}
              onClick={open}
            >
              <span aria-hidden="true">{mark}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {view.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <ErrorLine message={problem} className="max-w-48 truncate text-xs" />
    </span>
  );
}

function MinionsAction() {
  const composer = useComposer();
  if (composer.scope.kind !== "thread") return null;
  const { threadId } = composer.scope;
  // Keyed by thread so a thread switch starts with fresh state.
  return <MinionsButton key={threadId} threadId={threadId} />;
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: ACTION_ID,
    title: "Minions",
    icon: "Users",
    layout: "flush",
    component: MinionsPanel,
  });
  app.composer.customize({
    id: ACTION_ID,
    scopes: ["thread"],
    actions: [{ id: "minions-status", component: MinionsAction }],
  });
});
