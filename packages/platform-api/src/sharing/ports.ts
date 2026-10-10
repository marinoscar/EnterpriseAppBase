// =============================================================================
// The sharing slice's host ports (issue #728, PP-7.1)
// =============================================================================
//
// Every capability the sharing slice needs from the application, as ONE
// injection token per capability. The slice injects these and never imports
// an app service or identity internals; the app binds each token to an adapter
// of its own (`apps/api/src/platform/sharing/`). Each interface is derived
// from the exact calls the slice makes.
//
// The tokens are `Symbol.for(...)` keys, so two copies of this file agree.
// =============================================================================

/**
 * Why the slice runs without an organization scope. A subset of core's
 * `SystemAccessReason`: the user purge, the read-only Doctor check, the
 * `sharing.grants.prune` retention job (#729) and the one-row lookup of a
 * link token by its hash (`link-resolution`, #730).
 *
 * @stability experimental
 */
export type SharingSystemReason = 'purge' | 'doctor' | 'retention' | 'link-resolution';

/**
 * Injection token of the app's {@link SharingDataPort}.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const SHARING_DATA: unique symbol = Symbol.for('@marinoscar/platform/sharing/DATA');

/**
 * The app's database, as the sharing slice reaches it. Every table of the
 * slice is under FORCEd row-level security, so there is no unscoped entry:
 * work runs either in one organization's scope or, for the purge and the
 * Doctor, on the system bypass client.
 *
 * The transaction client handed to `fn` is the app's plain Prisma transaction
 * client; the slice narrows it to its own structural shape.
 *
 * @stability experimental
 */
export interface SharingDataPort {
  /**
   * One interactive transaction whose first statement sets the
   * transaction-local `app.org_id` (and `app.user_id`). The reference app
   * binds it to `PrismaService.runInOrg`.
   *
   * @param scope - the organization (never request input) and the acting user.
   * @param fn - the unit of work.
   */
  runInOrg<R>(scope: { orgId: string; userId?: string }, fn: (tx: unknown) => Promise<R>): Promise<R>;
  /**
   * One interactive transaction on the system (bypass) client. The reference
   * app binds it to `PrismaSystemService.runAsSystem`.
   *
   * @param reason - why; recorded on the active span.
   * @param fn - the unit of work.
   */
  runAsSystem<R>(reason: SharingSystemReason, fn: (tx: unknown) => Promise<R>): Promise<R>;
}

/**
 * Injection token of the app's {@link SharingEventBus}. Optional: without one
 * the slice invalidates its membership cache in this process only.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const SHARING_EVENT_BUS: unique symbol = Symbol.for('@marinoscar/platform/sharing/EVENT_BUS');

/**
 * Who published a bus message.
 *
 * @stability experimental
 */
export interface SharingEventBusMeta {
  /** True when this process published it (already applied locally). */
  readonly local: boolean;
}

/**
 * The cross-replica event bus (the reference app's `EVENT_BUS`). Messages are
 * at most once, never transactional, and carry ids only.
 *
 * @stability experimental
 */
export interface SharingEventBus {
  /**
   * Sends `payload` to every subscriber of `channel`, here and on every other
   * replica. Never rejects.
   *
   * @param channel - a dotted lower-case channel name.
   * @param payload - JSON; ids only.
   */
  publish<T>(channel: string, payload: T): Promise<void>;
  /**
   * Registers a handler and returns its unsubscribe function.
   *
   * @param channel - the channel.
   * @param handler - called with each payload.
   */
  subscribe<T>(channel: string, handler: (payload: T, meta: SharingEventBusMeta) => void | Promise<void>): () => void;
}

/**
 * Injection token of the app's {@link SharingEventEmitter}. Optional: without
 * one the slice emits no in-process events.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const SHARING_EVENT_EMITTER: unique symbol = Symbol.for('@marinoscar/platform/sharing/EVENT_EMITTER');

/**
 * The in-process event emitter (the reference app's `EventEmitter2`). The
 * slice emits after the triggering write commits and never lets a listener's
 * failure reach the caller.
 *
 * @stability experimental
 */
