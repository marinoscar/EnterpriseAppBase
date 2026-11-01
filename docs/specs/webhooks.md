# Webhooks

> **Status:** shipped · **Code:** `@marinoscar/platform-api/webhooks` (`packages/platform-api/src/webhooks/`), bound by `apps/api/src/platform/webhooks/webhooks.config.ts`; pages `@marinoscar/platform-web/webhooks` (`packages/platform-web/src/webhooks/`); wire schemas and the receiver helper `@marinoscar/platform-contract/webhooks` (`packages/platform-contract/src/webhooks/`); schema `packages/platform-db/schema/webhooks.prisma` (migration `0039_add_webhooks`) · **API:** `/api/webhooks/*`, `/api/org/webhooks/*`, `/api/admin/webhooks/*` (see `/api/docs`) · **Admin UI:** `/settings/webhooks`, `/admin/settings/organization-webhooks`, `/admin/settings/webhooks` · **Runbook:** [webhooks.md](../runbooks/webhooks.md) · **Recipe:** [§4](#4-extending-it-in-a-fork)

Webhooks push events out of the deployment. A member, an organization or the deployment registers an HTTPS endpoint, subscribes it to events from an open catalog, and the platform POSTs each event to it as a signed JSON envelope. Every request is made by a queue job (`webhooks.deliver`) behind an SSRF-safe egress guard, with retries, a circuit breaker and a delivery log.

## 1. Purpose

**What it is.** A way to wire the deployment into other systems (a chat bot, an incident tool, a data pipeline) without polling its API. A fork gets the endpoint management API and pages, the catalog, signing, delivery, retention and a conformance suite; it adds an event with one registration ([§4](#4-extending-it-in-a-fork)).

**What it is not.**

- Not incoming webhooks (receiving). The slice only sends.
- Not a general HTTP client: the target is a URL a user typed, so every request passes the egress guard ([§2.7](#27-the-ssrf-guard)).
- Not a message broker: delivery is at least once, ordering is not guaranteed, and a delivery row is kept for `deliveryRetentionDays` only.
- Not per-endpoint rate limiting or payload transformation.

## 2. How it works

### 2.1 Scopes

| Scope | Owner | Created in | Receives | Managed by |
|---|---|---|---|---|
| `user` | the member (`owner_user_id`) | the member's active organization | events with audience `user`: the notification bridge and `webhooks.ping` | the member, at `/api/webhooks` |
| `org` | the organization (`created_by_id` is the creator) | the active organization | events with audience `org` | an `org_admin`, at `/api/org/webhooks` |
| `system` | the deployment (`org_id` is `NULL`) | no organization | events with audience `system` (nodes and jobs) | an `admin`, at `/api/admin/webhooks` |

The three controllers share one service and one response shape. Every query is pinned to the caller's scope (organization, plus owner for `user`), so an id outside it answers `404`, never `403`.

### 2.2 The event catalog

`registerWebhookEvent(def)` adds an event to an open registry (ids are strings, never a closed list):

| Field | Meaning |
|---|---|
| `key` | `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`, at most 128 characters. Permanent once receivers subscribe to it |
| `label`, `description`, `group` | What the event picker shows; `group` heads the wildcard (`nodes.*`) |
| `audience` | `user`, `org` or `system`: which scope of endpoint may subscribe |
| `permission?` | A permission the subscriber must hold when the endpoint is created and the endpoint's owner must hold at every fan-out |
| `payloadSchema` | A Zod schema of `data`; exported as JSON Schema by the catalog route |
| `example?`, `source` | A sample `data`; the registering slice or `platform` |

Events the platform registers (`registry/builtin-events.ts`):

| Key | Audience | Raised when |
|---|---|---|
| `webhooks.ping` | `user` | The Test button of an endpoint (any scope). Never subscribable |
| `nodes.node.offline` | `system` | A worker node goes offline |
| `nodes.node.event` | `system` | A worker node reports an event (power change, low battery, ...) |
| `jobs.job.failed` | `system` | A job failed for good. A `webhooks.*` job never raises it |
| `alerts.alert.fired` | `system` | An alert rule started firing and has its webhook flag on. Group `Alerts`, permission `system_webhooks:read`. Registered by the reference app, not the platform |
| `alerts.alert.resolved` | `system` | A firing alert cleared. Same registration |
| `notification.<eventKey>` | `user` | The notification bridge ([§2.3](#23-the-notification-bridge)) |

The alerts slice raises `alerts.alert.fired` and `alerts.alert.resolved` through an optional port ([alerts.md §2.8](alerts.md#28-dispatch)); the platform does not register them. The reference app binds the port to `WebhooksService.emit` and registers both events (`apps/api/src/platform/alerts/alerts-webhooks.adapter.ts`), so a fork that mounts only one of the two slices carries no dependency on the other.

A subscription is an exact key, a group wildcard (`nodes.*`) or `*` (everything the subscriber is permitted). At most 100 subscriptions per endpoint. `GET .../events` returns only the entries the caller may subscribe to at that scope.

### 2.3 The notification bridge

Every notification event that declares the `webhook` channel is exposed to members as `notification.<eventKey>` (group `Notifications`, audience `user`). The channel is a normal notification channel (`id: 'webhook'`, label `Webhooks`, user-configurable, not critical-capable, not on for broadcasts by default). A notification reaches a member's endpoints only when all of these hold:

1. The event declares the `webhook` channel (the app adds it with `withWebhookChannel`).
2. The member switched the **Webhooks** column on for the event in their notification preferences, and the administrator has not switched the channel off.
3. The member has at least one enabled `user` endpoint that subscribes to `notification.<eventKey>`, `notification.*` or `*`.

The `data` is the notification rendered the way the bell renders it: `{ event: { key, label, description }, title, body, link, fields }`. The raw template data is never sent.

The slice also raises the notification event `webhooks.endpoint_disabled` (email and bell) to an endpoint's owner when the platform switches it off ([§2.6](#26-retries-the-circuit-breaker-and-410)).

### 2.4 Emitting and fan-out

`WebhooksService.emit(eventKey, data, { orgId, userId? })` runs after the triggering write commits, outside any `$transaction`. It then:

1. Validates `data` against the event's `payloadSchema`. An unknown event or invalid data is counted (`app.webhooks.events`, outcome `unknown` or `invalid`) and logged, and never thrown to the caller.
2. Finds the enabled endpoints that match the audience (`user`: the endpoints owned by `userId` in `orgId`; `org`: the organization's; `system`: the deployment's) and whose subscriptions match the key.
3. Re-reads each endpoint owner's access (an active account, the event's `permission`, a membership in the organization). An owner who lost it has the endpoint switched off with `disabled_reason = owner_lost_access`.
4. In one transaction inserts one `webhook_deliveries` row per endpoint (unique on `(endpoint_id, event_id)`, so a repeat is a no-op) and one `webhooks.deliver` job per delivery with `JobsService.enqueueWithin`.

The domain-event bridges (`nodes.node.offline`, `nodes.node.event`, `job.settled`) are `@OnEvent` listeners that do no I/O: each only enqueues a `webhooks.fanout` job, whose handler calls `emit`. A failure to enqueue is logged and swallowed, so a bridge never breaks the event bus.

### 2.5 The envelope and headers

The body is the delivery's stored `payload`, sent byte for byte:

```json
{
  "id": "6f1c1b0e-0000-4000-8000-000000000000",
  "type": "nodes.node.offline",
  "createdAt": "2026-11-01T12:00:00.000Z",
  "apiVersion": "2026-11-01",
  "org": null,
  "data": {}
}
```

`id` is the event id; `org` is `{ "id": "..." }` for an organization event and `null` for a system one. The headers follow [Standard Webhooks](https://www.standardwebhooks.com/):

| Header | Value |
|---|---|
| `webhook-id` | The event id. Identical across retries, redeliveries and endpoints, so a receiver deduplicates on it |
| `webhook-timestamp` | Unix seconds at signing time. Each attempt signs again, so it changes per attempt |
| `webhook-signature` | One or two space-separated `v1,<base64>` entries ([§2.8](#28-signing-rotation-and-verification)) |
| `content-type` | `application/json` |
| `user-agent` | `<appName>-Webhooks/1.0` |

### 2.6 Retries, the circuit breaker and 410

`webhooks.deliver` is one attempt of one delivery. Per attempt it loads the delivery and endpoint, reads the signing secret(s), runs the egress guard, POSTs the stored body with a 10 s deadline, never follows a redirect and keeps the first 1 KiB of the answer.

| Answer | Result |
|---|---|
| 2xx | `succeeded`; the endpoint's failure count resets |
| 410 Gone | `dead` (`http_410`) and the endpoint is switched off at once (`disabled_reason = gone`) |
| Any other status, a timeout or a network error | A failed attempt; `failed` while attempts remain, `dead` after `maxDeliveryAttempts` (10) |
| Refused by the egress guard | `dead` (`ssrf_blocked`), final, no retry |
| Endpoint disabled or deleted | `dead` (`endpoint_disabled` / `endpoint_gone`); a `webhooks.ping` still goes to a disabled endpoint |

A failed attempt schedules the next attempt's job itself, in the same transaction as the delivery update: 30 s, 2 m, 10 m, 30 m, 1 h, 2 h, 4 h, 6 h, 6 h after attempts 1 to 9, each with half-range jitter. A `Retry-After` on the answer (seconds or an HTTP date) is a floor, capped at 24 h. A job that throws (the database) is retried by the queue as usual.

**Circuit breaker.** Each failed attempt adds one to the endpoint's `consecutive_failures`; a success resets it. At `circuitBreakerThreshold` (default 20) the endpoint is switched off with `disabled_reason = circuit_open` and its owner receives `webhooks.endpoint_disabled`, raised after the commit. Enabling the endpoint again resets the count and clears the reason.

The job is server-only (`profile: { maxRuntimeMs: 30000, maxAttempts: 10 }`; no `nodeResultSchema`, no `persistNodeResult`) because it reads the signing secret. It is the only code in the slice that makes an HTTP request.

### 2.7 The SSRF guard

A webhook URL is typed by an end user and called by the server. The guard (`egress/egress-guard.ts`) runs at create and update (a `422 WEBHOOK_URL_FORBIDDEN`) and again at every send, because a name can resolve elsewhere later (DNS rebinding):

- The scheme is `https` (`http` only with `allowInsecureHttp`), with no userinfo.
- The port is 80, 443, 8443 or 1024 and above.
- Every address the name resolves to (A and AAAA) must be a public unicast address. Loopback, private, link-local (the cloud metadata address included), carrier-grade NAT, multicast, unspecified, documentation and IPv4-mapped private ranges are refused if any one address is.
- The connection goes to the address that was checked (pinned in the transport), never to a second lookup.
- Redirects are never followed, so a `3xx` is a failure.

`allowPrivateTargets` switches the address and port rules off (on-premises and development). `allowedHosts` exempts exactly the listed host names from the address rule, for one internal receiver an operator vouches for. A DNS failure at create is not an error (the receiver may not exist yet); at send it is a failed attempt.

### 2.8 Signing, rotation and verification

The signing secret is `whsec_` plus 32 random bytes in base64, generated by the server, returned **once** by create and once per `rotate-secret`, and never again. It is not a column: it lives in the credentials store under purpose `webhook_signing` and name `endpoint:<id>:v<version>` (the member's tier for `user`, the organization's for `org`, the deployment's for `system`).

The signature is `base64(HMAC-SHA256(secret bytes, "<webhook-id>.<webhook-timestamp>.<body>"))`, sent as `v1,<signature>`.

**Rotation.** `POST .../rotate-secret` mints version N+1, makes it current and keeps version N signing until `previous_secret_until` (now plus `rotationOverlapHours`, default 24). During the overlap the header carries two entries and a receiver that knows either secret verifies. Deploy the new secret at the receiver, then let the old one expire; there is no revoke step.

**Verification.** A receiver verifies the raw body, not a re-serialized one. `verifyWebhookSignature` (Web Crypto only, so it runs in Node 20+ and browsers) returns `true` when the timestamp is within `toleranceSeconds` (default 300) and any `v1` entry matches any given secret:

```ts
import express from 'express';
import { verifyWebhookSignature } from '@marinoscar/platform-contract/webhooks';

const app = express();
const seen = new Set<string>(); // use a durable store in production

app.post('/hooks/app', express.raw({ type: 'application/json' }), async (req, res) => {
  const id = req.header('webhook-id') ?? '';
  const ok = await verifyWebhookSignature({
    secrets: [process.env.WEBHOOK_SECRET ?? ''], // both secrets while rotating
    id,
    timestamp: req.header('webhook-timestamp') ?? '',
    body: req.body.toString('utf8'), // the exact bytes received
    signatureHeader: req.header('webhook-signature') ?? '',
  });
  if (!ok) return res.status(400).end();
  if (seen.has(id)) return res.status(200).end(); // already handled
  seen.add(id);
  const event = JSON.parse(req.body.toString('utf8'));
  // ... handle event.type / event.data, then answer 2xx quickly
  res.status(200).end();
});
```

### 2.9 Data model and row-level security

Two models of the `webhooks` fragment (`webhook_endpoints`, `webhook_deliveries`); the table inventory is [ARCHITECTURE.md §6.1](../ARCHITECTURE.md#61-prisma-models). Both are org tables under forced row-level security (policy `<table>_org_isolation`, listed in `packages/platform-db/rls-policies.json`) with a **nullable** `org_id`: `NULL` only for a `system` endpoint and its deliveries, which only the bypass client sees. The slice reaches them through that client under the registered system access reason `webhooks` (and `retention` for the purge). `webhook_deliveries` cascades with its endpoint; endpoints cascade with the owning user and the organization. The ownership classification (`packages/platform-api/src/manifest/platform-model-ownership.ts`) decides what user-data reset and organization offboarding delete.

A delivery row stores the exact body sent (already redacted by the event's data schema), the status (`pending`, `delivering`, `succeeded`, `failed`, `dead`), the attempt count, the response status, the first 1 KiB of the response, an error code (`timeout`, `ssrf_blocked`, `http_4xx`, `http_5xx`, `network`, `http_410`, ...), the duration and the next attempt time. The signature is derived at send time and never stored.

### 2.10 Redelivery and test

`POST .../deliveries/:deliveryId/redeliver` resets the **same** delivery row to `pending` (attempt 0, answer cleared) and queues a fresh job, so `webhook-id` stays the same and a receiver that deduplicates sees a repeat. It refuses (`409`) while the endpoint is disabled. `POST .../:id/test` queues a `webhooks.ping` delivery and returns its id; read the result in the delivery log.

### 2.11 Retention

`webhooks.deliveries_purge` deletes deliveries older than `deliveryRetentionDays` (default 30) in batches of 2000, with a stop after 500 batches. A cron at 04:17 only enqueues it (`enqueueHousekeepingJob`); disable the cron in a process with `tasks.purge: false`. The retention table is [data-retention.md](../runbooks/data-retention.md).

### 2.12 Observability

- Span `webhooks.deliver` per attempt with `webhook.endpoint.id`, `webhook.event.type`, `webhook.attempt` and `http.response.status_code`.
- Metrics: `app.webhooks.deliveries` (counter; `outcome` succeeded, failed, dead or blocked; `event_group`), `app.webhooks.delivery.duration` (histogram, seconds) and `app.webhooks.events` (counter; `queued`, `no_match`, `invalid`, `unknown`). `event_group` is the key's first segment when it is a registered group, else `other`. No endpoint, URL, user or organization is ever a label.
- Logs: one line per attempt with the delivery id, outcome, status, a code and the receiver's **host** only.
- Audit events (`webhook.endpoint.create`, `.update`, `.delete`, `.rotate_secret`, `.disable`, `webhook.delivery.redeliver`) carry the scope and ids.
- No secret, signature, URL path or query appears in a log, span, audit row, delivery row or any response other than create and rotate.

## 3. Configuration and permissions

**Options** (`WebhooksModule.forRoot`, code options; there is no environment variable and no setting, because a signing secret is a credential and the policy is a product decision):

| Option | Default | Meaning |
|---|---|---|
| `appName` | `App` | Product token of the `User-Agent` |
| `allowInsecureHttp` | `false` | Accept `http:` targets (development) |
| `allowPrivateTargets` | `false` | Accept private targets and ports below 1024 (on-premises, development) |
| `allowedHosts` | none | Host names exempt from the address check |
| `circuitBreakerThreshold` | 20 | Consecutive failures that switch an endpoint off |
| `rotationOverlapHours` | 24 | How long the previous secret keeps signing |
| `deliveryRetentionDays` | 30 | Days a delivery row is kept |
| `limits` | 20 user, 50 org, 50 system | Most endpoints per member, per organization, per deployment (`WEBHOOK_LIMIT_REACHED`) |
| `requestTimeoutMs`, `maxDeliveryAttempts` | 10000, 10 | The request deadline and the attempts before `dead` |
| `tasks.purge` | `true` | Register the daily purge cron |
| `transport`, `resolver`, `imports` | OS defaults | Test seams and the host module that binds `WEBHOOKS_SYSTEM_PRISMA` |

**Permissions.** A route enforces exactly one string, `read` for a `GET` and `write` for the rest. The full matrix is [ARCHITECTURE.md §7.2](../ARCHITECTURE.md#72-permission-matrix).

| Permission | Scope | Default grants | Gates |
|---|---|---|---|
| `webhooks:read`, `webhooks:write` | org | `org_admin`, `contributor`, `viewer` | `/api/webhooks`: the caller's own endpoints |
| `org_webhooks:read`, `org_webhooks:write` | org | `org_admin` | `/api/org/webhooks` |
| `system_webhooks:read`, `system_webhooks:write` | system | `admin` | `/api/admin/webhooks` |

**Routes.** The same eleven under each prefix (per-endpoint detail in `/api/docs`):

| Method and path (after the prefix) | Permission | Purpose |
|---|---|---|
| `GET /`, `POST /` | read, write | List; create (returns the secret once) |
| `GET /:id`, `PATCH /:id`, `DELETE /:id` | read, write, write | Read, change (including `enabled`), delete |
| `POST /:id/rotate-secret` | write | New secret and the overlap end |
| `POST /:id/test` | write | Queue a `webhooks.ping` |
| `GET /:id/deliveries` | read | The delivery log (`page`, `pageSize`, `status`, `eventKey`) |
| `GET /deliveries/:deliveryId`, `POST /deliveries/:deliveryId/redeliver` | read, write | One delivery with its body; redeliver |
| `GET /events` | read | The catalog the caller may subscribe to |

Errors use `WEBHOOK_ERROR_CODES` (`WEBHOOK_NOT_FOUND`, `WEBHOOK_DELIVERY_NOT_FOUND`, `WEBHOOK_URL_INVALID`, `WEBHOOK_URL_FORBIDDEN`, `WEBHOOK_EVENT_UNKNOWN`, `WEBHOOK_EVENT_NOT_PERMITTED`, `WEBHOOK_LIMIT_REACHED`).

**Settings cards** (declared as data by `webhooksUserSettingsSections` and `webhooksAdminSections`, spread into the app registries): `Webhooks` in the user hub (group Integrations, `webhooks:read`), `Webhooks` in the admin Operations group (`system_webhooks:read`) and `Organization webhooks` in the admin Organizations group (`org_webhooks:read`, `feature: 'orgs'`). Writes are gated inside the page. See [settings-ui.md](settings-ui.md).

## 4. Extending it in a fork

Raise an event of your own with one registration and one call after your write commits:

```ts
registerWebhookEvent({
  key: 'invoices.invoice.paid', label: 'Invoice paid', description: 'An invoice was paid.',
  group: 'Invoices', audience: 'org', permission: 'org_webhooks:read',
  payloadSchema, example, source: 'invoices',
});
await this.webhooks.emit('invoices.invoice.paid', { invoiceId }, { orgId });
```

The event appears in the picker and the catalog route at once; an event key is permanent once receivers subscribe to it. To bridge a domain event, add an `@OnEvent` listener that only calls `WebhooksService.enqueueFanout` (a listener does no I/O). To forward a notification, add the channel with `withWebhookChannel`. The module README owns the rest (options, tokens, the test kit): [packages/platform-api/src/webhooks/README.md](../../packages/platform-api/src/webhooks/README.md); web: [packages/platform-web/src/webhooks/README.md](../../packages/platform-web/src/webhooks/README.md); wire shapes: [packages/platform-contract/src/webhooks/README.md](../../packages/platform-contract/src/webhooks/README.md). A tested example: `apps/api/test/examples/webhooks/register-webhook-event.example.spec.ts`.

## 5. Guardrails

The `webhooks` conformance suite (`@marinoscar/platform-api/webhooks/testing`, run by `apps/api/test/conformance.spec.ts`) drives the real services over in-memory ports:

- `routes`: every route of the three controllers is authenticated and enforces exactly its tier's permission.
- `signing`: a delivery's signature verifies with `verifyWebhookSignature`; a rotation overlap carries two signatures.
- `egress`: loopback, private, link-local, metadata, CGNAT, multicast and IPv4-mapped targets are refused at create and at send, and a name that turned private after create is not called.
- `secrecy`: the secret, a signature or a URL query appears in no response other than create and rotate, no delivery or audit row and no log line.
- `queue`: creating, testing, redelivering or emitting makes no HTTP request, and no file but the transport imports `node:http` or `node:https`.
- `authz`: an endpoint is invisible across owners, scopes and organizations, and an owner who lost the permission stops receiving.
- `cron-enqueue-only` and `on-event-no-io` (platform suites) cover the purge cron and the three bridges.

## 6. Design decisions

- **One job per delivery attempt, retries scheduled by the slice.** The queue's generic backoff cannot honour `Retry-After` or the 30 s to 6 h schedule, so a failed attempt enqueues its successor. Rejected: one long-lived job sleeping between attempts, which holds a worker slot for hours.
- **`webhook-id` is the event id.** Receivers deduplicate on one value across retries, redeliveries and endpoints. Rejected: a per-delivery id, which would hide a redelivery from a receiver that deduplicates.
- **Redeliver resets the same row.** The unique `(endpoint_id, event_id)` index would refuse a second row for the same event; resetting keeps the log as one story per event.
- **The secret lives in the credentials store.** The row holds a version number only, so a database dump, an export or an audit row cannot leak it. Rejected: a column encrypted by the slice, a second cipher to rotate.
- **Re-check the owner at fan-out.** An endpoint is its owner's delegate; deactivating an account or removing a role silences it at the next event rather than leaving a standing channel.
- **System events go to system endpoints only.** Node and job events are operational data of the deployment; they never reach an organization's endpoint.
- **A nullable `org_id` instead of a sentinel organization.** One policy covers both: a `NULL` row is visible to the bypass client only.
- **Options, not settings.** A retry ceiling and an SSRF policy are product decisions made once in code; a runtime switch for the SSRF policy would be a hole an operator could open by accident.

## 7. Verification

```bash
npx jest --config apps/api/test/jest.config.js --rootDir apps/api test/conformance        # the webhooks suite among the others
npm run test:db --workspace=api -- webhooks                                              # real-Postgres tier
npm run openapi:dump                                                                      # the three route families appear
```

By hand: create a `user` endpoint at a public HTTPS receiver, press Test, and observe a `succeeded` delivery whose signature verifies with the snippet in [§2.8](#28-signing-rotation-and-verification); create one aimed at `https://127.0.0.1/` and observe `422 WEBHOOK_URL_FORBIDDEN`.

## History

- Epic 1044: observability and integrations for operators.
- Issue 1046: the webhooks slice (contract, fragment and migration `0039_add_webhooks`, API, pages, conformance suite, docs).
