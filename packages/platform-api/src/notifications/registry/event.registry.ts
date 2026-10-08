// =============================================================================
// Notification event registry (issue #678, PP-1.6; the definition dates from #121)
// =============================================================================
//
// Every event this application can raise, in declaration order. Until #678
// this was the closed array `NOTIFICATION_EVENTS` in notification-events.ts;
// now each platform module declares its own events next to the code that
// raises them (`auth/auth.notifications.ts`, `users/users.notifications.ts`,
// ...), the app declares its own in `app-registrations/notifications.ts`, and
// `notification.manifest.ts` registers them all, platform first. The old
// exports in notification-events.ts are views over this registry.
//
// ORDER IS MEANINGFUL. `GET /api/notifications/events` lists events in
// registration order and the preferences matrix renders them in that order, so
// the manifest registers the platform events in exactly the order the old array
// held them, and app events after them.
//
// THE INVARIANTS `notification-events.spec.ts` USED TO CHECK AFTER THE FACT ARE
// NOW CHECKED ON REGISTRATION: a malformed key, an empty label or description,
// an empty or repeated channel list, an unregistered channel, and `mandatory`
// without `defaultEnabled` all fail at import time with a `RegistryError` that
// names the key. A duplicate key fails with `DUPLICATE_ID`.
//
// FRAMEWORK-FREE: imports only the registry primitive and the channel registry.
// =============================================================================

import { defineRegistry } from '../../core/index';
import { notificationChannelRegistry, type NotificationChannel } from './channel.registry';

/**
 * The longest event key the registry accepts.
 *
 * The same bound `NOTIFICATION_MAX_EVENT_KEY_LENGTH` applies to the event keys a
 * user may store in preferences (`common/schemas/user-settings-namespaces.schema.ts`).
 * Restated rather than imported because that schema imports this folder;
 * `registry.spec.ts` asserts the two agree.
  *
  * @stability stable
 */
export const NOTIFICATION_EVENT_KEY_MAX_LENGTH = 64;

/**
 * What every event key must look like: `<area>.<event>`, lower snake case.
 *
 * @stability stable
 */
export const NOTIFICATION_EVENT_KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;


/**
 * One notification event, fully described for every surface that dispatches,
 * renders, or documents it.
  *
  * @stability stable
 */
export interface NotificationEventDef {
  /**
   * Stable key, persisted in user preferences and in delivery records.
   *
   * RENAMING ONE IS A MIGRATION, not a refactor: a stored preference keyed by
   * the old string becomes unreachable, and — under the epic's sparse
   * absent-key contract, where absent means enabled — a user who deliberately
   * muted an event would silently start receiving it again under its new name.
   * Add a new key and migrate the rows; never edit a key in place.
   */
  key: string;

  /** Short human label, shown as the row heading on the preferences page. */
  label: string;

  /**
   * One sentence on what actually triggers this, in the user's terms. This is
   * the only place the answer to "why did I get this?" is written down.
   */
  description: string;

  /**
   * Channels this event CAN be delivered over — a capability of the event,
   * not a statement about which transports are implemented yet.
   *
   * Deliberately per-event and meaningful: `allowlist.invitation` lists email
   * only because its recipient has no account and no open tab by definition,
   * so a browser notification is not merely unimplemented, it is impossible.
   * The dispatcher intersects this with the user's preferences and with the
   * transports actually registered, so declaring a channel before its
   * implementation lands is safe — it simply has nowhere to go until then.
   *
   * ---------------------------------------------------------------------------
   * WHAT `channels` MEANS ON THE WIRE IS NOW CAPABILITY ∩ POLICY (#226)
   * ---------------------------------------------------------------------------
   *
   * The array declared BELOW is still pure capability, and this is still the
   * only place it is stated. But `GET /api/notifications/events` no longer
   * serves it verbatim: since #226 both that endpoint and the dispatcher run it
   * through `policyChannels` (notification-policy.ts), which drops `browser`
   * when an operator has switched browser notifications off deployment-wide or
   * suppressed this event specifically in system settings.
   *
   * So an event that declares `browser` here and shows no `browser` over the
   * API is CONFIGURATION, not a bug in this registry — check
   * `system_settings.value.notifications` before concluding otherwise. The one
   * exception is a `mandatory` event, whose channels survive the policy filter
   * because its `notifications` row is the delivery and muting a toast must not
   * mute an audit-relevant inbox entry; for those the policy shows up as
   * `toast: false` on the stream instead. notification-policy.ts carries the
   * full argument.
   *
   * Must be non-empty: an event with no channels can never be delivered, which
   * is a declaration bug rather than a configuration.
   */
  channels: NotificationChannel[];

