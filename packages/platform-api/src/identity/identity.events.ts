// =============================================================================
// Identity's domain events (issue #727, PP-6.6)
// =============================================================================
//
// Rung 4 of the extension contract: an app reacts to identity without editing
// it, for example by creating its own profile row when a user is created.
// Emitted on the app's `EventEmitter2` (`@nestjs/event-emitter`, which the app
// registers with `EventEmitterModule.forRoot()`), AFTER the triggering write
// committed, never inside a transaction.
//
// ⚠ `EventEmitter2` DISPATCHES SYNCHRONOUSLY, inside the request that caused
// the event. A listener does small, bounded work or enqueues a job; anything
// long-running is a queue job (CLAUDE.md, "Every long-running activity is a
// queue job"). A throwing listener is caught and logged here, so it can never
// fail the sign-in that raised the event.
//
// Payloads carry ids and closed values only: never a token, never a secret.
// =============================================================================

import type { Logger } from '@nestjs/common';

/**
 * The event names identity emits.
 *
 * - `identity.user.created`: a user record was created (first sign-in, or the
 *   test-auth login).
 * - `identity.membership.changed`: a membership was created, re-activated,
 *   suspended, given another org role, or removed.
 * - `identity.org.switched`: a session switched its active organization.
 *
 * @example
 * ```ts
 * @OnEvent(IDENTITY_EVENTS.USER_CREATED)
 * onUserCreated(event: IdentityUserCreatedEvent) { ... }
 * ```
 *
 * @extensionPoint event
 * @stability experimental
 */
export const IDENTITY_EVENTS = {
  /** A user record was created. Payload: {@link IdentityUserCreatedEvent}. */
  USER_CREATED: 'identity.user.created',
  /** A membership changed. Payload: {@link IdentityMembershipChangedEvent}. */
  MEMBERSHIP_CHANGED: 'identity.membership.changed',
  /** A session switched organization. Payload: {@link IdentityOrgSwitchedEvent}. */
  ORG_SWITCHED: 'identity.org.switched',
} as const;

/**
 * Payload of `identity.user.created`.
 *
 * @stability experimental
 */
export interface IdentityUserCreatedEvent {
  /** The new user's id. */
  userId: string;
  /** The new user's email. */
  email: string;
  /** How the user was created: an OAuth provider id (`google`) or `test-auth`. */
  source: string;
  /** The organization the user joined at creation, or `null` (multi-org mode). */
  orgId: string | null;
}

/**
 * What happened to a membership.
 *
 * @stability experimental
 */
export type IdentityMembershipChange = 'created' | 'reactivated' | 'role_changed' | 'status_changed' | 'removed';

/**
 * Payload of `identity.membership.changed`.
 *
 * @stability experimental
 */
export interface IdentityMembershipChangedEvent {
  /** The member's user id. */
  userId: string;
  /** The organization. */
  orgId: string;
  /** What happened. */
  change: IdentityMembershipChange;
  /** The org role after the change, or `null` when the membership was removed. */
  role: string | null;
  /** Who made the change, or `null` for the system (a sign-in claiming an invitation). */
  actorUserId: string | null;
}

/**
 * Payload of `identity.org.switched`.
 *
 * @stability experimental
 */
export interface IdentityOrgSwitchedEvent {
  /** The user whose session switched. */
  userId: string;
  /** The organization the session acts in from now on. */
  orgId: string;
}

/** The emitter shape identity needs: `EventEmitter2`'s `emit`. */
interface EventEmitterLike {
  emit(event: string, payload: unknown): boolean;
}

/**
 * Emits one identity event, swallowing (and logging) a listener's error so it
 * never fails the operation that raised the event. No-op without an emitter.
 *
 * @param emitter - the app's `EventEmitter2`, when one is registered.
 * @param logger - where a listener's failure is logged.
 * @param event - the event name.
 * @param payload - the payload.
 */
export function emitIdentityEvent(
  emitter: EventEmitterLike | undefined | null,
  logger: Pick<Logger, 'warn'>,
  event: (typeof IDENTITY_EVENTS)[keyof typeof IDENTITY_EVENTS],
  payload: IdentityUserCreatedEvent | IdentityMembershipChangedEvent | IdentityOrgSwitchedEvent,
): void {
  if (!emitter) return;
  try {
    emitter.emit(event, payload);
  } catch (error) {
    logger.warn(`A listener of ${event} threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}
