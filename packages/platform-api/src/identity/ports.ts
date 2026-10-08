// =============================================================================
// The identity slice's host ports (issue #727, PP-6.6)
// =============================================================================
//
// Every capability identity needs from the application, as ONE injection token
// per capability. The slice injects these and never imports an app service;
// the app binds each token to an adapter of its own (the reference app:
// `apps/api/src/platform/identity/identity-host.module.ts`), passed to
// `IdentityModule.forRoot({ imports })`. Each interface is derived from the
// exact calls identity makes; nothing wider.
//
// The database is the core port `PLATFORM_PRISMA` (`@marinoscar/platform-api/core`),
// seen as the structural `IdentityPrisma` (`data/identity-db.ts`): identity
// owns its models (the identity fragment of `@marinoscar/platform-db`) but
// never depends on a generated client, not even its types.
//
// DIRECTION. Identity sits under every other slice (docs/specs/platform-packages.md,
// "Dependency graph"), so it cannot import notifications, jobs or nodes. Each
// of those reaches identity through a port the app binds, never the reverse.
//
// The tokens are `Symbol.for(...)` keys, so two copies of this file (two
// bundles, a test that loads the source next to the built package) agree.
// =============================================================================

import type { Logger } from '@nestjs/common';

import type { AuthenticatedUser } from './auth/interfaces/authenticated-user.interface';

// ---- database -----------------------------------------------------------------------

export type { IdentityPrisma } from './data/identity-db';

// ---- notifications (the IDENTITY_NOTIFIER seam) -------------------------------------

/**
 * Injection token of the app's {@link IdentityNotifier}. The app binds it to
 * its notification dispatcher, so identity does not import the notifications
 * slice (identity sits above it in the dependency graph).
 *
 * @example
 * ```ts
 * IdentityModule.forRoot({ imports: [IdentityHostModule] });
 * // IdentityHostModule: { provide: IDENTITY_NOTIFIER, useClass: NotificationsIdentityNotifier }
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const IDENTITY_NOTIFIER: unique symbol = Symbol.for('@marinoscar/platform/identity/NOTIFIER');

/**
 * A user's roles changed (a system administrator edited them, or an
 * organization administrator changed the member's org role).
 *
 * @stability experimental
 */
export interface RoleChangedNotice {
  /** The account whose roles changed. */
  recipientEmail: string;
  /** Roles held before the change, as stored. May be empty. */
  previousRoles: string[];
  /** Roles held after the change, as stored. May be empty. */
  currentRoles: string[];
  /** When the change was made. */
  changedAt: Date;
  /** Absolute URL of the application root, when `APP_URL` is configured. */
  appUrl?: string;
}

/**
 * A user record was created by a sign-in.
 *
 * @stability experimental
 */
export interface UserWelcomeNotice {
  /** The address the account was created under. */
  recipientEmail: string;
  /** The provider's display name, when it supplied one. Attacker-influenced: escape it. */
  recipientName?: string;
  /** Roles the new account was given, as stored. */
  roles: string[];
  /** Absolute URL of the application root, when `APP_URL` is configured. */
  appUrl?: string;
}

/**
 * An administrator added an address to the allowlist.
 *
 * @stability experimental
 */
export interface AllowlistInvitationNotice {
  /** The allowlisted address, the one they must sign in with. */
  recipientEmail: string;
  /** Who added them (display name or email), when known. Disclosed on purpose. */
  invitedBy?: string;
  /** Absolute URL of the sign-in page, when `APP_URL` is configured. */
  signInUrl?: string;
}

/**
 * An organization administrator invited an address to an organization.
 *
 * @stability experimental
 */
export interface OrgInvitationNotice {
  /** The invited address, the one they must sign in with. */
  recipientEmail: string;
  /** The organization's display name. */
  orgName: string;
  /** The org role they will hold (`org_admin`, `contributor`, `viewer`). */
  roleName: string;
  /** Who invited them (display name or email), when known. Disclosed on purpose. */
  invitedBy?: string;
  /** Absolute URL of the sign-in page, when `APP_URL` is configured. */
  signInUrl?: string;
}

/**
 * Where identity raises the four notifications it owns. Every method is called
 * AFTER the triggering write committed and outside any transaction, and must
 * not throw for a delivery failure (the app's dispatcher records it).
 *
 * @stability experimental
 */