  /**
   * Default when a user has expressed no preference.
   *
   * Reads together with the epic's sparse absent-key contract: no preference
   * row is materialised until a user deliberately changes something, so this
   * is what an untouched account gets.
   */
  defaultEnabled: boolean;

  /**
   * The user may NOT opt out — on ANY channel this event declares.
   *
   * For security-relevant events where silence is itself the risk: a role
   * change, a new sign-in from an unknown device. #125 enforces this
   * SERVER-SIDE, in preference resolution, and not only in the preferences UI
   * — otherwise a crafted PATCH silences the exact alert the UI refuses to
   * hide, which is the whole attack this flag exists to close.
   *
   * ALL-OR-NOTHING, BY DESIGN: mandatory is not "at least one channel must
   * stay on". Per-channel opt-out on a mandatory event reopens the hole it
   * closes — a user who drops email and keeps browser is unreachable the
   * moment no tab is open, and the alert is lost exactly when it matters. So
   * the resolver ignores stored preferences for a mandatory event entirely and
   * every declared channel stays enabled. The UI (#126) renders the controls
   * as disabled WITH the reason rather than hiding them, per epic #109's
   * success criterion 5 — a dead toggle teaches nothing.
   *
   * Absent is the normal case and means "the user is in charge".
   *
   * Invariant: a mandatory event must also be `defaultEnabled: true`.
   * `mandatory` with `defaultEnabled: false` is self-contradictory — it
   * asserts the user cannot turn off something that is off.
   */
  mandatory?: boolean;
}

/**
 * Rejects an event that could never be delivered or that contradicts itself.
 * Exported so `registerNotification` can check an event before it registers
 * anything (it is atomic across the event and its template bindings).
 *
 * @throws Error naming the problem; the registry wraps it as `INVALID_ENTRY`.
  *
  * @stability stable
 */
export function assertValidNotificationEvent(event: NotificationEventDef): void {
  if (event.key.length > NOTIFICATION_EVENT_KEY_MAX_LENGTH) {
    throw new Error(`an event key must be at most ${NOTIFICATION_EVENT_KEY_MAX_LENGTH} characters`);
  }
  if (typeof event.label !== 'string' || event.label.trim() === '') {
    throw new Error('an event needs a non-empty label');
  }
  if (typeof event.description !== 'string' || event.description.trim() === '') {
    throw new Error('an event needs a non-empty description');
  }
  if (!Array.isArray(event.channels) || event.channels.length === 0) {
    throw new Error('an event must declare at least one channel; one with none can never be delivered');
  }
  if (new Set(event.channels).size !== event.channels.length) {
    throw new Error(`an event must not repeat a channel (${event.channels.join(', ')})`);
  }
  for (const channel of event.channels) {
    if (!notificationChannelRegistry.has(channel)) {
      throw new Error(
        `channel "${channel}" is not a registered notification channel ` +
          `(known: ${notificationChannelRegistry.ids().join(', ') || 'none'})`,
      );
    }
  }
  if (typeof event.defaultEnabled !== 'boolean') {
    throw new Error('defaultEnabled must be a boolean');
  }
  if (event.mandatory === true && event.defaultEnabled !== true) {
    throw new Error('a mandatory event must also be defaultEnabled: true');
  }
}

/**
 * Every notification event, in registration order. Filled by
 * `notification.manifest.ts`; frozen once the application has bootstrapped.
  *
  * @stability stable
 */
export const notificationEventRegistry = defineRegistry<NotificationEventDef>({
  name: 'notification-events',
  idOf: (event) => event.key,
  idPattern: NOTIFICATION_EVENT_KEY_PATTERN,
  validate: (event) => assertValidNotificationEvent(event),
  describeDuplicate: (existing) =>
    `Duplicate notification event "${existing.key}". An event key is persisted in ` +
    'preferences and delivery rows: never rename or reuse one, add a new key.',
});

/**
 * Registers ONE event with no template binding: the event's `label` and
 * `description` render its bell row and push toast, and an event that
 * declares `email` needs {@link registerEmailNotificationTemplate} (or the
 * combined `registerNotification`) before it can be emailed. Call it from the
 * app's manifest, before `NotificationsModule.forRoot()` composes.
 *
 * @param event - the event.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```ts
 * registerNotificationEvent({
 *   key: 'billing.invoice_ready',
 *   label: 'Invoice ready',
 *   description: 'Sent when a new invoice is available to download.',
 *   channels: ['browser'],
 *   defaultEnabled: true,
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability stable
 */
export function registerNotificationEvent(event: NotificationEventDef): void {
  notificationEventRegistry.register(event);
}
