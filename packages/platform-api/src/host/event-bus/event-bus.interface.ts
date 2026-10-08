// =============================================================================
// The cross-replica event bus (PP-1.11, issue #682)
// =============================================================================
//
// A tiny publish/subscribe seam that reaches every API process sharing one
// database, not just the one that published. It exists because two pieces of
// state used to live in one Node heap and therefore stopped at the edge of one
// replica:
//
//   - the SSE registry (`notifications/notification-stream.service.ts`), so a
//     tab connected to replica A never saw a live event published on replica B;
//   - the idle job worker (`jobs/job.worker.ts`), which could only learn about
//     new work by polling.
//
// Both now publish and subscribe through `EVENT_BUS`. Which adapter backs it
// is DEPLOYMENT TOPOLOGY (`EVENT_BUS_ADAPTER`, read once at boot), not a
// runtime setting: it decides how processes talk to each other, so it has to
// be known before any of them start.
//
//   - `in-process` — one `Map` in this heap. Today's single-process behaviour,
//     and the default when the variable is unset (tests, `npm run api:dev`).
//   - `postgres`   — `pg_notify` to publish, one dedicated `LISTEN` session to
//     receive. No new infrastructure: the database every replica already
//     shares is the bus. See `postgres-event-bus.ts`.
//
// A Redis/Valkey adapter can be added later behind this same interface;
// nothing above it moves.
//
// -----------------------------------------------------------------------------
// SEMANTICS EVERY ADAPTER HONOURS
// -----------------------------------------------------------------------------
//
//   1. LOCAL DELIVERY. A subscriber in the publishing process receives every
//      message exactly once, with `meta.local === true`, on EVERY adapter. It
//      runs in a microtask after `publish` was called, never inside the
//      publisher's own stack, so a slow or throwing handler cannot reach back
//      into the code that published.
//
//   2. REMOTE DELIVERY IS AT MOST ONCE, WITH NO REPLAY. Another process
//      receives a message at most once, with `meta.local === false`. A message
//      published while a listener is disconnected is LOST for that listener —
//      by design. Every consumer must therefore treat the bus as a latency
//      optimisation over a durable source of truth: the stream's clients
//      refetch on (re)connect, and the job worker still polls.
//
//   3. NO ECHO. The Postgres adapter hears its own NOTIFY. The envelope carries
//      the publisher's `origin` and an adapter DROPS messages whose origin is
//      its own, because rule 1 has already delivered them locally.
//
//   4. HANDLER FAILURES ARE ISOLATED. A handler that throws (or whose promise
//      rejects) is logged with the channel name — never the payload — and
//      neither stops the other handlers nor reaches the publisher.
//
//   5. `publish` NEVER REJECTS. A failed NOTIFY, a malformed channel or an
//      oversize payload is logged and counted (`health().publishFailures`).
//      Publishing is always a best-effort side effect of work that has already
//      been made durable.
//
//   6. NOT TRANSACTIONAL. Never publish inside a `$transaction`: a message about
//      a write the transaction then rolls back would announce something that
//      never happened, and a `pg_notify` on the pooled transaction connection
//      would only be sent at COMMIT anyway. Publish AFTER the write commits —
//      the same rule CLAUDE.md states for `notify()`.
//
//   7. PAYLOADS ARE JSON. Every subscriber, local or remote, receives a JSON
//      round-trip copy of what was published (a `Date` arrives as a string on
//      every adapter, so in-process behaviour cannot hide a bug that only shows
//      across replicas). The serialised envelope must fit in
//      `EVENT_BUS_MAX_PAYLOAD_BYTES`; anything larger is rejected locally
//      (logged as `EventBusPayloadTooLargeError`) and reaches nobody. Publish a
//      REFERENCE (an id the receiver reads from the database) for large data.
//
//   8. ⚠ NEVER PUT A SECRET ON THE BUS. The Postgres adapter's NOTIFY payload
//      is readable by any session holding the application's database
//      credentials. That is no wider than the data those credentials already
//      read — but a token, key or password published here would be one more
//      copy outside the encrypted credential store.
//
// Logical channels are dotted lower-case names (`notifications.stream`,
// `jobs.enqueued`); the inventory lives in docs/ARCHITECTURE.md.
// =============================================================================

