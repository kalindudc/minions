export type EventHandler<T> = (event: T) => void;

export class EventBus {
  private listeners = new Map<string, Set<EventHandler<unknown>>>();

  on<T>(channel: string, handler: EventHandler<T>): () => void {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel)?.add(handler as EventHandler<unknown>);

    return () => {
      this.listeners.get(channel)?.delete(handler as EventHandler<unknown>);
    };
  }

  emit<T>(channel: string, event: T): void {
    const handlers = this.listeners.get(channel);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        handler(event);
      } catch {
        // Ignore errors from event handlers
      }
    }
  }

  removeAllListeners(channel?: string): void {
    if (channel) {
      this.listeners.delete(channel);
    } else {
      this.listeners.clear();
    }
  }
}

export const MINION_EVENT_CHANNEL = "minion:event";
export const MINION_PROGRESS_CHANNEL = "minion:progress";
export const MINION_COMPLETE_CHANNEL = "minion:complete";
