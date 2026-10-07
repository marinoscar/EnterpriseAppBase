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
 * `SystemAccessReason`: the user purge and the read-only Doctor check.
 *
 * @stability experimental
 */
export type SharingSystemReason = 'purge' | 'doctor';

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
