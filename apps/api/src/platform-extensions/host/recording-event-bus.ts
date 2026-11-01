import { randomUUID } from 'node:crypto';

import {
  EVENT_BUS_CHANNEL_PATTERN,
  EVENT_BUS_MAX_PAYLOAD_BYTES,
  EventBusPayloadTooLargeError,
  type EventBus,
  type EventBusAdapterDef,
  type EventBusHandler,
  type EventBusHealth,
} from '@marinoscar/platform-api/host';
import { Logger } from '@nestjs/common';

// =============================================================================
// EXAMPLE: an app event bus adapter (PP-14.2)
// =============================================================================
//
// The platform's cross-replica bus (`EVENT_BUS`) has two built-in adapters,
// `in-process` and `postgres`. An app with a different transport (Redis, NATS,
// a managed broker) or a test that wants to SEE the traffic adds an adapter in
// two steps, without touching a package:
//
//   1. implement `EventBus` (this class);
//   2. register it once, at import time: `app-registrations/host.ts` calls
//      `registerEventBusAdapter(recordingEventBusAdapter)`.
//
// Then select it by id, exactly like a built-in: `EVENT_BUS_ADAPTER=recording`,
// or `PlatformHostCoreModule.forRoot({ eventBusAdapter: 'recording' })`. To
// replace the bus wholesale instead (no id, no registry), bind it:
// `PlatformHostCoreModule.forRoot({ eventBus: { useClass: RecordingEventBus } })`.
//
// WHAT THIS ONE DOES. It keeps every message in memory (`messages`), delivers
// to this process's subscribers, and can pretend another replica published
// (`receiveRemote`). It is a double for tests, not a transport: it never
// crosses a process boundary, so do NOT select it in a deployment with more
// than one API replica. A real adapter would also forward `publish` to its
// broker and call `deliver(..., local: false)` for what the broker sends back.
//
// THE RULES IT HONOURS are the ones at the top of the package's
// `event-bus.interface.ts` (local delivery in a microtask, a JSON round trip,
// isolated handlers, a `publish` that never rejects, an oversize payload
// refused locally); `describeEventBusConformance` (`@marinoscar/platform-api/host/testing`)
// checks them, and `test/examples/host/event-bus-adapter.spec.ts` runs it on this class.
// =============================================================================

/** The id the adapter registers under. */
export const RECORDING_EVENT_BUS_ID = 'recording';

/** One message the bus carried. */
export interface RecordedEventBusMessage {
  /** The channel it was published on. */
  channel: string;
  /** The payload after the JSON round trip every subscriber sees. */
  payload: unknown;
  /** Whether this process published it (`false` for {@link RecordingEventBus.receiveRemote}). */
  local: boolean;
}

/** An in-memory event bus that records everything that passes through it. */
export class RecordingEventBus implements EventBus {
  readonly adapter = RECORDING_EVENT_BUS_ID;
  readonly origin = randomUUID();

  /** Every message published or received, in order. */
  readonly messages: RecordedEventBusMessage[] = [];

  private readonly logger = new Logger(RecordingEventBus.name);
  private readonly handlers = new Map<string, Set<EventBusHandler<unknown>>>();
  private publishFailures = 0;
  private lastError: string | null = null;
  private readonly startedAt = new Date().toISOString();

  async publish<T>(channel: string, payload: T): Promise<void> {
    const encoded = this.encode(channel, payload);
    if (encoded === null) return;
    this.deliver(channel, encoded, true);
  }

  subscribe<T>(channel: string, handler: EventBusHandler<T>): () => void {
    if (!EVENT_BUS_CHANNEL_PATTERN.test(channel)) {
      throw new Error(`Invalid event bus channel "${String(channel)}": expected a dotted lower-case name such as "notifications.stream".`);
    }
    const entry: EventBusHandler<unknown> = (payload, meta) => handler(payload as T, meta);
    let bucket = this.handlers.get(channel);
    if (!bucket) this.handlers.set(channel, (bucket = new Set()));
    bucket.add(entry);
    return () => {
      bucket.delete(entry);
    };
  }

  health(): EventBusHealth {
    return {
      adapter: this.adapter,
      connected: true,
      lastError: this.lastError,
      lastConnectedAt: this.startedAt,
      publishFailures: this.publishFailures,
      reconnects: 0,
    };
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }

  /**
   * Pretends another replica published `payload`: subscribers receive it with
   * `meta.local === false`, the way a shared adapter delivers a peer's message.
   */
  receiveRemote<T>(channel: string, payload: T): void {
    const encoded = this.encode(channel, payload);
    if (encoded !== null) this.deliver(channel, encoded, false);
  }

  /** The recorded messages of one channel. */
  on(channel: string): RecordedEventBusMessage[] {
    return this.messages.filter((message) => message.channel === channel);
  }

  /** Forgets the recorded messages. */
  clear(): void {
    this.messages.length = 0;
  }

  private encode(channel: string, payload: unknown): string | null {
    try {
      if (!EVENT_BUS_CHANNEL_PATTERN.test(channel)) throw new Error(`invalid channel "${String(channel)}"`);
      const encoded = JSON.stringify(payload ?? null);
      const bytes = Buffer.byteLength(encoded, 'utf8');
      if (bytes > EVENT_BUS_MAX_PAYLOAD_BYTES) throw new EventBusPayloadTooLargeError(channel, bytes);
      return encoded;
    } catch (error) {
      // `publish` never rejects (rule 5): count it, log it, drop it.
      this.publishFailures += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Refused to publish: ${this.lastError}`);
      return null;
    }
  }

  private deliver(channel: string, encoded: string, local: boolean): void {
    this.messages.push({ channel, payload: JSON.parse(encoded), local });
    // A microtask, never inside the publisher's stack (rule 1).
    queueMicrotask(() => {
      for (const handler of [...(this.handlers.get(channel) ?? [])]) {
        const meta = { origin: this.origin, local };
        try {
          const result = handler(JSON.parse(encoded), meta);
          if (result && typeof (result as Promise<void>).then === 'function') {
            (result as Promise<void>).then(undefined, (error: unknown) => this.logFailure(channel, error));
          }
        } catch (error) {
          this.logFailure(channel, error);
        }
      }
    });
  }

  // Rule 4: the channel is logged, never the payload.
  private logFailure(channel: string, error: unknown): void {
    this.logger.warn(`Event bus handler on "${channel}" failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The adapter definition `app-registrations/host.ts` registers. */
export const recordingEventBusAdapter: EventBusAdapterDef = {
  id: RECORDING_EVENT_BUS_ID,
  label: 'Recording (in-memory test double)',
  create: ({ logger }) => {
    logger.warn('Event bus adapter "recording": in-memory, single-process. For tests and examples; do not run it with several replicas.');
    return new RecordingEventBus();
  },
};
