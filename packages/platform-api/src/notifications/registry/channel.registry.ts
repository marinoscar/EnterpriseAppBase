// =============================================================================
// Notification channel registry (issue #678, PP-1.6)
// =============================================================================
//
// The set of delivery channels an event may declare. Until #678 this was the
// closed literal `NOTIFICATION_CHANNELS = ['email', 'browser', 'push'] as const`
// in notification-events.ts, so an app that added a transport (EvoPath's
// `android_app`) had to edit a platform file. Now the platform registers its
// three channels from `platform-channels.ts` and an app registers its own from
// its manifest (the reference app: `app-registrations/notifications.ts`).
//
// OPEN SINCE #738. No closed tuple of channel ids is derived any more: the wire
// contract takes any id matching the pattern
// (`@marinoscar/platform-contract/notifications`), and a request that writes a
// NEW preference or names a broadcast channel is checked against this registry
// at run time. A preference stored for a channel that is later unregistered is
// kept (a row outlives the registry that produced it).
//
// A CHANNEL ID IS A PERSISTED IDENTIFIER. It is the outer key of every user's
// stored notification preferences (`user_settings.value.notifications`) and the
// `channel` column of `notification_deliveries`. Never rename one; add a new id.
//
// This file declares WHICH channels exist. It does not deliver anything: the
// transport for a channel is a `NotificationChannelSender`, held by the DI
// registry in `channel-sender.registry.ts`. A channel declared here with no
// sender is the documented "declared before its transport lands" state, which
// the dispatcher skips quietly.
//
// FRAMEWORK-FREE: imports only the registry primitive, so DTOs built at module
// evaluation time, the seed and standalone scripts can read it.
// =============================================================================

import { defineRegistry } from '../../core/index';
import { NOTIFICATION_CHANNEL_ID_PATTERN as WIRE_CHANNEL_ID_PATTERN } from '@marinoscar/platform-contract/notifications';

/**
 * One delivery channel, described for documentation and diagnostics.
 *
 * @stability stable
 */
export interface NotificationChannelDef {
  /**
   * Stable id: lower-case letters, digits and `_`, starting with a letter
   * (`email`, `android_app`). Persisted in preferences and delivery rows.
   */
  readonly id: string;
  /** Short human label (`Email`, `Browser`). */
  readonly label: string;
  /** One sentence on what the channel delivers to. */
  readonly description: string;
  /**
   * Whether a user may toggle this channel in their preferences (#738).
   * Default `true`. A channel an app delivers over but users do not control
   * (an audit sink, say) sets `false`; the preferences matrix omits it and
   * the dispatcher ignores a stored preference for it.
   */
  readonly userConfigurable?: boolean;
  /**
   * The id of a channel that already delivers everything this one does
   * (#746). When one dispatch resolves to both, this channel is dropped, so
   * nobody is reached twice: `android_app` (Web Push to the Android app's
   * subscriptions only) is `coveredBy: 'push'` (Web Push to every
   * subscription). Decided after preferences and narrowing, so a user who
   * muted the covering channel still gets this one.
   */
  readonly coveredBy?: string;
}

/**
 * The channel ids the TYPE SYSTEM knows about, for editor completion.
 *
 * Module augmentation lets an app name its own ids in completions next to its
 * registration:
 *
 * ```ts
 * declare module '@marinoscar/platform-api/notifications' {
 *   interface NotificationChannelIds { android_app: true }
 * }
 * ```
 *
 * Since #738 the type is OPEN ({@link NotificationChannel} accepts any
 * string): the runtime registry is the only authority on which channels
 * exist, and an app's channel needs no augmentation to compile.
 *
 * @stability stable
 */
export interface NotificationChannelIds {
  /** The platform's email channel. */
  email: true;
  /** The in-app inbox and stream. */
  browser: true;
  /** Web Push. */
  push: true;
}

/**
 * A delivery channel id: one of the known ids (for completion), or any other
 * registered id. See {@link NotificationChannelIds}.
 *
 * @stability stable
 */
export type NotificationChannel = (keyof NotificationChannelIds & string) | (string & {});

/**
 * What every channel id must look like (the wire contract's pattern).
 *
 * @stability stable
 */
