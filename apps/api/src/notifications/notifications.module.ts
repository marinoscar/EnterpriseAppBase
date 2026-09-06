import { Module } from '@nestjs/common';

import { EmailModule } from '../email/email.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { BrowserNotificationChannel } from './channels/browser-notification.channel';
import { EmailNotificationChannel } from './channels/email-notification.channel';
import { PushNotificationChannel } from './channels/push-notification.channel';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationPolicyService } from './notification-policy.service';
import { NotificationStoreService } from './notification-store.service';
import { NotificationStreamService } from './notification-stream.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushSubscriptionService } from './push-subscription.service';
import {
  NOTIFICATION_CHANNEL_SENDERS,
  type NotificationChannelSender,
} from './notification.types';

// =============================================================================
// NotificationsModule (issues #121/#124/#125, epic #109)
// =============================================================================
//
// #121 shipped the registry as pure data with no module. #124 added the one
// endpoint that serves it. #125 added what the epic was actually for: the
// dispatcher, the channel abstraction, and the delivery records. #127 adds the
// browser channel and everything under it — the durable `notifications` store,
// the SSE transport, and the notification centre's endpoints.
//
// -----------------------------------------------------------------------------
// THE CHANNEL LIST IS A FACTORY, AND THAT IS THE EXTENSION POINT
// -----------------------------------------------------------------------------
//
// `NotificationsService` does not inject `EmailNotificationChannel`. It
// injects an ARRAY under `NOTIFICATION_CHANNEL_SENDERS` and iterates whatever
// is in it. So adding #127's browser channel is:
//
//   1. a class implementing `NotificationChannelSender`
//   2. its name in the `inject` list and its parameter in the factory below
//
// and NOTHING in the dispatcher changes. Had the dispatcher taken each channel
// as a constructor parameter, step 2 would have been an edit to the dispatcher
// — and then to its every test's construction — which is the "adding a channel
// is a rewrite" outcome #125 asks to avoid.
//
// THE FACTORY IS EXPLICIT, NOT DISCOVERED. Nest can enumerate providers by
// metadata (`DiscoveryService`), and that would let a channel register itself
// merely by existing. Rejected: "which transports can this app deliver over?"
// would then have no answer readable in a file, and a channel added by an
// import side effect is a channel that appears in production without appearing
// in a diff. This list is short, it is reviewed, and it is the point.
//
// #125 SHIPPED NO BROWSER STUB, and #127 is the payoff: registering
// `BrowserNotificationChannel` below is the entire wiring change. Nothing in
// `NotificationsService` was touched to add a second transport, which is what
// the array-under-a-token indirection above was for.
//
// -----------------------------------------------------------------------------
// #230's `PushNotificationChannel` IS ALWAYS CONSTRUCTIBLE, BUT ONLY
// SOMETIMES REGISTERED — CONDITIONAL, NOT CONSTANT, MEMBERSHIP IN THE ARRAY
// -----------------------------------------------------------------------------
//
// Every other entry in the factory below is unconditional: if the class
// exists, it is in the array. Push breaks that pattern on purpose. Web Push
// requires a VAPID key pair this deployment may never have generated
// (`PushSubscriptionService.isEnabled()`, reused here rather than
// re-deriving a second predicate for the exact same question), and a
// deployment with no keys has, by construction, no rows in
// `push_subscriptions` either — nobody's browser could have completed a
// subscribe call without them.
//
// Registering the channel anyway in that state would not merely be a no-op:
// `NotificationsService.resolveChannels` would see `push` as an available
// sender for any event that later declares it, resolve it as "enabled" per
// the user's (nonexistent, defaulted) preference, and write a `queued`
// `notification_deliveries` row — which `deliver` would then fail on every
// single attempt, forever, for every user, on a deployment that simply never
// turned Web Push on. That is a permanently red delivery record for a
// feature that was never supposed to be live, which is worse than the
// channel not existing: `notification.types.ts`'s "NO BROWSER STUB SHIPS"
// note describes exactly this failure shape for #125's original single
// channel, and the fix is the same one applied here — an unregistered
// channel is a silent, debug-logged skip in `deliverOne`, with no delivery
// row at all, not a channel that exists only to fail.
//
// So `PushNotificationChannel` is declared as an ordinary provider (Nest DI
// must be able to construct it regardless, the same as any other class in
// this file) but the FACTORY decides, at the moment the array is built,
// whether to include it — by asking the one service that already knows the
// answer.
//
// -----------------------------------------------------------------------------
// WHY `NotificationStreamService` IS A PROVIDER AND NOT EXPORTED (#127)
// -----------------------------------------------------------------------------
//
// It is shared state — a process-wide map of open connections — so it must be
// a singleton, which is what a module provider gives. It is NOT exported,
// because a feature able to call `publish` directly could push an arbitrary
// payload to a user's open tabs while writing no `notifications` row and no
// `notification_deliveries` row: a notification with no durable record, no
// preference check, and no `mandatory` gate. The ONLY caller is
// `BrowserNotificationChannel`, which is reached through the dispatcher, which
// is where the gate lives. Same reasoning as #125's refusal to export
// `NotificationDeliveryService`.
//
// `NotificationStoreService` is likewise internal: it is the controller's
// backing store for the caller's OWN rows, and every method takes a user id it
// filters on. Exporting it would put a "read any user's notifications" API one
// import away from any module that wanted one.
// =============================================================================

