// =============================================================================
// NotificationChannelSenderRegistry (issue #678, PP-1.6)
// =============================================================================
//
// The TRANSPORTS, as an instance (DI-held) registry. A channel id is static data
// (`notificationChannelRegistry`); the thing that delivers over it is a Nest
// provider with injected dependencies, so it cannot be registered at import
// time. This registry holds them.
//
// TWO WAYS IN, BOTH EXPLICIT:
//
//   1. The platform's three senders (email, browser, push) arrive through the
//      `NOTIFICATION_CHANNEL_SENDERS` factory in `notifications.module.ts`, and
//      this constructor registers them. That factory stays the reviewed list of
//      platform transports.
//   2. An app's own sender is a provider in the app's own module, which imports
//      `NotificationsModule` (this registry is exported), injects the registry
//      and calls `this.registry.register(this)` from its `onModuleInit` — the
//      doctor-check pattern. Never discovered: a channel that appears by an
//      import side effect is a channel that appears in production without
//      appearing in a diff.
//
// A second sender for a channel throws `DUPLICATE_ID` with the dispatcher's
// historical wording ("Duplicate notification channel sender registered for
// 'email'."), so an app that shadows a platform transport fails at bootstrap.
// A sender for a channel no registry entry declares throws `INVALID_ENTRY`.
// The registry freezes in `onApplicationBootstrap`, after every
// `onModuleInit` has run.
//
// IT NEVER HANDS OUT A PLATFORM SENDER. `NotificationsModule` keeps its channel
// classes internal so no feature can call one directly and skip the
// preference and `mandatory` gates in the dispatcher. This registry is exported
// (apps must reach `register`), so `get` returns only senders registered
// through `register` — an app's own code, which it could reach anyway — and
// `channels` returns ids only. The dispatcher holds the platform senders itself.
//
// Not exported from `./index.ts`: that barrel must stay importable without Nest.
// =============================================================================

import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';

import { Registry } from '@marinoscar/platform-api/core';
import { NOTIFICATION_CHANNEL_SENDERS, type NotificationChannelSender } from '../notification.types';
// From the barrel, so the manifest has filled the channel registry first.
import { notificationChannelRegistry } from '.';

@Injectable()
export class NotificationChannelSenderRegistry implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationChannelSenderRegistry.name);

  private readonly senders = new Registry<NotificationChannelSender>({
    name: 'notification-channel-senders',
    idOf: (sender) => sender.channel,
    validate: (sender) => {
      if (!notificationChannelRegistry.has(sender.channel)) {
        throw new Error(
          `channel "${sender.channel}" is not a registered notification channel; declare it in ` +
            'app-registrations/notifications.ts (APP_NOTIFICATION_CHANNELS) first',
        );
      }
    },
    describeDuplicate: (_existing, incoming) =>
      `Duplicate notification channel sender registered for '${incoming.channel}'.`,
  });

  /** Channels whose sender came from `register` (an app's), not the factory. */
  private readonly appChannels = new Set<string>();

  /**
   * @param platformSenders the platform's senders, from the module factory.
   * @throws RegistryError when two of them claim one channel.
   */
  constructor(@Inject(NOTIFICATION_CHANNEL_SENDERS) platformSenders: NotificationChannelSender[]) {
    this.senders.registerAll(platformSenders);
  }

  /**
   * Adds an app's sender. Call it from the sender's own `onModuleInit`.
   *
   * @throws RegistryError `DUPLICATE_ID` when the channel already has a
   *   sender, `INVALID_ENTRY` when the channel is not registered, `FROZEN`
   *   after the application has bootstrapped.
   */
  register(sender: NotificationChannelSender): void {
    this.senders.register(sender);
    this.appChannels.add(sender.channel);
  }

  /**
   * The APP sender for `channel`, or `undefined` when the channel has none or
   * its sender is a platform one (the dispatcher holds those itself; see the
   * header for why they are never handed out).
   */
  get(channel: string): NotificationChannelSender | undefined {
    return this.appChannels.has(channel) ? this.senders.get(channel) : undefined;
  }

  /** Every channel that has a sender, platform first, in registration order. */
  channels(): string[] {
    return this.senders.ids();
  }

  /** Refuses further registrations once every module's `onModuleInit` has run. */
  onApplicationBootstrap(): void {
    this.senders.freeze();
    this.logger.debug(`Notification channel senders: ${this.senders.ids().join(', ') || '(none)'}`);
  }
}
