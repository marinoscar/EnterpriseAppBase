# @marinoscar/platform-api/webhooks

Outbound, signed webhooks (issue #1046, epic #1044): a member, an organization or the deployment registers an HTTPS endpoint, subscribes it to events from an open catalog, and the platform POSTs each event to it as a signed JSON envelope through the job queue, with retries, a circuit breaker and an SSRF-safe egress guard. It depends on the `core`, `otel-core`, `identity`, `credentials`, `email`, `jobs`, `nodes`, `notifications` and `testing` slices (`packages/platform-slices.json`); its wire shapes are `@marinoscar/platform-contract/webhooks` (including the `verifyWebhookSignature` helper a receiver uses) and its pages `@marinoscar/platform-web/webhooks`.

## Purpose and scope

- **Endpoints, three tiers.** `scope: 'user'` (a member's own, inside the active organization), `'org'` (the organization's, managed by `org_admin`) and `'system'` (the deployment's, no organization, managed by an `admin`). Routes: `/api/webhooks`, `/api/org/webhooks`, `/api/admin/webhooks`, the same eleven each: list, create, get, change, delete, `rotate-secret`, `test`, an endpoint's `deliveries`, one delivery, `redeliver`, and the `events` catalog.
- **An open event catalog.** `registerWebhookEvent({ key, label, description, group, audience, permission?, payloadSchema, example?, source })`. The platform registers `webhooks.ping` (the Test button, never subscribable), `nodes.node.offline`, `nodes.node.event` and `jobs.job.failed` (all system); the alerts slice registers its own. Every notification event that declares the `webhook` channel is also subscribable by a member as `notification.<eventKey>`. A subscription is an exact key, a group wildcard (`nodes.*`) or `*`.
- **Emitting.** `WebhooksService.emit(eventKey, data, { orgId, userId? })` validates `data`, finds the matching endpoints, re-checks each endpoint's OWNER'S permission now (an owner who lost it has the endpoint switched off, `owner_lost_access`), and inserts one delivery row plus one `webhooks.deliver` job per endpoint in one transaction. It is idempotent per `(endpoint, eventId)` and never throws for an unknown event or invalid data. Call it after the triggering write commits, outside any `$transaction`.
- **Domain-event bridges.** `nodes.node.offline`, `nodes.node.event` and `job.settled` (a job that failed for good, never a `webhooks.*` job) become webhook events through listeners that only enqueue a `webhooks.fanout` job.
- **Delivery.** `webhooks.deliver` is the only place the slice makes an HTTP request: Standard Webhooks headers, an HMAC-SHA256 signature (two signatures during a rotation overlap), a 10 s deadline, no redirects, 1 KiB of the answer kept, a retry schedule of 30 s, 2 m, 10 m, 30 m, 1 h, 2 h, 4 h, 6 h, 6 h (jittered, `Retry-After` honoured up to 24 h), ten attempts, a circuit breaker (20 consecutive failures switch the endpoint off and tell its owner) and `410 Gone` switching it off at once.
- **Egress guard.** https only (http with `allowInsecureHttp`), no userinfo, ports 80, 443, 8443 and from 1024; every address a name resolves to must be a public unicast address, checked at create and again at every send, and the connection is pinned to the checked address.
- **A notification channel.** `webhook` ("Webhooks"): a member's notifications are forwarded to their own endpoints that subscribe to `notification.<eventKey>`, rendered the way the bell renders them (never the raw template data). And the event `webhooks.endpoint_disabled` (email and bell) to an endpoint's owner.
- **Retention.** `webhooks.deliveries_purge`, queued daily by a cron that only enqueues, deletes deliveries older than `deliveryRetentionDays`.

Not here: the pages (`@marinoscar/platform-web/webhooks`), incoming webhooks (receiving), per-endpoint rate limits and payload transforms.

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { WebhooksModule, registerWebhookEvent, type WebhookEventDef } from '@marinoscar/platform-api/webhooks';
import '@marinoscar/platform-api/webhooks/testing'; // tests only: registers the conformance suite
```

The peers are the package's own (`@nestjs/*`, `nestjs-zod`, `zod`, `@opentelemetry/api`). A receiver verifies a delivery with `verifyWebhookSignature` from `@marinoscar/platform-contract/webhooks`, which needs only Web Crypto.

## Quick start

The reference app's binding, [`apps/api/src/platform/webhooks/webhooks.config.ts`](../../../../apps/api/src/platform/webhooks/webhooks.config.ts), and its host module, [`webhooks-host.module.ts`](../../../../apps/api/src/platform/webhooks/webhooks-host.module.ts) (the one port the slice cannot reach by itself, the bypass client for system-scope rows):

```ts
export const webhooksModule = WebhooksModule.forRoot({
  appName: APP_NAME,
  imports: [WebhooksHostModule], // binds WEBHOOKS_SYSTEM_PRISMA to PrismaSystemService
});
```

Three registrations happen at import time, before the module composes, in the app's manifests: the credential purposes ([`credential-purposes.manifest.ts`](../../../../apps/api/src/platform/credentials/credential-purposes.manifest.ts)), the notification channel, event and email template ([`notification.manifest.ts`](../../../../apps/api/src/platform/notifications/notification.manifest.ts)) and the metrics ([`app-metric.manifest.ts`](../../../../apps/api/src/common/otel/app-metric.manifest.ts)). The permissions come with `@marinoscar/platform-api/manifest`. Raising an event of your own is one registration and one call after your write commits ([example](../../../../apps/api/test/examples/webhooks/register-webhook-event.example.spec.ts)):

```ts
registerWebhookEvent({ key: 'invoices.invoice.paid', label: 'Invoice paid', description: '...', group: 'Invoices', audience: 'org', permission: 'org_webhooks:read', payloadSchema, source: 'invoices' });
await this.webhooks.emit('invoices.invoice.paid', { invoiceId }, { orgId });
```

## Configuration

`WebhooksModule.forRoot(options)`; code options, never environment variables (a signing secret is a credential, never configuration):

| Option | Type | Default | Meaning |
|---|---|---|---|
| `appName` | `string \| () => string` | `App` | The product token of the `User-Agent` (`<name>-Webhooks/1.0`). |
| `allowInsecureHttp` | `boolean` | `false` | Accept `http:` targets. Development only. |
| `allowPrivateTargets` | `boolean` | `false` | Accept private, loopback and link-local targets and ports below 1024. On-premises and development only. |
| `allowedHosts` | `string[]` | `[]` | Host names exempt from the private-address check (an internal receiver an operator vouches for). |
| `circuitBreakerThreshold` | `number` | `20` | Consecutive failed attempts that switch an endpoint off. |
| `rotationOverlapHours` | `number` | `24` | Hours the previous secret keeps signing after a rotation. |
| `deliveryRetentionDays` | `number` | `30` | Days a delivery row is kept. |
| `limits` | `{ user?, org?, system? }` | `20 / 50 / 50` | The most endpoints one owner (user scope) or one organization or the deployment may have. |
| `requestTimeoutMs` | `number` | `10000` | The deadline of one request. |
| `maxDeliveryAttempts` | `number` | `10` | Attempts before a delivery is `dead`. |
| `tasks.purge` | `boolean` | `true` | Register the daily purge cron (it only enqueues). |
| `transport`, `resolver` | `WebhookTransport`, `HostResolver` | Node `http(s)`, the OS resolver | Replace the HTTP transport or the DNS resolver (tests, a proxy). |
| `imports` | `ModuleMetadata['imports']` | `[]` | The app's host module binding `WEBHOOKS_SYSTEM_PRISMA`. |

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `WebhooksModule.forRoot` | option | `forRoot(options?: WebhooksModuleOptions): DynamicModule` | Mount the slice once, with the host module that binds the bypass client | experimental | [example](../../../../apps/api/src/platform/webhooks/webhooks.config.ts) |
| `registerWebhookEvent` | registry | `registerWebhookEvent(def: WebhookEventDef): void` | Add an event to the catalog from your slice or app | experimental | [example](../../../../apps/api/test/examples/webhooks/register-webhook-event.example.spec.ts) |
| `WebhooksService` | token | `emit(eventKey, data, { orgId, userId? })`, `emitForUser`, `enqueueFanout` | Raise an event after the triggering write commits | experimental | [example](../../../../apps/api/test/webhooks/webhooks.db.spec.ts) |
| `WEBHOOKS_SYSTEM_PRISMA` | token | `unique symbol` -> `WebhooksSystemPrisma` | Bind the app's bypass client for system-scope rows | experimental | [example](../../../../apps/api/src/platform/webhooks/webhooks-host.module.ts) |
| `WEBHOOK_NOTIFICATION_CHANNEL` | registry | `NotificationChannelDef` | Register the `webhook` notification channel from the manifest | experimental | [example](../../../../apps/api/src/platform/notifications/notification.manifest.ts) |
| `withWebhookChannel` | hook | `withWebhookChannel(registrations): NotificationRegistration[]` | Put the `webhook` channel on the notifications a member may forward | experimental | [example](../../../../apps/api/src/platform/notifications/notification.manifest.ts) |
| `registerWebhooksEmailTemplates` | registry | `registerWebhooksEmailTemplates(): void` | Register the email of `webhooks.endpoint_disabled` | experimental | [example](../../../../apps/api/src/platform/notifications/notification.manifest.ts) |
| `WEBHOOK_SIGNING_CREDENTIAL_PURPOSE_DEF` | registry | `CredentialPurposeDef` | Declare the deployment and organization tiers of the signing-secret purpose | experimental | [example](../../../../apps/api/src/platform/credentials/credential-purposes.manifest.ts) |
| `WEBHOOK_SIGNING_USER_CREDENTIAL_PURPOSE_DEF` | registry | `UserCredentialPurposeDef` | Declare a member's own tier of the signing-secret purpose | experimental | [example](../../../../apps/api/src/platform/credentials/credential-purposes.manifest.ts) |
| `WEBHOOKS_APP_METRICS` | registry | `readonly AppMetricDef[]` | Declare the slice's three metrics with the app's metric registry | experimental | [example](../../../../apps/api/src/common/otel/app-metric.manifest.ts) |
| `webhooksConformanceSuite` | registry | `ConformanceAppSuite<WebhooksConformanceOptions>` | Run the slice's invariants through `runPlatformConformance({ suites: { webhooks: {} } })` | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |

Supporting exports: the options (`WEBHOOKS_OPTIONS`, `resolveWebhooksModuleOptions`), the event helpers (`webhookEventRegistry`, `findWebhookEvent`, `resolveWebhookEvent`, `catalogFor`, `isSubscribed`, `subscriptionMatches`, the built-in event keys and data schemas), the guard (`resolveWebhookTarget`, `parseWebhookUrl`, `WebhookEgressError`, `HostResolver`, `systemHostResolver`), the transport (`WebhookTransport`, `nodeWebhookTransport`, `WEBHOOKS_TRANSPORT`, `WEBHOOKS_RESOLVER`), signing (`generateWebhookSecret`, `signedHeaders`), the handlers and their helpers (`retryDelayMs`, `parseRetryAfter`), the data ports (`WebhooksRepository`, `PrismaWebhooksRepository`, `WebhookSecrets`, `CredentialsWebhookSecrets`) and their structural row types, the permission declarations (`WEBHOOKS_PERMISSIONS`, `ORG_WEBHOOKS_PERMISSIONS`, `SYSTEM_WEBHOOKS_PERMISSIONS`), the errors, `WEBHOOKS_NOTIFICATIONS` and the three controllers. The test kit and fakes (`createWebhooksTestKit`, `InMemoryWebhooksRepository`, `FakeWebhookReceiver`, `ScriptedHostResolver`) are `@marinoscar/platform-api/webhooks/testing`.

## Data

Two models of the `webhooks` fragment of `@marinoscar/platform-db` (platform migration `0039_add_webhooks`): `WebhookEndpoint` (`webhook_endpoints`) and `WebhookDelivery` (`webhook_deliveries`). Both are org tables under forced row-level security (policy `<table>_org_isolation`), with a NULLABLE `org_id`: NULL only for a `system`-scope endpoint and its deliveries, which only the bypass client sees. `(endpoint_id, event_id)` is unique, which makes the fan-out idempotent, and deliveries cascade with their endpoint, the owning user and the organization. The slice reads `users` (the owner re-check) and writes `jobs` (through `enqueueWithin`, in the delivery transaction), and never imports a generated client. The signing secret is not a column: it lives in the credentials store (`UserCredentialsService`, `OrgCredentialsService` or `CredentialsService`, by scope) under purpose `webhook_signing` and name `endpoint:<id>:v<version>`.

## Permissions and settings

| Permission | Scope | Seeded to | Gates |
|---|---|---|---|
| `webhooks:read`, `webhooks:write` | org | `org_admin`, `contributor`, `viewer` | `/api/webhooks`: the caller's own endpoints (another member's is a 404) |
| `org_webhooks:read`, `org_webhooks:write` | org | `org_admin` | `/api/org/webhooks`: the active organization's endpoints |
| `system_webhooks:read`, `system_webhooks:write` | system | `admin` | `/api/admin/webhooks`: the deployment's endpoints |

A route enforces exactly one string, `read` for a `GET` and `write` for the rest. An event may name a permission (`WebhookEventDef.permission`); the subscriber must hold it when the endpoint is created and the endpoint's owner when the event fans out. No settings: the slice is configured by `forRoot` options and per-member notification preferences (the `webhook` column of `/settings/notifications`).

## UI

None in this slice. The pages (endpoint list, create and edit dialog with the event picker, the one-time secret dialog, the delivery log and drawer) and the settings cards are `@marinoscar/platform-web/webhooks`.

## Infra

None. No environment variable: the signing secrets are credentials, the egress policy is a `forRoot` option, and delivery needs outbound HTTPS from the API process only (a deployment behind an egress allowlist lists each receiver's host).

## Observability

- Spans: `webhooks.deliver` per attempt with `webhook.endpoint.id`, `webhook.event.type`, `webhook.attempt` and `http.response.status_code`; the system client records `db.access.reason` `webhooks` or `retention`.
- Metrics (`WEBHOOKS_APP_METRICS`): `app.webhooks.deliveries` (`outcome` succeeded, failed, dead or blocked, and `event_group`), `app.webhooks.delivery.duration` (seconds) and `app.webhooks.events` (`queued`, `no_match`, `invalid`, `unknown`). `event_group` is the key's first segment when registered, else `other`; never an endpoint, URL, user or organization.
- Logs: a line per attempt with the delivery id, the outcome, the status, a code and the receiver's HOST only. Never a URL path or query, a secret, a signature or a response body.
- Audit events (`webhook.endpoint.create`, `.update`, `.delete`, `.rotate_secret`, `.disable`, `webhook.delivery.redeliver`) carry the scope and ids, never a URL or a secret.

## Security notes

- **The secret is shown twice in an endpoint's life**: by `POST` (create) and by `rotate-secret`. It is never in a list, a get, a delivery row, an audit row, a span or a log line (the `webhooks` conformance suite proves it with captured logs).
- **SSRF.** Every request passes the egress guard at create and at send; all resolved addresses must be public; the checked address is pinned for the connection; redirects are never followed. Do not weaken `allowPrivateTargets` outside development; prefer `allowedHosts` for one internal receiver.
- **Ownership.** Every query is pinned to the caller's scope (organization, and owner for user scope), so an id outside it is a 404. The owner's permission is re-read at every fan-out.
- **Server-only jobs.** `webhooks.deliver`, `webhooks.fanout` and `webhooks.deliveries_purge` declare neither `nodeResultSchema` nor `persistNodeResult`: the signing secret is never brokered to a worker node.
- **Receivers** must verify the signature over the raw body with `verifyWebhookSignature`, reject a stale timestamp and deduplicate on `webhook-id` (the event id, identical across retries and redeliveries).
- **A user event is delivered in an organization.** User endpoints are created in the organization active at the time; a notification reaches them when it is delivered in that organization (the single-mode default organization otherwise).

## Conformance suite

Importing `@marinoscar/platform-api/webhooks/testing` registers the `webhooks` suite. It drives the real services over in-memory ports, so it needs no database:

```ts
import '@marinoscar/platform-api/webhooks/testing';
runPlatformConformance({ sourceRoots: [API_SOURCE_ROOT], suites: { webhooks: {} } });
```

| Case | Fails when |
|---|---|
| `routes` | A route of the three controllers is public, unauthenticated, or does not enforce exactly its tier's permission (read for `GET`, write otherwise) |
| `signing` | A delivery's signature does not verify with `verifyWebhookSignature`, or a rotation overlap does not carry two |
| `egress` | A loopback, private, link-local, metadata, CGNAT, multicast or IPv4-mapped target is accepted at create, or reached at send, or a name that turned private after create (DNS rebinding) is called |
| `secrecy` | The signing secret, a signature header or a URL query appears in a response other than create and rotate, a delivery row, an audit row or a log line |
| `queue` | Creating, testing, redelivering or emitting makes an HTTP request, or any file but the transport imports `node:http` or `node:https` |
| `authz` | An endpoint is visible across owners, scopes or organizations, or an owner who lost the permission keeps receiving |

The `cron-enqueue-only` and `on-event-no-io` suites of `runPlatformConformance` cover the purge cron and the three bridges when the slice's source root is among the scanned roots.

## Upgrade notes

First release (`0.1.0-next`). A platform migration (`0039_add_webhooks`) adds the two tables; install it with `platform db sync`. Register the credential purposes and, if you want members to forward notifications, add the `webhook` channel to the events they may forward with `withWebhookChannel`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Creating an endpoint answers 422 `WEBHOOK_URL_FORBIDDEN` | The URL is http, has userinfo, uses a port below 1024, or its host resolves to a non-public address. Use a public https URL, or `allowedHosts` for an internal receiver. |
| An endpoint turned itself off | `disabledReason` says why: `circuit_open` (20 failed attempts in a row), `gone` (the receiver answered 410) or `owner_lost_access` (its owner no longer holds the permission). Fix the cause, then enable it again; enabling resets the failure count. |
| A delivery is `dead` with `ssrf_blocked` | The host resolved to a non-public address at send time. The guard re-resolves on every attempt. |
| `A system access needs a registered reason` | The slice registers the `webhooks` reason in `forRoot` and in the repository's constructor; a hand-built bypass client must register it first (`registerWebhooksSystemAccessReason()`). |
| `Duplicate notification channel sender registered for 'webhook'` | An app channel of its own uses the id `webhook`. Rename the app's channel; the id belongs to this slice. |
| A member's notification never reaches their endpoint | The event must declare the `webhook` channel (`withWebhookChannel`), the member must not have muted it, and an enabled user endpoint must subscribe to `notification.<eventKey>`. |

## Links

- [Package README](../../README.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
- [Job handler recipe](../jobs/handlers/README.md)
- [Notifications README](../notifications/README.md)
- [Credentials README](../credentials/README.md)
- [Contract README](../../../platform-contract/src/webhooks/README.md)
