import { Module, type DynamicModule } from '@nestjs/common';

import { CredentialsModule } from '../credentials/index';
import { BrowserNotificationChannel } from './channels/browser-notification.channel';
import { EmailNotificationChannel } from './channels/email-notification.channel';
import { PushNotificationChannel } from './channels/push-notification.channel';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationPolicyService } from './notification-policy.service';
import { NotificationStoreService } from './notification-store.service';
import { NotificationStreamService } from './notification-stream.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { JobFailureNotifier } from './ops/job-failure-notifier';
import { NodeOfflineNotifier } from './ops/node-offline-notifier';
import { PushConfigController } from './push-config.controller';
import { NotificationDeliveriesPurgeHandler } from './retention/notification-deliveries-purge.handler';
import { NotificationInboxPurgeHandler } from './retention/notification-inbox-purge.handler';
import { PushConfigService } from './push-config.service';
import { PushSubscriptionService } from './push-subscription.service';
import { PushTestService } from './push-test.service';
import {
  NOTIFICATION_CHANNEL_SENDERS,
  type NotificationChannelSender,
} from './notification.types';
import { PushVapidDoctorCheck } from './doctor/push-vapid.doctor-check';
import { WebPushEgressContributor } from './doctor/egress/web-push.egress.contributor';
import { NotificationChannelSenderRegistry } from './registry/channel-sender.registry';
import { NOTIFICATIONS_OPTIONS, resolveNotificationsModuleOptions, type NotificationsModuleOptions } from './notifications.options';

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
// APP CHANNELS SELF-REGISTER (#678), STILL EXPLICITLY. The factory below
// remains the reviewed list of PLATFORM transports. An app's own transport
// (EvoPath's `android_app`) must not be an edit to this file, so
// `NotificationChannelSenderRegistry` is provided and EXPORTED here: the app
// declares the channel id in `app-registrations/notifications.ts`, provides its
// sender in its own module, injects the registry and calls
// `this.registry.register(this)` from `onModuleInit` (the doctor-check
// pattern). That is an explicit call in the app's own diff, never discovery;
// the argument above still holds. A second sender for an existing channel
// fails at bootstrap. See notifications/README.md, "Adding a channel".
//
// #125 SHIPPED NO BROWSER STUB, and #127 is the payoff: registering
// `BrowserNotificationChannel` below is the entire wiring change. Nothing in
// `NotificationsService` was touched to add a second transport, which is what
// the array-under-a-token indirection above was for.
//
// -----------------------------------------------------------------------------
// `PushNotificationChannel` IS NOW ALWAYS REGISTERED, LIKE EVERY OTHER
// CHANNEL — SEE #355 FOR WHY THAT CHANGED
// -----------------------------------------------------------------------------
//
// Until #355, this factory registered `PushNotificationChannel` only when
// `PushSubscriptionService.isEnabled()` was true AT BOOT, because Web Push
// required a VAPID key pair set as an env var this deployment might never
// have generated — and registering the channel anyway would make
// `NotificationsService.resolveChannels` see `push` as an available sender
// for any event that declares it, write a `queued` `notification_deliveries`
// row, and then fail that row on every single attempt, forever, for every
// user, on a deployment that simply never turned Web Push on. A permanently
// red delivery record for a feature that was never supposed to be live.
//
// #355 REMOVES THE PREMISE THAT MADE THAT THE RIGHT CALL: Web Push
// configuration is now admin-UI-configurable at runtime, through
// `PushConfigController`/`PushConfigService` above, with generate/rotate/
// enable/disable/remove — a real, in-app remedy for "this channel is
// unconfigured" that did not exist when the conditional above was written.
// So `push` now follows the SAME pattern `email`/`browser` already do:
// unconditional registration, with `PushNotificationChannel`'s existing
// defensive guard (empty keys -> `{ success: false, error }`, now backed by
// `PushConfigService.resolveActiveVapidConfig()` instead of a raw
// `ConfigService.get`) as the real, always-live gate. This matches
// `EmailModule`'s own documented precedent (see `email.module.ts:31-39`):
// an unconfigured channel produces an honest, admin-actionable FAILED
// delivery row — something an operator can see and fix from the Push
// Configuration settings page — rather than the channel not existing at all.
//
// `PushSubscriptionService.isEnabled()` is STILL the gate for whether a
// browser may SUBSCRIBE (`POST /notifications/push/subscriptions` still 409s
// on a deployment with no active VAPID config) — that question did not
// change, only whether an unconfigured deployment's failed push deliveries
// are visible or silently absent.
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

// -----------------------------------------------------------------------------
// THE PACKAGE (#738)
// -----------------------------------------------------------------------------
//
// `NotificationsModule.forRoot({ imports })` is this module as
// `@marinoscar/platform-api/notifications` ships it: GLOBAL (one dispatcher per
// application; every feature module may inject `NotificationsService` without
// importing the module, and an explicit `imports: [NotificationsModule]` keeps
// working because the app binds one dynamic-module object). `imports` carries
// the app's email module (`EmailModule.forRoot(...)`, deliberately not global)
// and the module binding the host ports (`NOTIFICATIONS_METRICS`,
// `NOTIFICATIONS_EVENT_BUS`). The database is the core `PLATFORM_PRISMA` port;
// the jobs, settings and doctor modules are global. The retention purges of
// the inbox and delivery log (#681) are the app's retention module's.
// =============================================================================

