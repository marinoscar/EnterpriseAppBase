// =============================================================================
// The data the notifications slice reads and writes, structurally (issue #738)
// =============================================================================
//
// The slice never imports a generated Prisma client, not even its types (the
// rule of identity, settings, sharing and jobs): the package is built,
// type-checked and tested before any app's `prisma generate`, and works with
// any app that composed the `notifications` fragment of
// `@marinoscar/platform-db` (`Notification`, `NotificationDelivery`,
// `PushSubscription`, `NotificationBroadcast`) on top of the identity and
// settings fragments it reads (`User`, `UserSettings`, `SystemSettings`,
// `AuditEvent`, `Membership`).
//
// THE CLIENT ARRIVES THROUGH THE CORE PORT `PLATFORM_PRISMA` and is seen as
// {@link NotificationsPrisma}. Every delegate method takes Prisma's arguments
// untyped (`NotificationsQueryArgs`) and returns the model's row: an app's
// generated client is assignable to these shapes as it is, so
// `new NotificationsService(prismaService, ...)` type-checks in an app's own
// tests without a cast. A call that `include`s or `select`s names the shape
// it reads with a cast or a type argument at the call site.
//
// The rows mirror the fragment column for column. A column added to the
// fragment is added here in the same change.
// =============================================================================

/**
 * Prisma's arguments for one delegate call (`where`, `data`, `select`, ...),
 * untyped on purpose: the app's client checks them at run time, and a typed
 * shape here would make the app's generated client unassignable to
 * {@link NotificationsPrisma}.
 *
 * @stability experimental
 */
export type NotificationsQueryArgs = any;

/**
 * A `where` filter on one model, as Prisma accepts it.
 *
 * @stability experimental
 */
export type NotificationsWhere = { [field: string]: any };

/**
 * A JSON column's value, as Prisma reads it (`Prisma.JsonValue`).
 *
 * @stability experimental
 */
export type NotificationsJsonValue =
  | string
  | number
  | boolean
  | { [Key in string]?: NotificationsJsonValue }
  | NotificationsJsonValue[]
  | null;

/**
 * A JSON value a write accepts (`Prisma.InputJsonValue`), as the slice
 * passes it: always a plain serialisable object.
 *
 * @stability experimental
 */
export type NotificationsInputJsonValue = { readonly [Key in string]?: unknown } | readonly unknown[] | string | number | boolean;

/**
 * The result of an `updateMany` or `deleteMany`.
 *
 * @stability experimental
 */
export interface NotificationsBatchPayload {
  /** How many rows the statement touched. */
  count: number;
}

// ---- enums --------------------------------------------------------------------------

/**
 * `NotificationDeliveryStatus`, as values: the generated enum's members.
 *
 * @stability experimental
 */
export const NotificationDeliveryStatus: { readonly [K in 'queued' | 'sent' | 'failed']: K } = Object.freeze({
  queued: 'queued',
  sent: 'sent',
  failed: 'failed',
} as const);

/**
 * One delivery attempt's status (`notification_deliveries.status`).
 *
 * @stability experimental
 */
export type NotificationDeliveryStatus = (typeof NotificationDeliveryStatus)[keyof typeof NotificationDeliveryStatus];

/**
 * `NotificationBroadcastStatus`, as values: the generated enum's members.
 *
 * @stability experimental
 */
export const NotificationBroadcastStatus: {
  readonly [K in 'draft' | 'scheduled' | 'sending' | 'sent' | 'canceled' | 'failed']: K;
} = Object.freeze({
  draft: 'draft',
  scheduled: 'scheduled',
  sending: 'sending',
  sent: 'sent',
  canceled: 'canceled',
  failed: 'failed',
} as const);

/**
 * A broadcast's lifecycle status (`notification_broadcasts.status`).
 *
 * @stability experimental
 */
export type NotificationBroadcastStatus = (typeof NotificationBroadcastStatus)[keyof typeof NotificationBroadcastStatus];

// ---- rows ---------------------------------------------------------------------------

