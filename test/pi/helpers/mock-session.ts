/**
 * Mock SDK session factory for unit-testing runMinionSession safety logic.
 * No LLM needed — controllable turn count, steer tracking, abort tracking.
 */

export interface MockSessionConfig {
  /** Total turns the mock will simulate (default: 5) */
  totalTurns?: number;
  /** Delay between turns in ms (default: 1) */
  turnDelayMs?: number;
  /** Whether steer causes the session to stop (default: true) */
  respectsSteer?: boolean;
  /** Final assistant message text (default: "Task completed.") */
  finalMessage?: string;
}

type EventCallback = (event: any) => void;

export function createMockSession(config?: MockSessionConfig) {
  const totalTurns = config?.totalTurns ?? 5;
  const turnDelayMs = config?.turnDelayMs ?? 1;
  const respectsSteer = config?.respectsSteer ?? true;
  const finalMessage = config?.finalMessage ?? "Task completed.";

  let _aborted = false;
  let _turnCount = 0;
  const _steerCalls: string[] = [];
  const _subscribers: EventCallback[] = [];

  const messages: unknown[] = [];

  function emit(event: any) {
    for (const cb of _subscribers) cb(event);
  }

  const session = {
    async prompt(_task: string): Promise<void> {
      for (let i = 0; i < totalTurns; i++) {
        if (_aborted) break;
        if (respectsSteer && _steerCalls.length > 0) break;

        if (turnDelayMs > 0) {
          await new Promise((r) => setTimeout(r, turnDelayMs));
        }

        if (_aborted) break;

        // Emit a turn cycle: message_start → text_delta → message_end → turn_end
        emit({ type: "message_start" });
        const text =
          i === totalTurns - 1 || (respectsSteer && _steerCalls.length > 0)
            ? finalMessage
            : `Turn ${i + 1} working...`;
        emit({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: text },
        });
        emit({ type: "message_end" });

        _turnCount++;
        emit({ type: "turn_end" });
      }

      // Set final message in state
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: finalMessage }],
      });
    },

    abort() {
      _aborted = true;
    },

    async steer(text: string): Promise<void> {
      _steerCalls.push(text);
    },

    subscribe(callback: EventCallback): () => void {
      _subscribers.push(callback);
      return () => {
        const idx = _subscribers.indexOf(callback);
        if (idx >= 0) _subscribers.splice(idx, 1);
      };
    },

    dispose() {
      _subscribers.length = 0;
    },

    getSessionStats() {
      return {
        tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
        cost: 0.001,
      };
    },

    getAllTools() {
      return [
        { name: "read", description: "Read files" },
        { name: "bash", description: "Run bash" },
        { name: "edit", description: "Edit files" },
        { name: "write", description: "Write files" },
      ];
    },

    async bindExtensions() {},

    state: { messages },
  };

  return {
    session,
    get aborted() {
      return _aborted;
    },
    get steerCalls() {
      return [..._steerCalls];
    },
    get turnCount() {
      return _turnCount;
    },
  };
}