const PROVIDERS = [
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
    // `push_subscriptions` row, and the push channel reaches these rows through
    // Prisma directly (it reads, it does not subscribe/unsubscribe on anyone's
    // behalf) rather than through this service. `isEnabled()`/
    // `getVapidPublicKey()` now delegate to `PushConfigService
    // .resolveActiveVapidConfig()` (#355) — see that file for the full
    // env/DB precedence — rather than reading `ConfigService` directly.
    PushSubscriptionService,
    // The runtime-configurable Web Push admin surface (#355): generate,
    // rotate, enable/disable, and remove a VAPID key pair with no restart.
    // Both `PushSubscriptionService` and `PushNotificationChannel` inject it
    // for `resolveActiveVapidConfig()` — the one place the env/DB precedence
    // is implemented (see that method's own header) — and it is EXPORTED, in
    // case a future feature outside this module (an ops dashboard, a health
    // check) needs to read the same "is push actually active" answer.
    PushConfigService,
    // `POST /api/admin/push-config/test` (#618): a diagnostic send to the
    // calling admin's own subscriptions. NOT EXPORTED — it is the backing of
    // one admin route, and it deliberately bypasses `notify()` (a test is not
    // a notification; see its header), so no other feature should reach it.
    PushTestService,
    EmailNotificationChannel,
    BrowserNotificationChannel,
    // #288's queue listener (epic #254). A PROVIDER AND NOT AN EXPORT, and it
    // lives on THIS side of the seam deliberately: it subscribes to
    // `job.settled` through the global `EventEmitter2` rather than being called
    // by `JobsModule`, so the queue keeps no dependency on notifications and
    // this module keeps none on the queue. See the file's own header for why a
    // listener rather than a `notify()` inside `JobTerminalService`.
    JobFailureNotifier,
    NodeOfflineNotifier,
    // The two retention purges for this slice's tables (#681, moved here by
    // #898). They self-register with the jobs slice's handler registry and
    // declare their `retention.*` policy with its `RetentionPurgeRegistry`;
    // the jobs slice's 01:00 cron enqueues them. Providers, not exports.
    NotificationInboxPurgeHandler,
    NotificationDeliveriesPurgeHandler,
    PushNotificationChannel,
    // Doctor check (#634): validates the active VAPID pair, never sends.
    PushVapidDoctorCheck,
    // Egress inventory (#773): the push services subscribers registered with.
    WebPushEgressContributor,
    // #678: every channel's sender, platform (from the factory below) and app
    // (self-registered). Exported so an app's module can register into it.
    NotificationChannelSenderRegistry,
    {
      provide: NOTIFICATION_CHANNEL_SENDERS,
      useFactory: (
        email: EmailNotificationChannel,
        browser: BrowserNotificationChannel,
        push: PushNotificationChannel,
      ): NotificationChannelSender[] => [email, browser, push],
      inject: [
        EmailNotificationChannel,
        BrowserNotificationChannel,
        PushNotificationChannel,
      ],
    },
];

  // `NotificationsService` and `PushConfigService` are exported.
  // `NotificationDeliveryService`, the store, the stream and the channels stay
  // internal: a feature that wants to notify someone calls `notify`, and must
  // not be able to write a delivery record for a send that did not happen,
  // push to a user's open tabs without a durable row, or reach past the
  // preference gate by invoking a channel directly. That gate is only a gate
  // if there is no way around it. `PushConfigService` is different in kind —
  // it is the admin configuration surface itself, not a delivery internal — so
  // it is exported like `NotificationsService`.
  //
  // `NotificationChannelSenderRegistry` (#678) is exported for one purpose: an
  // app's own sender registers itself into it. It never hands out a platform
  // sender (its `get` answers only for app-registered channels), so exporting
  // it opens no way around the dispatcher's gate.
const EXPORTED = [NotificationsService, PushConfigService, PushTestService, NotificationChannelSenderRegistry];

/**
 * The notifications slice: the dispatcher (`NotificationsService`), the three
 * platform channels (email, the in-app inbox and its SSE stream, Web Push),
 * `/api/notifications`, the runtime Web Push configuration
 * (`/api/admin/push-config`), the VAPID doctor check, and the `job.settled`
 * and `nodes.node.offline` notifiers. Admin broadcasts are the sibling
 * {@link BroadcastsModule}.
 *
 * @stability experimental
 */
@Module({})
export class NotificationsModule {
  /**
   * The slice, configured for one app: a GLOBAL module providing the
   * dispatcher, the channels, the stream, the push configuration and their
   * controllers. Requires the core `PlatformHostModule` (`PLATFORM_PRISMA`),
   * the global jobs, settings and doctor modules, and `EventEmitterModule`;
   * the app's email module and host-port module arrive through `imports`. The
   * registries (channels, events, templates) are filled by the app's manifest
   * BEFORE this composes.
   *
   * @param options - see {@link NotificationsModuleOptions}.
   * @returns the dynamic module (global). It exports `NotificationsService`,
   *   `PushConfigService`, `NotificationChannelSenderRegistry` and
   *   `NOTIFICATIONS_OPTIONS`.
   * @throws Error when an option is invalid.
   *
   * @example
   * ```ts
   * export const NotificationsModule = PlatformNotificationsModule.forRoot({
   *   imports: [EmailModule, NotificationsHostModule],
   * });
   * ```
   *
   * @extensionPoint option
   * @stability experimental
   */
  static forRoot(options: NotificationsModuleOptions = {}): DynamicModule {
    const resolved = resolveNotificationsModuleOptions(options);
    return {
      module: NotificationsModule,
      global: true,
      imports: [
        // The VAPID private key's only home (#355). Imported explicitly:
        // `CredentialsModule` is deliberately not global because it can reach a
        // plaintext-returning service, so every consumer shows up in a diff.
        CredentialsModule,
        ...resolved.imports,
      ],
      controllers: [NotificationsController, PushConfigController],
      providers: [{ provide: NOTIFICATIONS_OPTIONS, useValue: resolved }, ...PROVIDERS],
      exports: [NOTIFICATIONS_OPTIONS, ...EXPORTED],
    };
  }
}
