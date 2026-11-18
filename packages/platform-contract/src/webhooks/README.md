# @marinoscar/platform-contract/webhooks

The wire contract of the webhooks slice (issue #1046): the endpoint, delivery, event-catalog and envelope shapes of the user (`/api/webhooks`), organization (`/api/org/webhooks`) and system (`/api/admin/webhooks`) routes, as zod schemas with inferred types, zod-free constants, and the signing helpers a receiver uses to verify a delivery. `@marinoscar/platform-api/webhooks` wraps the schemas as DTOs; `@marinoscar/platform-web/webhooks` reads the types. It depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

One definition of what crosses the wire for webhooks, so the API's validation, its OpenAPI document, the web client and an external receiver cannot drift.

| Part | Source | What it is |
|---|---|---|
| Constants | `constants.ts` | Zod-free: scopes, delivery statuses, the six permission strings, the `webhook-*` header names, the envelope `apiVersion`, error codes, the event key pattern and the limits. |
| Schemas | `schemas.ts` | Endpoint (never with a secret), create and update bodies, the one-time secret responses, delivery rows and detail, the delivery list query, the test response, the event catalog and the envelope. |
| Signing | `signature.ts` | `signWebhookPayload` and `verifyWebhookSignature`: Standard Webhooks `v1`, HMAC-SHA256 through Web Crypto, so the same code runs in Node and in a browser. Zod-free. |

Event keys are an OPEN vocabulary (the API's registry decides which exist); the contract only fixes their shape. A subscription entry is an exact key (`jobs.job.failed`), a group wildcard (`nodes.*`) or `*`.

Not here: the registry, fan-out, the delivery job and the SSRF guard (`@marinoscar/platform-api/webhooks`), the pages (`@marinoscar/platform-web/webhooks`).

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { createWebhookEndpointSchema, WEBHOOK_HEADERS } from '@marinoscar/platform-contract/webhooks';
import type { WebhookEndpoint, WebhookEnvelope } from '@marinoscar/platform-contract/webhooks';
```

None beyond the package's own peer, `zod` (`^4.4.3`). A browser that imports only the constants and the types never bundles `zod`.

## Quick start

Verify a delivery in a receiver (Node 20+, any runtime with Web Crypto). Pass the raw body, not a re-serialised one:

```ts
import { verifyWebhookSignature, WEBHOOK_HEADERS } from '@marinoscar/platform-contract/webhooks';

const ok = await verifyWebhookSignature({
  secrets: [currentSecret, previousSecret].filter(Boolean), // both during a rotation overlap
  id: headers[WEBHOOK_HEADERS.ID],
  timestamp: headers[WEBHOOK_HEADERS.TIMESTAMP],
  body: rawBody,
  signatureHeader: headers[WEBHOOK_HEADERS.SIGNATURE],
});
```

Deduplicate on `webhook-id`: it is the same on every retry of an event.

## Configuration

None. Schemas and constants take no options.

## Extension-point catalog

None. The contract declares shapes; registering events, endpoints' owners and policies is `@marinoscar/platform-api/webhooks`.

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

Supporting exports (experimental): `WEBHOOK_SCOPES`, `WEBHOOK_DELIVERY_STATUSES`, `WEBHOOK_PERMISSIONS`, `WEBHOOK_HEADERS`, `WEBHOOK_API_VERSION`, `WEBHOOK_SECRET_PREFIX`, `WEBHOOK_SIGNATURE_VERSION`, `WEBHOOK_DEFAULT_TOLERANCE_SECONDS`, `WEBHOOK_ERROR_CODES`, `WEBHOOK_EVENT_KEY_PATTERN`, `WEBHOOK_EVENT_KEY_REGEX_SOURCE`, `WEBHOOK_EVENT_KEY_MAX`, `WEBHOOK_EVENT_KEYS_MAX`, `WEBHOOK_NAME_MAX`, `WEBHOOK_DESCRIPTION_MAX`, `WEBHOOK_URL_MAX`, `WEBHOOK_DELIVERIES_PAGE_SIZE_MAX`, `WEBHOOK_DELIVERIES_PAGE_SIZE_DEFAULT`; the schemas `webhookEventKeySchema`, `webhookScopeSchema`, `webhookDeliveryStatusSchema`, `webhookEndpointSchema`, `createWebhookEndpointSchema`, `updateWebhookEndpointSchema`, `webhookEndpointListSchema`, `webhookEndpointCreatedSchema`, `rotateWebhookSecretResponseSchema`, `webhookDeliverySchema`, `webhookDeliveryDetailSchema`, `webhookDeliveryListSchema`, `webhookDeliveryListQuerySchema`, `webhookTestResponseSchema`, `webhookEventCatalogEntrySchema`, `webhookEventCatalogSchema`, `webhookEnvelopeSchema`, and their types; the helpers `signWebhookPayload`, `verifyWebhookSignature` and their input types.

## Data

None. The contract owns no table.

## Permissions and settings

Declares none. `WEBHOOK_PERMISSIONS` names the strings the API routes enforce, for a client's own checks: `webhooks:read` / `webhooks:write` (user scope), `org_webhooks:read` / `org_webhooks:write` (organization) and `system_webhooks:read` / `system_webhooks:write` (system).

## UI

None. Types only.

## Infra

None.

## Observability

None.

## Security notes

The secret appears in exactly two responses (`webhookEndpointCreatedSchema`, `rotateWebhookSecretResponseSchema`) and nowhere else; `webhookEndpointSchema` and the delivery shapes carry none, and `webhookDeliveryDetailSchema.requestHeaders` never includes the signature. `verifyWebhookSignature` compares in constant time, rejects a timestamp outside the tolerance (default 300 seconds, a replay guard), accepts several secrets and several header entries for rotation, and returns `false` instead of throwing on malformed input. The endpoint `url` is only syntax-checked here (http or https, at most 2048 characters); the SSRF guard is the API's.

## Conformance suite

None. `test/webhooks.test.ts` pins the schemas, the key pattern and the signing vector; `test/no-zod-in-constants.test.ts` keeps the constants zod-free.

## Upgrade notes

New in #1046. No earlier shape to migrate from.

## Troubleshooting

- **Verification fails though the secret is right.** The body was re-serialised (verify the raw bytes), the secret lost its `whsec_` prefix handling (pass it exactly as shown, prefix included or not), or the receiver's clock is more than `toleranceSeconds` off.
- **A subscription is refused with 400.** The entry does not match `WEBHOOK_EVENT_KEY_PATTERN`: use `group.event`, `group.*` or `*`, lower case.

## Links

- API: `@marinoscar/platform-api/webhooks`. Web: `@marinoscar/platform-web/webhooks`.
- Spec: [platform-packages.md](../../../../docs/specs/platform-packages.md).