/**
 * A `notifications` row: one in-app inbox entry.
 *
 * @stability experimental
 */
export interface NotificationRow {
  /** Primary key. */
  id: string;
  /** The recipient. */
  userId: string;
  /** The event key that produced it. */
  eventKey: string;
  /** Rendered title. */
  title: string;
  /** Rendered body. */
  body: string;
  /** A root-relative link, or null. */
  link: string | null;
  /** When the user read it, or null. */
  readAt: Date | null;
  /** Creation time. */
  createdAt: Date;
}

/**
 * A `notification_deliveries` row: one channel attempt.
 *
 * @stability experimental
 */
export interface NotificationDeliveryRow {
  /** Primary key. */
  id: string;
  /** The event key. */
  eventKey: string;
  /** The recipient account, or null for an address-only recipient. */
  userId: string | null;
  /** Where it went (an address, a user id, an endpoint count). */
  recipient: string;
  /** The channel id. An open string: a channel id is never an enum. */
  channel: string;
  /** The attempt's status. */
  status: NotificationDeliveryStatus;
  /** The transport's id, on success. */
  providerMessageId: string | null;
  /** The failure text, on failure. */
  error: string | null;
  /** Creation time. */
  createdAt: Date;
  /** Last update. */
  updatedAt: Date;
}

/**
 * A `push_subscriptions` row: one browser's Web Push endpoint.
 *
 * @stability experimental
 */
export interface PushSubscriptionRow {
  /** Primary key. */
  id: string;
  /** The subscriber. */
  userId: string;
  /** The push service URL (a capability URL; never logged past its host). */
  endpoint: string;
  /** The client's P-256 public key. */
  p256dh: string;
  /** The client's auth secret. */
  auth: string;
  /** When the browser said the subscription expires, or null. */
  expirationTime: Date | null;
  /** The subscribing browser's user agent, or null. */
  userAgent: string | null;
  /** Consecutive delivery failures. */
  failureCount: number;
  /** The last successful delivery, or null. */
  lastSuccessAt: Date | null;
  /** The surface that registered it (#746): `browser` or `android_app`. */
  platform: string;
  /** Creation time. */
  createdAt: Date;
  /** Last update. */
  updatedAt: Date;
}

/**
 * A `notification_broadcasts` row: one admin broadcast.
 *
 * @stability experimental
 */
export interface NotificationBroadcastRow {
  /** Primary key. */
  id: string;
  /** Title. */
  title: string;
  /** Body. */
  body: string;
  /** A root-relative link, or null. */
  link: string | null;
  /** The email call-to-action label, or null. */
  ctaLabel: string | null;
  /** `admin.broadcast` or `admin.broadcast_critical`. */
  eventKey: string;
  /** The requested channels (open channel ids). */
  channels: string[];
  /** Lifecycle status. */
  status: NotificationBroadcastStatus;
  /** When it is due, or null for "now". */
  scheduledFor: Date | null;
  /** When the start job froze the audience, or null. */
  startedAt: Date | null;
  /** When it settled, or null. */
  finishedAt: Date | null;
  /** When it was canceled, or null. */
  canceledAt: Date | null;
  /** The frozen audience cutoff, or null before the start job ran. */
  audienceCutoff: Date | null;
  /** The keyset cursor of the last chunk enqueued, or null. */
  cursorUserId: string | null;
  /** The frozen audience size, or null before the start job ran. */
  recipientsTargeted: number | null;
  /** Recipients dispatched so far. */
  recipientsDispatched: number;
  /** The last failure text, or null. */
  lastError: string | null;
  /** The author, or null once the author is deleted. */
  createdById: string | null;
  /**
   * The organization the broadcast targets (#738): null for a system
   * broadcast (every active user of the deployment), set for the active
   * members of that organization only.
   */
  targetOrgId: string | null;
  /** Creation time. */
  createdAt: Date;
  /** Last update. */
  updatedAt: Date;
}

// ---- delegates ----------------------------------------------------------------------