export const NOTIFICATION_CHANNEL_ID_PATTERN: RegExp = WIRE_CHANNEL_ID_PATTERN;

/**
 * Every delivery channel, in registration order (platform first, then the
 * app's). Filled by the app's manifest before it composes
 * `NotificationsModule.forRoot()`; frozen once the application has
 * bootstrapped.
 *
 * @extensionPoint registry
 * @stability stable
 */
export const notificationChannelRegistry = defineRegistry<NotificationChannelDef>({
  name: 'notification-channels',
  idOf: (channel) => channel.id,
  idPattern: NOTIFICATION_CHANNEL_ID_PATTERN,
  validate: (channel) => {
    if (typeof channel.label !== 'string' || channel.label.trim() === '') {
      throw new Error('a channel needs a non-empty label');
    }
    if (typeof channel.description !== 'string' || channel.description.trim() === '') {
      throw new Error('a channel needs a non-empty description');
    }
    if (channel.userConfigurable !== undefined && typeof channel.userConfigurable !== 'boolean') {
      throw new Error('userConfigurable must be a boolean when present');
    }
    if (channel.coveredBy !== undefined && (typeof channel.coveredBy !== 'string' || channel.coveredBy === channel.id)) {
      throw new Error('coveredBy must name another channel id when present');
    }
    if (channel.id.length > 32) {
      throw new Error('a channel id must be at most 32 characters');
    }
  },
  describeDuplicate: (existing) =>
    `Duplicate notification channel "${existing.id}". Channel ids are persisted ` +
    'in preferences and delivery rows; pick a new id instead of reusing one.',
});

/**
 * Registers delivery channels, all or nothing.
 *
 * @param channels - the channels, in the order they list.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @stability stable
 */
export function registerNotificationChannels(channels: readonly NotificationChannelDef[]): void {
  notificationChannelRegistry.registerAll(channels);
}

/**
 * Registers ONE delivery channel: its id, label and whether users may toggle
 * it. Call it from the app's manifest, before `NotificationsModule.forRoot()`
 * composes; the transport (a `NotificationChannelSender`) registers itself
 * with `NotificationChannelSenderRegistry` from its own module's
 * `onModuleInit`. A channel declared with no sender is skipped quietly, so the
 * id may land before its transport.
 *
 * @param channel - the channel.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```ts
 * registerNotificationChannel({
 *   id: 'example_webhook',
 *   label: 'Webhook',
 *   description: 'A JSON POST to the URL on the account.',
 *   userConfigurable: true,
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability stable
 */
export function registerNotificationChannel(channel: NotificationChannelDef): void {
  notificationChannelRegistry.register(channel);
}

/**
 * Whether `id` is a registered channel, read live.
 *
 * @param id - a channel id from a request or a stored row.
 * @returns `true` when the registry holds it.
 *
 * @stability stable
 */
export function isRegisteredNotificationChannel(id: string): boolean {
  return notificationChannelRegistry.has(id);
}

/**
 * Every registered channel, read live, in registration order.
 *
 * @returns a fresh array of the registry's own entries (do not mutate them).
 *
 * @stability stable
 */
export function listNotificationChannels(): NotificationChannelDef[] {
  return notificationChannelRegistry.list();
}

/**
 * Drops every channel another channel of the same dispatch covers
 * ({@link NotificationChannelDef.coveredBy}, #746): with `push` and
 * `android_app` both resolved, `android_app` goes, `push` reaches each
 * subscription once and the delivery row says `push`, the channel that sent.
 * The dispatcher applies it after preferences and narrowing.
 *
 * @param channels - the resolved channels, in dispatch order.
 * @returns a fresh array, order preserved.
 *
 * @example
 * ```ts
 * collapseOverlappingChannels(['browser', 'push', 'android_app']); // ['browser', 'push']
 * ```
 *
 * @stability experimental
 */
export function collapseOverlappingChannels<C extends string>(channels: readonly C[]): C[] {
  const present = new Set<string>(channels);
  return channels.filter((channel) => {
    const coveredBy = notificationChannelRegistry.get(channel)?.coveredBy;
    return coveredBy === undefined || !present.has(coveredBy);
  });
}
