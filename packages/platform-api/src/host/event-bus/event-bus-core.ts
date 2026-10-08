import { randomUUID } from 'node:crypto';

import type { Logger } from '@nestjs/common';

import {
  EVENT_BUS_CHANNEL_PATTERN,
  EVENT_BUS_MAX_PAYLOAD_BYTES,
  EventBusHandler,
  EventBusMeta,
  EventBusPayloadTooLargeError,
} from './event-bus.interface';

// =============================================================================
// What every adapter shares (PP-1.11, issue #682)
// =============================================================================
//
// The local half of the bus — the handler registry, handler isolation, the
// channel rule and the size rule — is identical on every adapter, so it lives
// here once. An adapter adds only its transport. Keeping this in one place is
// what makes rule 1 of the interface header ("local delivery is the same on
// every adapter") structural rather than a promise two files keep separately.
// =============================================================================

/** The wire envelope. `v` lets a later format coexist with this one during a rolling deploy. */
export interface EventBusEnvelope {
  v: 1;
  /** Logical channel. */
  c: string;
  /** Publisher origin. */
  o: string;
  /** Payload. */
  p: unknown;
}

/** A fresh origin id for one bus instance (one per process in production). */
export function newEventBusOrigin(): string {
  return randomUUID();
}

export function isValidEventBusChannel(channel: unknown): channel is string {
  return typeof channel === 'string' && EVENT_BUS_CHANNEL_PATTERN.test(channel);
}

/**
 * Serialises a message into its envelope, or throws.
 *
 * @throws EventBusPayloadTooLargeError when the envelope exceeds the limit.
 * @throws TypeError when the payload cannot be serialised (a cycle, a BigInt).
 */
export function encodeEventBusEnvelope(channel: string, origin: string, payload: unknown): string {
  const envelope: EventBusEnvelope = { v: 1, c: channel, o: origin, p: payload };
  const text = JSON.stringify(envelope);
  const bytes = Buffer.byteLength(text, 'utf8');

  if (bytes > EVENT_BUS_MAX_PAYLOAD_BYTES) {
    throw new EventBusPayloadTooLargeError(channel, bytes);
  }

  return text;
}

/** A placeholder of the same length as a real origin, for size checks before publishing. */
const ORIGIN_PLACEHOLDER = '00000000-0000-0000-0000-000000000000';

/**
 * Whether `payload` would be rejected as oversize on `channel`.
 *
 * For a publisher that has a smaller fallback (a reference instead of the
 * data) and wants to choose BEFORE publishing rather than lose the message.
 *
 * @param channel - the logical channel.
 * @param payload - the data to publish.
 * @returns true when it would exceed {@link EVENT_BUS_MAX_PAYLOAD_BYTES}.
 * @stability experimental
 */
export function exceedsEventBusPayloadLimit(channel: string, payload: unknown): boolean {
  try {
    encodeEventBusEnvelope(channel, ORIGIN_PLACEHOLDER, payload);
    return false;
  } catch (error) {
    return error instanceof EventBusPayloadTooLargeError;
  }
}

/**
 * Parses a received envelope, or returns `null` for anything malformed.
 *
 * A malformed message is DROPPED, never thrown: the physical channel is
 * readable and writable by any session with the application's credentials, so
 * the receiver cannot assume every NOTIFY on it was sent by this code.
 */
export function decodeEventBusEnvelope(text: string | undefined): EventBusEnvelope | null {
  if (typeof text !== 'string' || text === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Partial<EventBusEnvelope>;

  if (candidate.v !== 1) return null;
  if (!isValidEventBusChannel(candidate.c)) return null;
  if (typeof candidate.o !== 'string' || candidate.o === '') return null;
  if (!('p' in candidate)) return null;

  return candidate as EventBusEnvelope;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The per-process handler registry, with handler isolation.
 *
 * Subscribing and unsubscribing never perform I/O on any adapter: the Postgres
 * adapter LISTENs once on one physical channel and routes by logical channel
 * here.
 */
export class EventBusDispatcher {
  private readonly handlers = new Map<string, Set<EventBusHandler<unknown>>>();

  /** Handler invocations that threw or rejected. Diagnostics and tests. */
  handlerFailures = 0;

  constructor(private readonly logger: Logger) {}

  subscribe<T>(channel: string, handler: EventBusHandler<T>): () => void {
    if (!isValidEventBusChannel(channel)) {
      throw new Error(
        `Invalid event bus channel "${String(channel)}": expected a dotted lower-case name such as "notifications.stream".`,
      );
    }

    let bucket = this.handlers.get(channel);
    if (!bucket) {
      bucket = new Set();
      this.handlers.set(channel, bucket);
    }

    // A wrapper per registration, so the same function subscribed twice is two
    // registrations and each unsubscribe removes exactly its own.
    const entry: EventBusHandler<unknown> = (payload, meta) => handler(payload as T, meta);
    bucket.add(entry);

    return () => {
      const current = this.handlers.get(channel);
      if (!current) return;
      current.delete(entry);
      if (current.size === 0) this.handlers.delete(channel);
    };
  }

  /** Number of handlers on a channel. Diagnostics and tests only. */
  handlerCount(channel: string): number {
    return this.handlers.get(channel)?.size ?? 0;
  }

  /**
   * Delivers `encoded` (the envelope text) to every handler of its channel,
   * each with its OWN parsed copy so one handler mutating its payload cannot
   * change what the next one sees.
   *
   * Runs in a microtask, never in the caller's stack. Never throws.
   */
  dispatch(channel: string, encoded: string, meta: EventBusMeta): void {
    queueMicrotask(() => this.dispatchNow(channel, encoded, meta));
  }

  private dispatchNow(channel: string, encoded: string, meta: EventBusMeta): void {
    const bucket = this.handlers.get(channel);
    if (!bucket || bucket.size === 0) return;

    // Snapshot: a handler that unsubscribes (itself or another) mid-dispatch
    // must not make this loop skip anyone.
    for (const handler of [...bucket]) {
      let payload: unknown;
      try {
        payload = (JSON.parse(encoded) as EventBusEnvelope).p;
      } catch {
        return;
      }

      try {
        const result = handler(payload, meta);
        if (result && typeof (result as Promise<void>).then === 'function') {
          (result as Promise<void>).then(undefined, (error: unknown) => this.reportFailure(channel, error));
        }
      } catch (error) {
        this.reportFailure(channel, error);
      }
    }
  }

  private reportFailure(channel: string, error: unknown): void {
    this.handlerFailures += 1;
    // The channel, never the payload: payloads carry user content.
    this.logger.warn(`Event bus handler on "${channel}" failed: ${describe(error)}`);
  }
}

export { describe as describeEventBusError };
