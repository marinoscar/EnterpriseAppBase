import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';

import { PLATFORM_PRISMA } from '../../core/index';
import type { NotificationsPrisma } from '../data/notifications-db';
import type { NotificationChannel } from '../notification-events';
import { PushConfigService } from '../push-config.service';
import { NotificationChannelSenderRegistry } from '../registry/channel-sender.registry';
import { ANDROID_APP_NOTIFICATION_CHANNEL } from '../registry/platform-channels';
import { NOTIFICATION_PUSH_PAYLOAD } from '../ports';
import { PushNotificationChannel } from './push-notification.channel';
import type { PushPayloadHook } from './push-payload';

// =============================================================================
// AndroidAppNotificationChannel (#746, PP-9.4; harvested from EvoPath #312)
// =============================================================================
//
// The `push` sender restricted to the subscriptions registered from inside the
// Android companion (`push_subscriptions.platform = 'android_app'`). Same
// render, same inbox row, same pruning: only the subscription scope and the
// "nothing to push to" error differ, through the push channel's two
// protected hooks.
//
// NOT A PLATFORM SENDER. It registers itself with
// `NotificationChannelSenderRegistry` from `onModuleInit`, like any app
// channel, because the `android_app` channel id exists only when the app's
// manifest called `registerAndroidAppNotificationChannel()`. The provider is
// `AndroidAppModule` (`@marinoscar/platform-api/android-app`); an app without
// the Android companion never declares the id and never builds this class.
//
// `push` covers it (`coveredBy: 'push'`): a dispatch resolving both keeps only
// `push`, so no subscription is pushed twice (`collapseOverlappingChannels`).
// =============================================================================

/**
 * The `android_app` channel's transport: Web Push to Android app
 * subscriptions only. Provided and self-registered by `AndroidAppModule`;
 * exported for that sibling slice and for an app's unit tests, not an
 * extension point.
 *
 * @internal
 */
@Injectable()
export class AndroidAppNotificationChannel extends PushNotificationChannel implements OnModuleInit {
  /** The channel id, `android_app`. */
  override readonly channel: NotificationChannel = ANDROID_APP_NOTIFICATION_CHANNEL.id;

  constructor(
    @Inject(PLATFORM_PRISMA) prisma: NotificationsPrisma,
    pushConfig: PushConfigService,
    // At the parent's index for the same dependency, on purpose: Nest merges
    // `@Optional()` indexes down an inheritance chain, so the optional hook
    // must sit where the parent marked it optional and nowhere else.
    @Optional() @Inject(NOTIFICATION_PUSH_PAYLOAD) pushPayload: PushPayloadHook | null | undefined,
    private readonly senders: NotificationChannelSenderRegistry,
  ) {
    super(prisma, pushConfig, pushPayload);
  }

  /** Registers this sender for `android_app`; the channel id must be registered first. */
  onModuleInit(): void {
    this.senders.register(this);
  }

  /**
   * Only the Android app's subscriptions.
   *
   * @returns `{ platform: 'android_app' }`.
   */
  protected override subscriptionScope(): Record<string, unknown> {
    return { platform: 'android_app' };
  }

  /**
   * The error recorded when the user never enabled notifications in the app.
   *
   * @returns the delivery error text.
   */
  protected override noSubscriptionsError(): string {
    return 'No Android app push subscriptions for this user';
  }
}
