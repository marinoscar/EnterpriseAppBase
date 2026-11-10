import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Client, type ClientConfig, type Notification } from 'pg';

import {
  decodeEventBusEnvelope,
  describeEventBusError,
  encodeEventBusEnvelope,
  EventBusDispatcher,
  isValidEventBusChannel,
  newEventBusOrigin,
} from './event-bus-core';
import type { EventBus, EventBusHandler, EventBusHealth } from './event-bus.interface';
import { NOOP_EVENT_BUS_METRICS, type EventBusMetrics } from './event-bus.metrics';

// =============================================================================
// PostgresEventBus — LISTEN/NOTIFY across replicas (PP-1.11, issue #682)
// =============================================================================
//
// Every API replica already shares one database, so the database is the bus:
// no Redis, no broker, nothing new to run. Selected with
// `EVENT_BUS_ADAPTER=postgres`.
//
// -----------------------------------------------------------------------------
// ONE PHYSICAL CHANNEL, MANY LOGICAL ONES
// -----------------------------------------------------------------------------
//
// Every message goes out on ONE Postgres channel, `platform_bus`, as a JSON
// envelope `{ v: 1, c: <logical channel>, o: <origin>, p: <payload> }`. The
// listener `LISTEN`s once and routes by `c` in memory, so `subscribe` and
// unsubscribe never issue SQL — which matters because the session they would
// issue it on may be in the middle of reconnecting.
//
// REJECTED: one Postgres channel per logical channel. Subscribe would have to
// `LISTEN` per channel on a connection that may not exist yet, and every
// reconnect would have to replay the set.
//
// -----------------------------------------------------------------------------
// WHY A DEDICATED `pg.Client`, OUTSIDE THE PRISMA POOL
// -----------------------------------------------------------------------------
//
// `LISTEN` is SESSION state: notifications are delivered to the session that
// issued it, for as long as that session lives. A pooled Prisma connection is
// handed to whichever query wants it next and may be closed or recycled at any
// time, so it cannot hold a LISTEN. This is the same structural reason
// `db-backup/admin-connection.util.ts` keeps its own client — with one
// difference: this one is attached to the APPLICATION database (a NOTIFY is
// only heard in the database it was sent in), not the maintenance database.
//
// PUBLISHING DOES GO THROUGH PRISMA (`SELECT pg_notify(...)`, parameterised,
// outside any transaction). A NOTIFY is an ordinary statement that any session
// may send; only the listening half needs to be dedicated.
//
// ⚠ TRANSACTION-MODE POOLERS BREAK THE LISTENER. If `POSTGRES_HOST` points at
// PgBouncer in transaction mode, RDS Proxy or a similar pooler, the LISTEN is
// issued on a server connection the pooler reassigns after the statement, and
// nothing is ever heard. Point the API at Postgres directly (or at a
// session-mode pool). The Doctor's `core.event-bus` check names this when the
// listener is down.
//
// -----------------------------------------------------------------------------
// FAILURE IS A DEGRADATION, NEVER AN OUTAGE
// -----------------------------------------------------------------------------
//
//   - The listener NEVER BLOCKS STARTUP. A failed first connect is logged,
//     `health().connected` reads false, and it keeps retrying.
//   - On `error` or `end` it reconnects with exponential backoff — 1 s
//     doubling to 30 s, plus up to 20% jitter so a fleet that lost its
//     database together does not reconnect in lockstep — and re-`LISTEN`s.
//   - Messages sent while it is disconnected are LOST for this process. That
//     is the documented contract (interface header, rule 2): the SSE clients
//     refetch on reconnect and the job worker still polls.
//   - Local delivery never depends on the listener: this process's own
//     subscribers are served in memory before the NOTIFY is even sent.
// =============================================================================

/**
 * The one Postgres channel every logical channel is multiplexed onto.
 *
 * @stability experimental
 */
export const EVENT_BUS_PG_CHANNEL = 'platform_bus';

/**
 * `application_name` of the listener session, so an operator can find it in `pg_stat_activity`.
 *
 * @stability experimental
 */
