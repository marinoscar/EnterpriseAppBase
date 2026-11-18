import type { NodeEvent } from './node-api.js';

/** Most events held while the server is unreachable. */
export const NODE_EVENT_QUEUE_MAX = 200;
/** Most events one heartbeat carries (mirrors the contract). */
export const NODE_EVENTS_PER_HEARTBEAT = 50;

/**
 * A bounded FIFO of node events: when full, the OLDEST is dropped and counted.
 *
 * @stability experimental
 */
export class NodeEventQueue {
  private items: NodeEvent[] = [];
  private droppedCount = 0;

  constructor(private readonly max: number = NODE_EVENT_QUEUE_MAX) {}

  /** Append events, dropping the oldest past the cap. */
  push(events: readonly NodeEvent[]): void {
    this.items.push(...events);
    this.trim();
  }

  /** Take up to `limit` of the oldest events. */
  drain(limit: number = NODE_EVENTS_PER_HEARTBEAT): NodeEvent[] {
    return this.items.splice(0, limit);
  }

  /** Put events back at the FRONT (a failed heartbeat), keeping order. */
  requeue(events: readonly NodeEvent[]): void {
    this.items = [...events, ...this.items];
    this.trim();
  }

  get size(): number {
    return this.items.length;
  }

  /** Events dropped for lack of room since creation. */
  get dropped(): number {
    return this.droppedCount;
  }

  private trim(): void {
    const excess = this.items.length - this.max;
    if (excess > 0) {
      this.items.splice(0, excess);
      this.droppedCount += excess;
    }
  }
}
