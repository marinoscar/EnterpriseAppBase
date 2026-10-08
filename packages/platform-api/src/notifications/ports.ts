// =============================================================================
// The notifications slice's host ports (issue #738, PP-8.5)
// =============================================================================
//
// Every capability the slice needs from the application, as ONE injection
// token per capability. The slice injects these and never imports an app
// service; the app binds each token in a `@Global()` module of its own (the
// reference app: `apps/api/src/platform/notifications/notifications-host.module.ts`),
// passed to `NotificationsModule.forRoot({ imports })`. Each interface is
// derived from the exact calls the slice makes; nothing wider.
//
// The database is the core port `PLATFORM_PRISMA`, seen as
// `NotificationsPrisma` (`data/notifications-db.ts`). Both ports here are
// OPTIONAL: without them the slice still runs (no delivery metric; the SSE
// stream reaches only the tabs connected to the process that wrote the row).
//
// The tokens are `Symbol.for(...)` keys, so two copies of this file agree.
// =============================================================================

// ---- metrics --------------------------------------------------------------------------

/**
 * Injection token of the app's {@link NotificationsMetrics}. Optional:
 * without it the dispatcher records nothing.
 *
 * @example
 * ```ts
 * // NotificationsHostModule: { provide: NOTIFICATIONS_METRICS, useExisting: AppMetricsService }
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const NOTIFICATIONS_METRICS: unique symbol = Symbol.for('@marinoscar/platform/notifications/METRICS');

/**
 * The outcome of one channel attempt, as the delivery counter labels it.
 *
 * @stability experimental
 */
export type NotificationDeliveryOutcome = 'sent' | 'failed' | 'rate_limited' | 'error';

/**
 * The app's notification instruments, as the dispatcher records into them.
 * The reference app binds its `AppMetricsService`
 * (`app.notifications.deliveries`, same labels as before the move:
 * dashboards depend on them).
 *
 * ⚠ NO METHOD TAKES AN ORGANIZATION OR A USER. `org.id` is a span attribute,
 * never a metric label (cardinality; spec, "Tenancy and access model").
 *
 * @stability experimental
 */
export interface NotificationsMetrics {
  /**
   * One channel attempt settled.
   *
   * @param channel - the channel id.
   * @param outcome - how it ended.
   * @param eventKey - the event key (a bounded set: the registry).
   */
  notificationDelivery(channel: string, outcome: NotificationDeliveryOutcome, eventKey: string): void;
}

/**
 * The metrics used when the app binds none: every call is a no-op.
 *
 * @stability experimental
 */
export const NOOP_NOTIFICATIONS_METRICS: NotificationsMetrics = Object.freeze({
  notificationDelivery: () => undefined,
});

// ---- the cross-replica bus ------------------------------------------------------------

/**
 * Injection token of the app's cross-replica {@link NotificationsEventBus}.
 * Optional: without it a notification streams only to the tabs connected to
 * the replica that wrote it (the per-process behaviour before #682).
 *
 * @example
 * ```ts
 * // NotificationsHostModule:
 * {
 *   provide: NOTIFICATIONS_EVENT_BUS,
 *   useFactory: (bus: EventBus): NotificationsEventBus => ({
 *     publish: (channel, payload) => bus.publish(channel, payload),
 *     subscribe: (channel, handler) => bus.subscribe(channel, handler),
 *     exceedsPayloadLimit: exceedsEventBusPayloadLimit,
 *   }),
 *   inject: [EVENT_BUS],
 * }
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const NOTIFICATIONS_EVENT_BUS: unique symbol = Symbol.for('@marinoscar/platform/notifications/EVENT_BUS');

/**
 * Where a bus message came from.
 *
 * @stability experimental
 */
export interface NotificationsEventBusMeta {
  /** The publishing process's origin id. */
  origin: string;
  /** Whether this process published it (already delivered locally). */
  local: boolean;
}

/**
 * The app's event bus, as the stream uses it: one channel
 * (`notifications.stream`, {@link NOTIFICATION_STREAM_BUS_CHANNEL}). Messages are at most once and never
 * transactional; the durable `notifications` row is the delivery, the stream
 * is liveness on top of it.
 *
 * @stability experimental
 */
export interface NotificationsEventBus {
  /**
   * Publishes a JSON payload on a channel, to this and every other replica.
   * Never throws for a delivery failure (the bus logs it).
   *
   * @param channel - the channel.
   * @param payload - the payload; small.
   */
  publish<T>(channel: string, payload: T): Promise<void>;
  /**
   * Subscribes to a channel; returns the unsubscribe function.
   *
   * @param channel - the channel.
   * @param handler - called once per message, here and from other replicas.
   */
  subscribe<T>(
    channel: string,
    handler: (payload: T, meta: NotificationsEventBusMeta) => void | Promise<void>,
  ): () => void;
  /**
   * Whether `payload` would be refused as oversize on `channel`. Optional:
   * without it the stream estimates conservatively
   * ({@link NOTIFICATION_STREAM_INLINE_LIMIT_BYTES}). A notification too large to inline is published as a
   * reference the receiving replica re-reads.
   *
   * @param channel - the channel.
   * @param payload - the candidate payload.
   */
  exceedsPayloadLimit?(channel: string, payload: unknown): boolean;
}

/**
 * The bus channel the stream fans out on. Permanent: every replica of a
 * deployment must agree on it during a rolling upgrade.
 *
 * @stability stable
 */
export const NOTIFICATION_STREAM_BUS_CHANNEL = 'notifications.stream';

/**
 * The inline-payload budget the stream assumes when the bus does not report
 * its own limit: the reference app's Postgres `NOTIFY` adapter accepts about
 * 7,500 bytes per envelope, less the envelope itself.
 *
 * @stability experimental
 */
export const NOTIFICATION_STREAM_INLINE_LIMIT_BYTES = 7_000;
