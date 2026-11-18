import type {
  NotificationChannel,
  NotificationEventDef,
} from './notification-events';

// =============================================================================
// Admin policy resolution (issue #226, epic #215)
// =============================================================================
//
// #225 added the setting; this file is what reads it. `system_settings.value
// .notifications` is a DEPLOYMENT-WIDE gate an operator sets:
//
//     { browserEnabled: boolean, disabledEvents: string[] }
//
// and it answers a different question from `notification-preferences.ts` next
// door. That file answers "what does THIS USER want?"; this one answers "what
// is this DEPLOYMENT willing to send at all?". Both narrow the same set — the
// event's declared channels — and they are kept in separate files because they
// have different owners, different storage and different failure modes, but
// they meet in exactly one function (`resolveChannels`) so the dispatcher can
// only ever act on one answer.
//
// PURE DATA AND PURE FUNCTIONS, same discipline as its two neighbours: no Nest,
// no Prisma, no I/O. The Nest-side reader is
// `notification-policy.service.ts`, which does nothing but fetch the stored
// value and hand it to these functions.
//
// -----------------------------------------------------------------------------
// WHAT THE TOGGLE MAY AND MAY NOT SWITCH OFF — THE INVARIANT OF THIS ISSUE
// -----------------------------------------------------------------------------
//
// The browser "channel" is TWO things, and #227's `toast` flag exists because
// they are not the same product:
//
//   1. a row in `notifications` — the durable, per-user inbox. THE DELIVERY.
//   2. an OS toast raised by the page — decoration on top of it.
//
// `browser-notification.channel.ts` says this at length in its header, and
// `security.role_changed` is `mandatory: true` precisely so a privilege change
// is never silent. So an admin who mutes browser notifications MUST NOT thereby
// mute an audit-relevant inbox entry: for a MANDATORY event, enforcement
// applies to the toast only, never to the row.
//
// For a NON-MANDATORY event the policy is a real delivery switch: the
// `browser` channel is dropped from its channel list, the dispatcher never
// calls the browser channel, and NO ROW IS WRITTEN — the event does not reach
// the inbox at all. Other channels (`email`, `push`) are not filtered here.
//
// That is why {@link policyChannels} EXEMPTS MANDATORY EVENTS from the channel
// filter, exactly as `isChannelEnabled` already exempts them from the user's
// own preferences. Dropping `browser` from a mandatory event's channel list
// would stop the dispatcher calling the browser channel at all, and the row
// would never be written — which is the one outcome this issue forbids.
//
// The toast is a separate question with a separate function
// ({@link isBrowserToastAllowed}), and it has NO mandatory exemption: a
// mandatory event is guaranteed an inbox row, not an OS notification. So for
// `security.role_changed` with the kill switch off, the row is written, it is
// streamed, and it arrives carrying `toast: false`.
//
// REJECTED — enforcing in the client only. #225's admin page already renders
// the toggle; a client that merely chose not to raise a `Notification` would
// leave the policy unenforced for any other consumer of the stream, and would
// make the operator's control a suggestion. The server computes `toast`, so a
// stale client config cannot re-enable what an admin turned off.
// =============================================================================

/**
 * One channel's switch in {@link NotificationPolicy.channels}.
 *
 * @stability experimental
 */
export interface NotificationChannelPolicy {
  /** Whether the channel delivers at all. `false` drops it from every dispatch. */
  readonly enabled: boolean;
}

/**
 * The deployment-wide browser-notification policy, as this module needs it.
 *
 * STRUCTURALLY COMPATIBLE WITH `SystemNotificationsValue` (see
 * `common/schemas/settings.schema.ts`) but deliberately declared here rather
 * than imported from it: that type is derived from a zod schema in the settings
 * module, and importing it would tie this pure file — and every test of it — to
 * the settings layer for the sake of two fields. The Nest-side reader passes
 * the stored value straight in; the compiler checks the shape at that seam.
 *
 * `disabledEvents` is `readonly` here because nothing in this file may reorder
 * or splice a caller's array.
  *
  * @stability stable
 */
export interface NotificationPolicy {
  /**
   * The kill switch. `false` means no browser TOAST is offered anywhere in this
   * deployment, and non-mandatory events stop being delivered over `browser`
   * altogether (no row is written). Mandatory events keep their row; only
   * their toast is withheld. See the header.
   */
  browserEnabled: boolean;

  /**
   * Event keys whose browser delivery an operator has suppressed individually.
   * Same rule as the kill switch, per event: a non-mandatory event listed here
   * gets no row; a mandatory one keeps its row and loses only the toast.
   *
   * A SUPPRESSION LIST, not an allowlist: absent means "allowed", which is what
   * lets an event added in a later build be delivered without an operator
   * having to opt into it first. Keys that name no registered event are stored
   * and simply never match (#225), which is what keeps a rollback across the
   * addition of an event uneventful.
   */
  disabledEvents: readonly string[];

  /**
   * A switch per channel (PP-14.10): `{ slack: { enabled: false } }` drops the
   * channel from every dispatch in this deployment (or organization). SPARSE:
   * an absent channel is enabled, so a channel an app registers later delivers
   * without anyone saving anything. `browser` is also spelled
   * {@link browserEnabled}; the two are kept in step on write and the stricter
   * one wins on read.
   */
  channels?: Readonly<Record<string, NotificationChannelPolicy>>;
}