export interface SharingEventEmitter {
  /**
   * Emits one event synchronously.
   *
   * @param event - the event name (`sharing.group.created`, ...).
   * @param payload - ids only.
   */
  emit(event: string, payload: unknown): unknown;
}

/**
 * Injection token of the app's {@link SharingNotifier}. Optional: without one
 * the slice sends no invitation notification.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const SHARING_NOTIFIER: unique symbol = Symbol.for('@marinoscar/platform/sharing/NOTIFIER');

/**
 * The app's notification dispatcher, as the slice uses it. Called after the
 * triggering transaction commits, outside it. Both calls are fire-and-forget:
 * a delivery failure never fails the action.
 *
 * @stability experimental
 */
export interface SharingNotifier {
  /**
   * Notifies one user through their enabled channels.
   *
   * @param eventKey - a registered notification event (`groups.invitation`).
   * @param userId - the recipient.
   * @param data - the template data.
   */
  notify(eventKey: string, userId: string, data: unknown): Promise<void>;
  /**
   * E-mails an address that has no account yet.
   *
   * @param eventKey - a registered notification event with the `email` channel.
   * @param email - the recipient address.
   * @param data - the template data.
   */
  notifyAddress(eventKey: string, email: string, data: unknown): Promise<void>;
}

/**
 * Injection token of the app's {@link SharingTenancy}. Optional: without one
 * the slice assumes `single`.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const SHARING_TENANCY: unique symbol = Symbol.for('@marinoscar/platform/sharing/TENANCY');

/**
 * The deployment's tenancy mode. In `multi` mode a group invite to an address
 * that is neither a member of the organization nor invited to it is refused.
 *
 * @stability experimental
 */
export interface SharingTenancy {
  /** `single` or `multi`. */
  mode(): 'single' | 'multi';
}

// ---- the job queue (#729) -------------------------------------------------------------

/**
 * Injection token of the app's {@link SharingJobsPort}. Optional: without
 * one the `sharing.grants.prune` job is neither registered nor scheduled, and
 * revoked, expired and dangling grants stay until an app removes them.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const SHARING_JOBS: unique symbol = Symbol.for('@marinoscar/platform/sharing/JOBS');

/**
 * The job record a sharing handler is given, structurally the app's job row.
 *
 * @stability experimental
 */
export interface SharingJobRecord {
  /** The job's id. */
  id: string;
  /** The job type. */
  type: string;
  /** The handler-defined payload (JSON). */
  payload: unknown;
}

/**
 * A job type's execution profile: the lease and the reaper's patience are
 * derived from `maxRuntimeMs`.
 *
 * @stability experimental
 */
export interface SharingJobExecutionProfile {
  /** The longest one attempt may run. */
  maxRuntimeMs: number;
  /** Attempts before the job fails for good. */
  maxAttempts: number;
}

/**
 * A sharing job type's handler, structurally the app's `JobHandler`. The
 * sharing job type is SERVER-ONLY: it declares no `nodeResultSchema` and no
 * `persistNodeResult`, because it reads the app's tables mid-computation
 * (each resource type's `loadOwners`).
 *
 * @stability experimental
 */
export interface SharingJobHandler {
  /** The job type. Permanent once jobs of it exist. */
  readonly type: string;
  /** The execution profile, when the global default does not fit. */
  readonly profile?: SharingJobExecutionProfile;
  /**
   * Runs one job; throws to fail it.
   *
   * @param job - the claimed job.
   */
  process(job: SharingJobRecord): Promise<void>;
}

/**
 * The app's job queue, as the sharing slice uses it.
 *
 * @stability experimental
 */
export interface SharingJobsPort {
  /**
   * Registers a handler with the queue's dispatcher. Called from `onModuleInit`.
   *
   * @param handler - the handler.
   */
  registerHandler(handler: SharingJobHandler): void;
  /**
   * Queues one global housekeeping job of `type` unless one is pending or
   * running. Never throws: a failure is logged on `logger`.
   *
   * @param options - the type, a lower-case phrase for the log line, and the caller's logger.
   */
  enqueueHousekeepingJob(options: { type: string; what: string; logger: { log(message: string): void; warn(message: string): void } }): Promise<void>;
}