export interface IdentityNotifier {
  /**
   * A user's roles changed.
   *
   * @param userId - the user whose roles changed.
   * @param notice - what changed.
   */
  roleChanged(userId: string, notice: RoleChangedNotice): Promise<void>;
  /**
   * A user record was created by a sign-in.
   *
   * @param userId - the new user.
   * @param notice - the welcome content.
   */
  userWelcomed(userId: string, notice: UserWelcomeNotice): Promise<void>;
  /**
   * An address was allowlisted. Sent to an address, not a user: the person
   * has no account yet.
   *
   * @param email - the allowlisted address.
   * @param notice - the invitation content.
   */
  allowlistInvitation(email: string, notice: AllowlistInvitationNotice): Promise<void>;
  /**
   * An address was invited to an organization. Sent to an address.
   *
   * @param email - the invited address.
   * @param notice - the invitation content.
   */
  orgInvitation(email: string, notice: OrgInvitationNotice): Promise<void>;
}

// ---- user defaults (the USER_DEFAULTS seam) -----------------------------------------

/**
 * Injection token of the app's {@link UserDefaults}: what a new user's
 * settings row holds at creation.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const USER_DEFAULTS: unique symbol = Symbol.for('@marinoscar/platform/identity/USER_DEFAULTS');

/**
 * Defaults applied when identity creates a user (a first sign-in, or the
 * test-auth login).
 *
 * @stability experimental
 */
export interface UserDefaults {
  /**
   * The `user_settings.value` a new user starts with. Called once per created
   * user; return a fresh object.
   */
  userSettings(): Record<string, unknown>;
}

// ---- profile images -----------------------------------------------------------------

/**
 * Injection token of the app's {@link IdentityProfileImages}: how a user's
 * picture is resolved from their stored profile settings.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const IDENTITY_PROFILE_IMAGES: unique symbol = Symbol.for('@marinoscar/platform/identity/PROFILE_IMAGES');

/**
 * Profile pictures, as `/api/auth/me` and `/api/users` report them. The
 * picture lives in the user's settings (`profile.imageSource`) and in object
 * storage, which identity does not own.
 *
 * @stability experimental
 */
export interface IdentityProfileImages {
  /**
   * The picture representing the user, or `null`.
   *
   * @param user - the user's id and provider picture.
   * @param storedProfile - the raw `profile` value of their settings, unvalidated.
   */
  resolveImageUrl(user: { id: string; providerProfileImageUrl: string | null }, storedProfile: unknown): string | null;
  /**
   * Whether an uploaded picture is stored, whichever source is selected.
   *
   * @param storedProfile - the raw `profile` value of their settings, unvalidated.
   */
  hasUploadedImage(storedProfile: unknown): boolean;
}

// ---- metrics --------------------------------------------------------------------------

/**
 * Injection token of the app's {@link IdentityMetrics}. Optional: without it
 * identity records nothing.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const IDENTITY_METRICS: unique symbol = Symbol.for('@marinoscar/platform/identity/METRICS');

/**
 * How a Google sign-in ended (`app.auth.logins` `outcome`). Closed, bounded.
 *
 * @stability experimental
 */
export type IdentityLoginOutcome = 'success' | 'allowlist_rejected' | 'disabled' | 'no_organization';

/**
 * How a refresh-token rotation ended (`app.auth.refreshes` `outcome`). Closed, bounded.
 *
 * @stability experimental
 */
export type IdentityRefreshOutcome =
  | 'success'
  | 'invalid'
  | 'expired'
  | 'reuse_detected'
  | 'user_inactive'
  | 'device_revoked'
  | 'no_organization';

/**
 * The app's metric instruments, as identity records into them. The reference
 * app binds its `AppMetricsService` (same instruments, same labels as before
 * the move: dashboards depend on them).
 *
 * @stability experimental
 */
export interface IdentityMetrics {
  /**
   * One sign-in attempt (`app.auth.logins`).
   *
   * @param outcome - how it ended.
   * @param provider - the provider id; `'google'` by default.
   */
  authLogin(outcome: IdentityLoginOutcome, provider?: string): void;
  /**
   * One refresh-token rotation (`app.auth.refreshes`).
   *
   * @param outcome - how it ended.
   */
  authRefresh(outcome: IdentityRefreshOutcome): void;
  /**
   * Adds to a registered counter (`orgInvitesCreated`, `orgMembersRemoved`).
   *
   * @param key - the counter's registry key.
   * @param value - the increment; 1 by default.
   */
  add(key: string, value?: number): void;
}

/**
 * The metrics used when the app binds none: every call is a no-op.
 *
 * @stability experimental
 */
export const NOOP_IDENTITY_METRICS: IdentityMetrics = Object.freeze({
  authLogin: () => undefined,
  authRefresh: () => undefined,
  add: () => undefined,
});

// ---- jobs -----------------------------------------------------------------------------