/**
 * What applies when no policy could be read.
 *
 * PERMISSIVE, AND THAT DIRECTION IS DELIBERATE. The reader
 * (`notification-policy.service.ts`) never throws; a database blip or a missing
 * `system_settings` row therefore resolves to this. Failing CLOSED would mean a
 * transient fault silences notifications — including the toast for a mandatory
 * security event — with no error visible to anybody, which is the failure mode
 * `mandatory` exists to prevent. Failing open costs at most a toast an operator
 * had asked to suppress, for as long as the fault lasts.
 *
 * Identical to `DEFAULT_SYSTEM_SETTINGS.notifications`, and identical for the
 * same reason stated there: an operator opts OUT of browser notifications,
 * never into them.
  *
  * @stability stable
 */
export const DEFAULT_NOTIFICATION_POLICY: NotificationPolicy = {
  browserEnabled: true,
  disabledEvents: [],
};

/**
 * May this deployment raise an OS toast for `eventKey`?
 *
 * THE `toast` FLAG ON THE STREAM, IN ONE EXPRESSION, and the only place the
 * two halves of the policy are combined. `browser-notification.channel.ts`
 * calls it when publishing, so the value a tab receives is computed
 * server-side from the operator's current setting rather than from whatever
 * config the client last cached.
 *
 * NO `mandatory` EXEMPTION, unlike {@link policyChannels}. `mandatory`
 * guarantees the user is TOLD — which the durable row does, unconditionally —
 * not that their operating system pops a bubble. Exempting mandatory events
 * here would make the kill switch a lie for the one event most likely to be the
 * reason an operator reached for it.
  *
  * @stability stable
 */
export function isBrowserToastAllowed(
  eventKey: string,
  policy: NotificationPolicy = DEFAULT_NOTIFICATION_POLICY,
): boolean {
  return (
    policy.browserEnabled &&
    explicitChannelSwitch(policy, 'browser') !== false &&
    !policy.disabledEvents.includes(eventKey)
  );
}

/**
 * The policy's explicit switch for `channel`, or `undefined` when it names none.
 * An own-property read: a channel id is lower-case letters, digits and `_`, so
 * `constructor` is a valid id and must not resolve off `Object.prototype`.
 */
function explicitChannelSwitch(policy: NotificationPolicy, channel: string): boolean | undefined {
  const channels = policy.channels;
  if (!channels || !Object.prototype.hasOwnProperty.call(channels, channel)) return undefined;
  const entry = channels[channel];
  return typeof entry?.enabled === 'boolean' ? entry.enabled : undefined;
}

/**
 * Whether the deployment's (or organization's) switch for `channel` is on
 * (PP-14.10). The generic half of the policy: `browser` also answers to
 * `browserEnabled`; every other channel answers only to `channels`, and an
 * absent entry is on.
 *
 * @param channel - a channel id.
 * @param policy - the policy in force.
 * @returns `false` only when an operator switched the channel off.
 *
 * @example
 * ```ts
 * isChannelSwitchedOn('slack', { browserEnabled: true, disabledEvents: [], channels: { slack: { enabled: false } } }); // false
 * ```
 *
 * @stability experimental
 */
export function isChannelSwitchedOn(
  channel: NotificationChannel,
  policy: NotificationPolicy = DEFAULT_NOTIFICATION_POLICY,
): boolean {
  if (channel === 'browser' && !policy.browserEnabled) return false;
  return explicitChannelSwitch(policy, channel) !== false;
}

/**
 * An event's declared channels, narrowed by admin policy.
 *
 * -----------------------------------------------------------------------------
 * THE INTERSECTION. IT EXISTS ONCE, AND BOTH CONSUMERS CALL THIS.
 * -----------------------------------------------------------------------------
 *
 * The two consumers are the dispatcher (through `resolveChannels`, which
 * filters this further by the user's preferences) and
 * `GET /api/notifications/events` (which serves it as `channels`). They must
 * not be able to disagree: a matrix that offers a browser toggle the dispatcher
 * will never honour is a control that teaches the user something false, and the
 * reverse — a delivery over a channel the matrix never offered — is worse. One
 * function, called from both, is what makes disagreement impossible rather than
 * merely unlikely.
 *
 * A pleasant consequence: an admin-disabled browser channel simply stops being
 * offered, so #126's preferences matrix loses that column with no UI change at
 * all.
 *
 * MANDATORY EVENTS KEEP THEIR `browser` ROW — see this file's header. Their row
 * IS the delivery, and removing the channel would stop it being written.
 *
 * EVERY CHANNEL HAS A SWITCH (PP-14.10). `browser` answers to `browserEnabled`
 * and `disabledEvents` as always; any other channel (`email`, `push`, an app's
 * `slack`) answers to its `channels[id].enabled` entry, and an absent entry is
 * on. A mandatory event is NOT exempt from another channel's switch: its
 * guarantee is the inbox row, and an operator who turned a transport off has
 * decided nothing goes over it. The org layer tightens the same record.
 *
 * Returns a fresh array; nothing here hands out a reference into the registry.
  *
  * @stability stable
 */
export function policyChannels(
  event: NotificationEventDef,
  policy: NotificationPolicy = DEFAULT_NOTIFICATION_POLICY,
): NotificationChannel[] {
  return event.channels.filter((channel) => {
    // `browser` is the in-app inbox: a mandatory event keeps its row whatever
    // the policy says (the toast is still suppressed, `isBrowserToastAllowed`),
    // and a non-mandatory one is subject to the kill switch and the per-event
    // suppression list.
    if (channel === 'browser') return event.mandatory === true || isBrowserToastAllowed(event.key, policy);
    // Every other channel answers to its own switch (PP-14.10), mandatory or
    // not: an operator who switched Slack off has decided nothing goes over it,
    // and a mandatory event's guarantee is the inbox row, not any one transport.
    return isChannelSwitchedOn(channel, policy);
  });
}