export const EVENT_BUS_LISTENER_APPLICATION_NAME = 'platform-event-bus';

/**
 * The first reconnect delay, in milliseconds.
 *
 * @stability experimental
 */
export const DEFAULT_INITIAL_BACKOFF_MS = 1_000;
/**
 * The longest reconnect delay, in milliseconds.
 *
 * @stability experimental
 */
export const DEFAULT_MAX_BACKOFF_MS = 30_000;

/**
 * The slice of the app's Prisma client publishing needs: one tagged-template raw statement.
 *
 * @stability experimental
 */
export interface EventBusSqlPublisher {
  /** A tagged-template raw statement (`SELECT pg_notify(...)`). */
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<number>;
}

/**
 * What one listener statement resolves to.
 *
 * @stability experimental
 */
export interface EventBusListenerQueryResult {
  /** The result rows. */
  rows: Array<Record<string, unknown>>;
}

/**
 * The slice of `pg.Client` the listener uses; a test substitutes a fake.
 *
 * @stability experimental
 */
export interface EventBusListenerClient {
  /** Opens the session. */
  connect(): Promise<unknown>;
  /** Runs one statement (`LISTEN`, `SELECT pg_backend_pid()`). */
  query(text: string): Promise<EventBusListenerQueryResult>;
  /** Closes the session. */
  end(): Promise<unknown>;
  /** Subscribes to the session's notifications. */
  on(event: 'notification', listener: (message: Notification) => void): unknown;
  /** Subscribes to the session's errors. */
  on(event: 'error', listener: (error: Error) => void): unknown;
  /** Subscribes to the session's end. */
  on(event: 'end', listener: () => void): unknown;
  /** Drops the notification listeners before the session is replaced. */
  removeAllListeners(event: 'notification'): unknown;
}

/**
 * Options of {@link PostgresEventBus}.
 *
 * @stability experimental
 */
export interface PostgresEventBusOptions {
  /** The APPLICATION database's connection string (`buildDatabaseUrl()`). */
  connectionString: string;
  /** This process's origin id; random by default. */
  origin?: string;
  /** The first reconnect delay. Default {@link DEFAULT_INITIAL_BACKOFF_MS}. */
  initialBackoffMs?: number;
  /** The longest reconnect delay. Default {@link DEFAULT_MAX_BACKOFF_MS}. */
  maxBackoffMs?: number;
  /** `Math.random` in production; fixed in tests. */
  random?: () => number;
  /** Builds the listener session; a test substitutes a fake. */
  createClient?: (config: ClientConfig) => EventBusListenerClient;
  /** Where publish, delivery and reconnect counts go (`app.event_bus.*`, #680). Default: nowhere. */
  metrics?: EventBusMetrics;
}

/**
 * The reconnect delay after `failures` consecutive failures: `initial * 2^n`,
 * capped at `max`, plus up to 20% jitter (the total also capped at `max`).
 *
 * @param failures - consecutive failures so far.
 * @param initialMs - the first delay.
 * @param maxMs - the cap.
 * @param random - the jitter source.
 * @returns the delay in milliseconds.
 * @stability experimental
 */
export function eventBusBackoffMs(
  failures: number,
  initialMs: number = DEFAULT_INITIAL_BACKOFF_MS,
  maxMs: number = DEFAULT_MAX_BACKOFF_MS,
  random: () => number = Math.random,
): number {
  const base = Math.min(maxMs, initialMs * 2 ** Math.max(0, failures));
  return Math.min(maxMs, Math.round(base + base * 0.2 * random()));
}

/**
 * The cross-replica adapter: `pg_notify` to publish, one dedicated `LISTEN`
 * session to receive. See the header of this file.
 *
 * @stability experimental
 */
export class PostgresEventBus implements EventBus, OnModuleInit, OnModuleDestroy {
  /** Always `postgres`. */
  readonly adapter = 'postgres' as const;
  /** This process's origin id. */
  readonly origin: string;