/**
 * DI token for the process's one bus. Provided, globally, by
 * `PlatformHostCoreModule.forRoot()`. A `Symbol.for` key, so two copies of
 * this file agree on identity.
 *
 * @example
 * ```ts
 * constructor(@Inject(EVENT_BUS) private readonly bus: EventBus) {}
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const EVENT_BUS: unique symbol = Symbol.for('@marinoscar/platform/EVENT_BUS');

/**
 * The adapters the platform ships.
 *
 * @stability experimental
 */
export type EventBusAdapterName = 'in-process' | 'postgres';

/**
 * Every adapter name, in the order the docs list them.
 *
 * @stability experimental
 */
export const EVENT_BUS_ADAPTERS: readonly EventBusAdapterName[] = ['in-process', 'postgres'];

/**
 * A logical channel name. Lower-case, dotted, at least two segments, e.g.
 * `notifications.stream`. The first segment names the owning feature.
 *
 * @stability experimental
 */
export const EVENT_BUS_CHANNEL_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/;

/**
 * The largest serialised envelope (channel, origin and payload together) a
 * message may have, in UTF-8 bytes.
 *
 * Postgres caps a NOTIFY payload at 8000 bytes; this leaves headroom for the
 * envelope's own keys and for a future version field. Enforced on EVERY
 * adapter so a payload that would fail in production fails in development too.
 *
 * @stability experimental
 */
export const EVENT_BUS_MAX_PAYLOAD_BYTES = 7_500;

/**
 * Thrown (and caught and logged — never surfaced to the caller) for an oversize message.
 *
 * @stability experimental
 */
export class EventBusPayloadTooLargeError extends Error {
  /**
   * @param channel - the logical channel the message was published on.
   * @param bytes - the serialised envelope's size in UTF-8 bytes.
   */
  constructor(
    readonly channel: string,
    readonly bytes: number,
  ) {
    super(
      `Event bus message on "${channel}" is ${bytes} bytes; the limit is ` +
        `${EVENT_BUS_MAX_PAYLOAD_BYTES}. Publish a reference instead of the data.`,
    );
    this.name = 'EventBusPayloadTooLargeError';
  }
}

/**
 * What a handler learns about a message besides its payload.
 *
 * @stability experimental
 */
export interface EventBusMeta {
  /** Process-unique id of the publisher (random UUID per process start). */
  origin: string;
  /** True when this process published it. */
  local: boolean;
}

/**
 * A subscriber. Its failures are logged and isolated (rule 4).
 *
 * @typeParam T - the payload type, after a JSON round trip.
 * @stability experimental
 */
export type EventBusHandler<T> = (payload: T, meta: EventBusMeta) => void | Promise<void>;

/**
 * A synchronous snapshot of the bus, for the Doctor.
 *
 * @stability experimental
 */
export interface EventBusHealth {
  /** Which adapter backs this process's bus. */
  adapter: EventBusAdapterName;
  /** Always true in-process; for postgres, whether the LISTEN session is up. */
  connected: boolean;
  /** The most recent connection or publish error message. Never secret material. */
  lastError: string | null;
  /** ISO timestamp of the last successful (re)connect; the boot time in-process. */
  lastConnectedAt: string | null;
  /** Messages this process failed to publish (oversize, bad channel, NOTIFY error). */
  publishFailures: number;
  /** Times the listener has been scheduled to reconnect. Always 0 in-process. */
  reconnects: number;
}

/**
 * The process's publish/subscribe seam. See the rules at the top of this file.
 *
 * @stability experimental
 */
export interface EventBus {
  /** Which adapter backs this bus. */
  readonly adapter: EventBusAdapterName;

  /** This process's origin id, as carried in `EventBusMeta.origin`. */
  readonly origin: string;

  /**
   * Sends `payload` to every subscriber of `channel`, in this process and (for
   * a shared adapter) in every other one. NEVER REJECTS: see rule 5 above.
   */
  publish<T>(channel: string, payload: T): Promise<void>;

  /**
   * Registers a handler for `channel` and returns its unsubscribe function.
   * Issues no I/O on any adapter. Throws only for a malformed channel name,
   * which is a programming error caught at boot.
   */
  subscribe<T>(channel: string, handler: EventBusHandler<T>): () => void;

  /** A synchronous snapshot. Performs no I/O, so a Doctor check may call it freely. */
  health(): EventBusHealth;
}
