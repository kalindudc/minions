import { describe, expect, it, vi } from "vitest";
import {
  EventBus,
  MINION_COMPLETE_CHANNEL,
  MINION_EVENT_CHANNEL,
  MINION_PROGRESS_CHANNEL,
} from "../../../extensions/pi/subsessions/event-bus.js";

describe("EventBus", () => {
  it("should allow subscribing to events", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on("test", handler);
    bus.emit("test", { data: "value" });

    expect(handler).toHaveBeenCalledWith({ data: "value" });
  });

  it("should allow multiple handlers for same channel", () => {
    const bus = new EventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on("test", handler1);
    bus.on("test", handler2);
    bus.emit("test", { data: "value" });

    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it("should allow unsubscribing from events", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    const unsubscribe = bus.on("test", handler);
    unsubscribe();
    bus.emit("test", { data: "value" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("should not call handlers on different channels", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on("channel1", handler);
    bus.emit("channel2", { data: "value" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("should handle errors in handlers gracefully", () => {
    const bus = new EventBus();
    const errorHandler = vi.fn(() => {
      throw new Error("Handler error");
    });
    const goodHandler = vi.fn();

    bus.on("test", errorHandler);
    bus.on("test", goodHandler);

    // Should not throw
    bus.emit("test", { data: "value" });

    expect(errorHandler).toHaveBeenCalled();
    expect(goodHandler).toHaveBeenCalled();
  });

  it("should remove all listeners for a channel", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on("test", handler);
    bus.removeAllListeners("test");
    bus.emit("test", { data: "value" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("should remove all listeners when no channel specified", () => {
    const bus = new EventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on("channel1", handler1);
    bus.on("channel2", handler2);
    bus.removeAllListeners();
    bus.emit("channel1", { data: "value" });
    bus.emit("channel2", { data: "value" });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });

  it("should have correct minion channel constants", () => {
    expect(MINION_EVENT_CHANNEL).toBe("minion:event");
    expect(MINION_PROGRESS_CHANNEL).toBe("minion:progress");
    expect(MINION_COMPLETE_CHANNEL).toBe("minion:complete");
  });

  it("should emit typed events on minion channels", () => {
    const bus = new EventBus();
    const eventHandler = vi.fn();
    const progressHandler = vi.fn();
    const completeHandler = vi.fn();

    bus.on(MINION_EVENT_CHANNEL, eventHandler);
    bus.on(MINION_PROGRESS_CHANNEL, progressHandler);
    bus.on(MINION_COMPLETE_CHANNEL, completeHandler);

    bus.emit(MINION_EVENT_CHANNEL, { type: "start", id: "123" });
    bus.emit(MINION_PROGRESS_CHANNEL, { id: "123", delta: "text" });
    bus.emit(MINION_COMPLETE_CHANNEL, { id: "123", exitCode: 0 });

    expect(eventHandler).toHaveBeenCalledWith({ type: "start", id: "123" });
    expect(progressHandler).toHaveBeenCalledWith({ id: "123", delta: "text" });
    expect(completeHandler).toHaveBeenCalledWith({ id: "123", exitCode: 0 });
  });
});
