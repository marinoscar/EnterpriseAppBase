// `@marinoscar/platform-api/notifications/testing`: the notifications slice's
// test seams (issue #738): the conformance suite (importing this entry
// registers it with `runPlatformConformance`), and the slice's INTERNALS, so an
// app's own unit tests can construct a channel, the delivery log or a
// broadcast handler around their own doubles exactly as before the move. Never
// import it from production code: `NotificationsModule` keeps these providers
// internal (a feature that could reach a channel directly would skip the
// preference and `mandatory` gates). Documented in ../README.md.

export {
  checkEmailBindings,
  checkNotifyAfterCommit,
  checkPlatformNotifications,
  checkPushSchemas,
  notificationsConformanceSuite,
} from './conformance';
export type { NotificationsConformanceOptions, NotifyAfterCommitScan } from './conformance';

// ---- internals, for an app's own unit tests ------------------------------------------------
export { NOTIFICATION_CHANNEL_SENDERS } from '../notification.types';
export { NotificationDeliveryService } from '../notification-delivery.service';
export type { QueuedDeliveryInput } from '../notification-delivery.service';
export { NotificationPolicyService } from '../notification-policy.service';
export { NotificationStoreService } from '../notification-store.service';
export { NotificationStreamService } from '../notification-stream.service';
export { NotificationsController } from '../notifications.controller';
export { PushConfigController } from '../push-config.controller';
export { PushSubscriptionService } from '../push-subscription.service';
export {
  PUSH_TEST_EVENT_KEY,
  PushTestService,
  buildHints,
  isValidVapidPublicKey,
  isValidVapidSubject,
  normalizeBase64Url,
  privateKeyDerivesPublicKey,
} from '../push-test.service';
export { BrowserNotificationChannel } from '../channels/browser-notification.channel';
export { EmailNotificationChannel } from '../channels/email-notification.channel';
export { PushNotificationChannel } from '../channels/push-notification.channel';
export { JobFailureNotifier } from '../ops/job-failure-notifier';
export { NodeOfflineNotifier } from '../ops/node-offline-notifier';
export { PushVapidDoctorCheck, decidePushVapid } from '../doctor/push-vapid.doctor-check';
export {
  KNOWN_PUSH_SERVICE_HOSTS,
  PUSH_ENDPOINT_SCAN_LIMIT,
  WebPushEgressContributor,
} from '../doctor/egress/web-push.egress.contributor';
export { describeThrown } from '../describe-thrown';
export { BroadcastsController } from '../broadcasts/broadcasts.controller';
export { BroadcastsService } from '../broadcasts/broadcasts.service';
export type {
  BroadcastCreateResult,
  BroadcastDeliveryCount,
  BroadcastDetail,
  BroadcastListResult,
} from '../broadcasts/broadcasts.service';
export { BroadcastFailureListener } from '../broadcasts/broadcast-failure.listener';
export { broadcastJobDeleteRefusal } from '../broadcasts/broadcast-job-delete-guard';
export { BroadcastStartHandler, broadcastFirstChunkDedupKey } from '../broadcasts/handlers/broadcast-start.handler';
export { BROADCAST_EMAIL_PROVIDER_KEY, BroadcastChunkHandler } from '../broadcasts/handlers/broadcast-chunk.handler';
export { createBroadcastSchema, CreateBroadcastDto, TestBroadcastDto } from '../broadcasts/dto/create-broadcast.dto';
export { NotificationListQueryDto } from '../dto/notification.dto';