  private readonly logger = new Logger(PostgresEventBus.name);
  private readonly dispatcher = new EventBusDispatcher(this.logger);

  private readonly connectionString: string;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly random: () => number;
  private readonly createClient: (config: ClientConfig) => EventBusListenerClient;
  private readonly metrics: EventBusMetrics;

  private client: EventBusListenerClient | null = null;
  private connected = false;
  private started = false;
  private closed = false;
  private consecutiveFailures = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pid: number | null = null;

  private lastError: string | null = null;
  private lastConnectedAt: string | null = null;
  private publishFailures = 0;
  private reconnects = 0;

  constructor(
    private readonly sql: EventBusSqlPublisher,
    options: PostgresEventBusOptions,
  ) {
    this.connectionString = options.connectionString;
    this.origin = options.origin ?? newEventBusOrigin();
    this.initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.random = options.random ?? Math.random;
    this.createClient = options.createClient ?? ((config) => new Client(config) as unknown as EventBusListenerClient);
    this.metrics = options.metrics ?? NOOP_EVENT_BUS_METRICS;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Nest hook: starts the listener without blocking boot. */
  onModuleInit(): void {
    this.start();
  }

  /** Nest hook: closes the listener session. */
  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  /** Starts the listener WITHOUT waiting for it. Idempotent. */
  start(): void {
    if (this.started || this.closed) return;
    this.started = true;
    this.logger.log(`Event bus adapter "postgres": listening on channel "${EVENT_BUS_PG_CHANNEL}".`);
    void this.connect();
  }

  /** Stops reconnecting and closes the listener session. Idempotent. */
  async close(): Promise<void> {
    this.closed = true;
    this.connected = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const client = this.client;
    this.client = null;
    this.pid = null;

    if (client) {
      client.removeAllListeners('notification');
      await client.end().catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------------------
  // EventBus
  // ---------------------------------------------------------------------------

  /**
   * Delivers locally (and, on a shared adapter, to every other replica). Never rejects.
   *
   * @param channel - a logical channel ({@link EVENT_BUS_CHANNEL_PATTERN}).
   * @param payload - JSON-serialisable data, at most {@link EVENT_BUS_MAX_PAYLOAD_BYTES} encoded.
   */
  async publish<T>(channel: string, payload: T): Promise<void> {
    if (!isValidEventBusChannel(channel)) {
      this.recordPublishFailure(`Refusing to publish on invalid event bus channel "${String(channel)}".`);
      this.metrics.published(String(channel), 'rejected');
      return;
    }

    let encoded: string;
    try {
      encoded = encodeEventBusEnvelope(channel, this.origin, payload);
    } catch (error) {
      this.recordPublishFailure(`Event bus publish on "${channel}" rejected: ${describeEventBusError(error)}`);
      this.metrics.published(channel, 'rejected');
      return;
    }

    // LOCAL FIRST, and independently of the database: this process's own
    // subscribers must not depend on a round trip, or on the listener being up.
    this.dispatcher.dispatch(channel, encoded, { origin: this.origin, local: true });
    this.metrics.delivered(channel, 'local');

    try {
      await this.sql.$executeRaw`SELECT pg_notify('platform_bus', ${encoded})`;
      this.metrics.published(channel, 'published');
    } catch (error) {
      this.recordPublishFailure(
        `Event bus NOTIFY on "${channel}" failed; other replicas will not see it: ${describeEventBusError(error)}`,
      );
      this.metrics.published(channel, 'notify_failed');
    }
  }

  /**
   * Registers a handler; returns its unsubscribe function.
   *
   * @param channel - a logical channel.
   * @param handler - called once per message, isolated from the publisher.
   * @returns the unsubscribe function.
   */
  subscribe<T>(channel: string, handler: EventBusHandler<T>): () => void {
    return this.dispatcher.subscribe(channel, handler);
  }

  /**
   * A synchronous snapshot; performs no I/O.
   *
   * @returns the bus's health.
   */
  health(): EventBusHealth {
    return {
      adapter: this.adapter,
      connected: this.connected,
      lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt,
      publishFailures: this.publishFailures,
      reconnects: this.reconnects,
    };
  }

  /**
   * The listener session's backend pid while connected. Diagnostics and tests only.
   *
   * @returns the pid, or `null` while disconnected.
   */
  listenerPid(): number | null {
    return this.pid;
  }

  /**
   * Handlers on a channel. Diagnostics and tests only.
   *
   * @param channel - a logical channel.
   * @returns how many handlers are subscribed.
   */
  handlerCount(channel: string): number {
    return this.dispatcher.handlerCount(channel);
  }

  // ---------------------------------------------------------------------------
  // The listener
  // ---------------------------------------------------------------------------

  private async connect(): Promise<void> {
    if (this.closed) return;

    const client = this.createClient({
      connectionString: this.connectionString,
      application_name: EVENT_BUS_LISTENER_APPLICATION_NAME,
      // A long-lived idle session behind NAT or a cloud load balancer is
      // otherwise silently dropped; TCP keepalive keeps it visibly alive.
      keepAlive: true,
      connectionTimeoutMillis: 10_000,
    });
    this.client = client;

    client.on('notification', (message) => this.onNotification(message));
    // Never removed: an 'error' with no listener crashes the process, and a
    // superseded client can still emit one while it closes.
    client.on('error', (error) => this.onConnectionLost(client, error));
    client.on('end', () => this.onConnectionLost(client, null));

    try {
      await client.connect();
      await client.query(`LISTEN ${EVENT_BUS_PG_CHANNEL}`);
      const result = await client.query('SELECT pg_backend_pid() AS pid');

      if (this.closed || this.client !== client) {
        await client.end().catch(() => undefined);
        return;
      }

      const reconnected = this.lastConnectedAt !== null;
      this.pid = Number(result.rows[0]?.pid) || null;
      this.connected = true;
      this.lastConnectedAt = new Date().toISOString();
      this.consecutiveFailures = 0;

      if (reconnected) {
        this.logger.log(`Event bus listener reconnected (LISTEN ${EVENT_BUS_PG_CHANNEL}).`);
      } else {
        this.logger.log(`Event bus listener connected (LISTEN ${EVENT_BUS_PG_CHANNEL}).`);
      }
    } catch (error) {
      this.onConnectionLost(client, error);
    }
  }

  private onConnectionLost(client: EventBusListenerClient, error: unknown): void {
    // A superseded client (already replaced, or closed on shutdown) reports
    // its own end; that is not news.
    if (client !== this.client) return;

    this.client = null;
    this.connected = false;
    this.pid = null;

    if (error) this.lastError = describeEventBusError(error);

    client.removeAllListeners('notification');
    void client.end().catch(() => undefined);

    if (this.closed) return;

    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closed) return;

    const delay = eventBusBackoffMs(this.consecutiveFailures, this.initialBackoffMs, this.maxBackoffMs, this.random);
    this.consecutiveFailures += 1;
    this.reconnects += 1;
    this.metrics.reconnect();

    this.logger.warn(
      `Event bus listener is disconnected${this.lastError ? ` (${this.lastError})` : ''}; ` +
        `reconnecting in ${delay}ms. Live events from other replicas are missed until it is back.`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private onNotification(message: Notification): void {
    if (message.channel !== EVENT_BUS_PG_CHANNEL) return;

    const envelope = decodeEventBusEnvelope(message.payload);
    if (!envelope) {
      this.logger.warn(`Dropping a malformed message on "${EVENT_BUS_PG_CHANNEL}".`);
      return;
    }

    // OUR OWN ECHO. Local subscribers were served at publish time.
    if (envelope.o === this.origin) return;

    this.dispatcher.dispatch(envelope.c, message.payload as string, { origin: envelope.o, local: false });
    this.metrics.delivered(envelope.c, 'remote');
  }

  private recordPublishFailure(message: string): void {
    this.publishFailures += 1;
    this.lastError = message;
    this.logger.warn(message);
  }
}