@Module({
  imports: [
    // The dispatcher reads `users` (for the recipient address) and
    // `user_settings` (for preferences), and the delivery service writes
    // `notification_deliveries`.
    PrismaModule,
    // Transports and email configuration for the one implemented channel.
    // Imported explicitly because EmailModule is deliberately not @Global —
    // it can reach a plaintext-returning credential service, so every consumer
    // shows up in a diff.
    EmailModule,
    // The deployment-wide browser-notification policy (#226), read through
    // `SystemSettingsService`. The dependency runs one way only —
    // notifications depend on settings, settings depend on nothing here — so
    // there is no cycle to forward-ref around, and reusing that service means
    // the dispatcher degrades a malformed `system_settings` row exactly as the
    // admin API does instead of re-deriving those rules.
    SettingsModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationDeliveryService,
    // NOT EXPORTED, like the store and the stream. It is a read-only view of an
    // admin setting, so exporting it would leak nothing — but a second consumer
    // reading the policy is a second place that could act on it, and #226's
    // whole point is that the policy is interpreted in exactly one file.
    NotificationPolicyService,
    NotificationStoreService,
    NotificationStreamService,
    // NOT EXPORTED, same reasoning as the three above: #229's subscribe/
    // unsubscribe endpoints are the only legitimate way to write or remove a
    // `push_subscriptions` row, and #230's sender reaches these rows through
    // Prisma directly (it reads, it does not subscribe/unsubscribe on anyone's
    // behalf) rather than through this service. `isEnabled()` is ALSO the
    // predicate the factory below asks, below, to decide whether that sender
    // is even registered — one method answers both "may a browser subscribe"
    // and "should the dispatcher ever try to push", because they are the same
    // underlying fact (this deployment has, or has not, generated VAPID keys).
    PushSubscriptionService,
    EmailNotificationChannel,
    BrowserNotificationChannel,
    // Always a provider — see the file header block on why Nest must be able
    // to construct this regardless of configuration — but see the factory
    // immediately below for why it is not unconditionally in the array it
    // feeds.
    PushNotificationChannel,
    {
      provide: NOTIFICATION_CHANNEL_SENDERS,
      useFactory: (
        email: EmailNotificationChannel,
        browser: BrowserNotificationChannel,
        push: PushNotificationChannel,
        pushSubscriptions: PushSubscriptionService,
      ): NotificationChannelSender[] => {
        const senders: NotificationChannelSender[] = [email, browser];

        // The one conditional line in this factory, and the entire effect of
        // #230's feature gate: no VAPID keys (or the operator has otherwise
        // never enabled Web Push) means `push` never enters the array, which
        // means `NotificationsService.resolveChannels` never sees it as
        // available, which means no `notification_deliveries` row with
        // `channel: 'push'` is EVER written on this deployment — not a queued
        // row that immediately fails, nothing. See the block comment above
        // for why that distinction is the whole point.
        if (pushSubscriptions.isEnabled()) {
          senders.push(push);
        }

        return senders;
      },
      inject: [
        EmailNotificationChannel,
        BrowserNotificationChannel,
        PushNotificationChannel,
        PushSubscriptionService,
      ],
    },
  ],
  // ONLY the dispatcher is exported. `NotificationDeliveryService`, the store,
  // the stream and the channels are internals: a feature that wants to notify
  // someone calls `notify`, and must not be able to write a delivery record for
  // a send that did not happen, push to a user's open tabs without a durable
  // row, or reach past the preference gate by invoking a channel directly. That
  // gate is only a gate if there is no way around it.
  exports: [NotificationsService],
})
export class NotificationsModule {}