/**
 * The delegate methods the slice calls on one model.
 *
 * @typeParam Row - the model's row.
 * @stability experimental
 */
export interface NotificationsDelegate<Row> {
  /** Prisma `findUnique`. */
  findUnique(args: NotificationsQueryArgs): Promise<Row | null>;
  /** Prisma `findFirst`. */
  findFirst(args?: NotificationsQueryArgs): Promise<Row | null>;
  /** Prisma `findMany`. */
  findMany(args?: NotificationsQueryArgs): Promise<Row[]>;
  /** Prisma `create`. */
  create(args: NotificationsQueryArgs): Promise<Row>;
  /** Prisma `update`. */
  update(args: NotificationsQueryArgs): Promise<Row>;
  /** Prisma `upsert`. */
  upsert(args: NotificationsQueryArgs): Promise<Row>;
  /** Prisma `delete`. */
  delete(args: NotificationsQueryArgs): Promise<Row>;
  /** Prisma `updateMany`. */
  updateMany(args: NotificationsQueryArgs): Promise<NotificationsBatchPayload>;
  /** Prisma `deleteMany`. */
  deleteMany(args?: NotificationsQueryArgs): Promise<NotificationsBatchPayload>;
  /** Prisma `count`. */
  count(args?: NotificationsQueryArgs): Promise<number>;
  /** Prisma `groupBy`. */
  groupBy(args: NotificationsQueryArgs): Promise<Array<{ [field: string]: any }>>;
}

/**
 * The models of other fragments the slice reads (`users`, `user_settings`,
 * `system_settings`, `jobs`) or appends to (`audit_events`), with rows typed
 * loosely: the slice always `select`s the fields it reads.
 *
 * @stability experimental
 */
export type NotificationsForeignDelegate = NotificationsDelegate<any>;

/**
 * The client inside a transaction.
 *
 * @stability experimental
 */
export interface NotificationsTx {
  /** `notifications`. */
  notification: NotificationsDelegate<NotificationRow>;
  /** `notification_deliveries`. */
  notificationDelivery: NotificationsDelegate<NotificationDeliveryRow>;
  /** `push_subscriptions`. */
  pushSubscription: NotificationsDelegate<PushSubscriptionRow>;
  /** `notification_broadcasts`. */
  notificationBroadcast: NotificationsDelegate<NotificationBroadcastRow>;
  /** `users` (identity fragment). */
  user: NotificationsForeignDelegate;
  /** `user_settings` (settings fragment). */
  userSettings: NotificationsForeignDelegate;
  /** `system_settings` (settings fragment). */
  systemSettings: NotificationsForeignDelegate;
  /** `audit_events` (base fragment). */
  auditEvent: NotificationsForeignDelegate;
  /** `jobs` (jobs fragment): the broadcast delete guard reads its own jobs. */
  job: NotificationsForeignDelegate;
  /** `organizations` (identity fragment): a broadcast's target must exist. */
  organization: NotificationsForeignDelegate;
}

/**
 * The client the slice injects under `PLATFORM_PRISMA`: the app's
 * `PrismaService` (or any client of the composed schema).
 *
 * @stability experimental
 */
export interface NotificationsPrisma extends NotificationsTx {
  /** Prisma's interactive transaction. */
  $transaction<T>(fn: (tx: NotificationsTx) => Promise<T>, options?: { maxWait?: number; timeout?: number }): Promise<T>;
}

/**
 * Prisma's BATCH transaction (`$transaction([a, b])`), the one form the inbox
 * read uses. Kept off {@link NotificationsPrisma} (an overloaded
 * `$transaction` there would make an app's generated client unassignable);
 * the store views its client through this shape at the one call site.
 *
 * @stability experimental
 */
export interface NotificationsBatchTransaction {
  /** Runs the statements in one transaction; resolves their results in order. */
  $transaction<P extends readonly Promise<unknown>[]>(statements: [...P]): Promise<{ [K in keyof P]: Awaited<P[K]> }>;
}