/**
 * Injection token of the app's {@link IdentityJobsPort}.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const IDENTITY_JOBS: unique symbol = Symbol.for('@marinoscar/platform/identity/JOBS');

/**
 * The columns of one queue job identity's handlers read.
 *
 * @stability experimental
 */
export interface IdentityJobRecord {
  /** The job id. */
  id: string;
}

/**
 * An identity job type's handler, structurally the app's `JobHandler`. Both
 * identity job types (`auth.token.cleanup`, `auth.device-code.cleanup`) are
 * SERVER-ONLY: they delete credential rows, a privilege a worker node never
 * holds, so they declare no `nodeResultSchema` and no `persistNodeResult`.
 *
 * @stability experimental
 */
export interface IdentityJobHandler {
  /** The job type. Permanent once jobs of it exist. */
  readonly type: string;
  /**
   * Runs one job; throws to fail it.
   *
   * @param job - the claimed job.
   */
  process(job: IdentityJobRecord): Promise<void>;
}

/**
 * The app's job queue, as identity uses it: an enqueue-only cron and a handler
 * registration.
 *
 * @stability experimental
 */
export interface IdentityJobsPort {
  /**
   * Queues one global housekeeping job of `type` unless one is pending or
   * running. Never throws: a failure is logged on `logger`.
   *
   * @param options - the type, a lower-case phrase for the log line, and the caller's logger.
   */
  enqueueHousekeepingJob(options: { type: string; what: string; logger: Logger }): Promise<void>;
  /**
   * Registers a handler with the queue's dispatcher. Called from `onModuleInit`.
   *
   * @param handler - the handler.
   */
  registerHandler(handler: IdentityJobHandler): void;
}

// ---- worker-node credentials ------------------------------------------------------------

/**
 * Injection token of the app's {@link IdentityNodeCredentials}: how a `nod_`
 * bearer token is resolved. Must be bound by a GLOBAL module: `JwtAuthGuard`
 * is instantiated in every module whose controllers use `@Auth()`.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const IDENTITY_NODE_CREDENTIALS: unique symbol = Symbol.for('@marinoscar/platform/identity/NODE_CREDENTIALS');

/**
 * The app's worker-node credential store, as `JwtAuthGuard` uses it.
 *
 * @stability experimental
 */
export interface IdentityNodeCredentials {
  /**
   * The owner of a live `nod_` token, loaded as a request user, or `null` for
   * an unknown, revoked or expired one.
   *
   * @param token - the raw `nod_...` token.
   */
  validateToken(token: string): Promise<AuthenticatedUser | null>;
}

// ---- event bus --------------------------------------------------------------------------

/**
 * Injection token of the app's cross-replica {@link IdentityEventBus}.
 * Optional: without it the principal cache invalidates in this process only.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const IDENTITY_EVENT_BUS: unique symbol = Symbol.for('@marinoscar/platform/identity/EVENT_BUS');

/**
 * Where a bus message came from.
 *
 * @stability experimental
 */
export interface IdentityEventBusMeta {
  /** The publishing process's origin id. */
  origin: string;
  /** Whether this process published it. */
  local: boolean;
}

/**
 * The bus's health, as the `auth.principal-cache` Doctor check reports it.
 *
 * @stability experimental
 */
export interface IdentityEventBusHealth {
  /** The adapter's name (`in-process`, `postgres`). */
  adapter: string;
  /** Whether it is connected. */
  connected: boolean;
  /** The last error, or `null`. */
  lastError: string | null;
  /** When it last connected (ISO 8601), or `null`. */
  lastConnectedAt: string | null;
  /** Publishes that failed. */
  publishFailures: number;
  /** Reconnections so far. */
  reconnects: number;
}

/**
 * The app's event bus, as the principal cache uses it: cross-replica
 * invalidation on one channel. The reference app binds its `EVENT_BUS`.
 *
 * @stability experimental
 */
export interface IdentityEventBus {
  /** The adapter's name (`in-process`, `postgres`). */
  readonly adapter: string;
  /**
   * Publishes a JSON payload on a channel.
   *
   * @param channel - the channel (`auth.principal.invalidate`).
   * @param payload - the payload; small.
   */
  publish<T>(channel: string, payload: T): Promise<void>;
  /**
   * Subscribes to a channel; returns the unsubscribe function.
   *
   * @param channel - the channel.
   * @param handler - called once per message.
   */
  subscribe<T>(channel: string, handler: (payload: T, meta: IdentityEventBusMeta) => void | Promise<void>): () => void;
  /** The bus's health. */
  health(): IdentityEventBusHealth;
}
