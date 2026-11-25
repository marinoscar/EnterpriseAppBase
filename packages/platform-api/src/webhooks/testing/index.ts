// `@marinoscar/platform-api/webhooks/testing`: the webhooks slice's test kit and
// conformance suite (issue #1046). Importing this entry registers the
// `webhooks` suite with `runPlatformConformance` (@marinoscar/platform-api/testing).
// Never import it from production code. Documented in ../README.md.

export { discoverWebhookRoutes, registerWebhooksConformance, webhooksConformanceSuite } from './conformance';
export type { WebhookControllerRoute, WebhookRoute, WebhooksConformanceOptions } from './conformance';
export {
  FakeWebhookReceiver,
  InMemoryWebhookSecrets,
  InMemoryWebhooksRepository,
  RecordingJobs,
  ScriptedHostResolver,
  makeWebhookOwner,
} from './in-memory';
export type { EnqueuedDeliveryJob, FakeReceiverAnswer, FakeReceiverFailure, FakeReceiverResponse, RecordedJob, RecordedNotification } from './in-memory';
export { KIT_ORG_ID, KIT_OTHER_ORG_ID, KIT_USER_A, KIT_USER_B, createWebhooksTestKit } from './kit';
export type { SeedEndpointInput, SeedEndpointResult, WebhooksTestKit } from './kit';
