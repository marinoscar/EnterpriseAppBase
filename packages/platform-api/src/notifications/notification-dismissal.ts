import type { NotificationsTx } from './data/notifications-db';
import { findEvent } from './notification-events';
import { isChannelEnabled, readNotificationPreferences } from './notification-preferences';

// =============================================================================
// Dismiss-on-disable (issue #1090)
// =============================================================================
//
// Turning a notification event OFF means "stop showing me this", not "stop
// showing me this except for the eleven already there". For a STATE row it is
// the only way out at all: the reconcile that would drain the row to zero is
// now gated on the same preference, so the row would nag forever.
//
// Both functions below take the TRANSACTION CLIENT of the settings write and
// run inside it, so the settings change and the dismissal commit or roll back
// together. They are wired as the `onWrite` hooks of the `notifications`
// system and user settings namespaces (see `notifications.system-settings.ts`
// and `notifications.user-settings.ts`).
//
// RE-ENABLING DOES NOT RESTORE ANYTHING. A dismissed row stays dismissed; the
// producer raises a fresh one on its next occurrence.
//
// MANDATORY EVENTS ARE NEVER DISMISSED: a stored `false` for one is inert (see
// `isChannelEnabled`), and an audit-relevant inbox entry must outlive any
// toggle.
//
// Raw SQL on purpose: `updated_at` is anchored by the COUNTED rolling window
// and Prisma's `@updatedAt` is bypassed by raw statements, so it is set
// explicitly; `updateMany` would also not let one statement dismiss with
// `COALESCE(read_at, now())`.
// =============================================================================

/**
 * The event keys a user has switched off for the in-app inbox (the `browser` channel), from their settings
 * value AFTER a write: every event with a stored `false` that the resolver
 * agrees is disabled, which excludes a mandatory event and any key the registry
 * does not know.
 *
 * @param afterNamespace - the user's `notifications` namespace after the write (or `undefined`).
 * @returns the event keys to dismiss.
 *
 * @stability experimental
 */
export function inboxDisabledEventKeys(afterNamespace: unknown): string[] {
  const preferences = readNotificationPreferences({ notifications: afterNamespace });
  const stored = preferences.browser ?? {};
  const keys: string[] = [];
  for (const eventKey of Object.keys(stored)) {
    const event = findEvent(eventKey);
    if (event && !isChannelEnabled(event, 'browser', preferences)) keys.push(eventKey);
  }
  return keys;
}

/**
 * The non-mandatory event keys among `eventKeys`: what an admin may suppress
 * deployment-wide.
 *
 * @param eventKeys - `notifications.disabledEvents` after the write.
 * @returns the keys whose live rows should be dismissed.
 *
 * @stability experimental
 */
export function dismissibleEventKeys(eventKeys: readonly string[]): string[] {
  return eventKeys.filter((eventKey) => findEvent(eventKey)?.mandatory !== true);
}

/**
 * Dismisses every live row of the given events for ONE user, inside `tx`.
 *
 * Idempotent: a row already dismissed is untouched, so repeating it (every
 * save does) is a no-op and a stale row is healed by the next save.
 *
 * @param tx - the settings write's transaction client.
 * @param userId - whose rows.
 * @param eventKeys - the events that are now off for this user.
 * @returns how many rows were dismissed.
 *
 * @stability experimental
 */
export async function dismissEventsForUser(tx: NotificationsTx, userId: string, eventKeys: readonly string[]): Promise<number> {
  if (eventKeys.length === 0) return 0;
  return tx.$executeRaw`
    UPDATE notifications
    SET dismissed_at = now(), read_at = COALESCE(read_at, now()), updated_at = now()
    WHERE user_id = ${userId}::uuid AND event_key = ANY(${[...eventKeys]}::text[]) AND dismissed_at IS NULL`;
}

/**
 * Dismisses every live row of the given events for EVERY user, inside `tx`
 * (an admin added them to `notifications.disabledEvents`).
 *
 * @param tx - the settings write's transaction client.
 * @param eventKeys - the (non-mandatory) events now suppressed deployment-wide.
 * @returns how many rows were dismissed.
 *
 * @stability experimental
 */
export async function dismissEventsGlobally(tx: NotificationsTx, eventKeys: readonly string[]): Promise<number> {
  if (eventKeys.length === 0) return 0;
  return tx.$executeRaw`
    UPDATE notifications
    SET dismissed_at = now(), read_at = COALESCE(read_at, now()), updated_at = now()
    WHERE event_key = ANY(${[...eventKeys]}::text[]) AND dismissed_at IS NULL`;
}
