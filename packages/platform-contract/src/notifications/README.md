# @marinoscar/platform-contract/notifications

The wire contract of the notifications slice (issue #738, PP-8.5), as zod schemas with their inferred types, plus zod-free constants: the inbox, events, config and SSE frame of `/api/notifications`, the push subscription bodies, the Web Push configuration of `/api/admin/push-config` and its test diagnostics, the broadcasts of `/api/admin/broadcasts` (with `targetOrgId`), and the `notifications` settings namespaces (user preferences, the system policy and its org layer). `@marinoscar/platform-api/notifications` wraps them as DTOs and validates with them; `@marinoscar/platform-web/notifications` reads their constants. It depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

One definition of what crosses the wire for notifications, so the API's validation, its OpenAPI document and the web client cannot drift.

| Part | Source | What it is |
|---|---|---|
| Constants | `constants.ts` | Zod-free: the channel id pattern and length (channel ids are OPEN), the preference bounds, the event key pattern, the SSE event name, the confirmation words, the push test verdicts, the broadcast statuses and limits, `BROADCAST_CHUNK_SIZE`. |
| Settings namespaces | `schemas.ts` | `notificationsSchema` / `notificationsPatchSchema` (user preferences, channel-outer, sparse), `systemNotificationsSchema` / `systemNotificationsPatchSchema` (the deployment policy), `orgNotificationsSchema` (the org layer, tighten only). |
| Inbox | `schemas.ts` | `notificationEventSchema`, `notificationConfigSchema`, `notificationSchema`, `notificationListQuerySchema`, `unreadCountSchema`, `notificationStreamEventSchema`. |
| Push | `schemas.ts` | `pushSubscribeSchema`, `pushConfigSchema`, `pushConfigResponseSchema`, the generate / update / rotate / remove bodies, `pushTestResponseSchema` and its parts, `PUSH_CONTRACT_CARRIES_NO_SECRET`. |
| Broadcasts | `schemas.ts` | `createBroadcastSchema`, `broadcastSchema`, `broadcastDetailSchema`, `broadcastCreateResultSchema`, `broadcastAudienceQuerySchema`, `broadcastAudienceSchema`, `broadcastTestResultSchema`, `broadcastListQuerySchema`. |

Not here: the registries (which channel ids and event keys exist is the API's run-time knowledge), the dispatcher, the pages.

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { createBroadcastSchema, NOTIFICATION_CHANNEL_ID_PATTERN } from '@marinoscar/platform-contract/notifications';
import type { BroadcastResponse, NotificationsValue } from '@marinoscar/platform-contract/notifications';
```

None beyond the package's own peer, `zod` (`^4.4.3`). A consumer that needs only a bound or a pattern (the web client, a service worker) imports the constants, which pull no zod.

## Quick start

The API slice wraps the bodies as DTOs and refines what only it can check, the open channel ids against its registry (the reference app's org-scoped broadcast test drives them: [`org-broadcasts.integration.spec.ts`](../../../../apps/api/test/broadcasts/org-broadcasts.integration.spec.ts)):

```ts
import { createZodDto } from 'nestjs-zod';
import { createBroadcastSchema } from '@marinoscar/platform-contract/notifications';

export class CreateBroadcastDto extends createZodDto(createBroadcastSchema) {}
```

## Configuration

None. Schemas and constants take no options.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `createBroadcastSchema` | schema | `z.object({ title, body, link?, ctaLabel?, channels, scheduledFor?, critical, targetOrgId? })` | Compose or validate a broadcast; `targetOrgId` addresses one organization's active members | stable | [example](../../../../apps/api/test/broadcasts/org-broadcasts.integration.spec.ts) |
| `orgNotificationsSchema` | schema | `z.object({ browserEnabled?, disabledEvents? })` | An organization's overrides of the notification policy: may only tighten it | experimental | [example](../../../../apps/api/src/settings/registry/system-settings.manifest.ts) |

Supporting exports (stable unless noted): every schema listed under Purpose and scope with its inferred type; the named enum types (`BroadcastStatusEnum`, `PushTestOverallEnum`, `PushTestConfigSourceEnum`, `PushTestSendStatusEnum`, `BooleanQueryEnum`); `NoSecretIn`, `SecretFieldNames`, `PushContractCarriesNoSecret`; every constant of `constants.ts`.

**Channel ids are open.** No list of channels is part of the contract: a channel is any id matching `NOTIFICATION_CHANNEL_ID_PATTERN` (at most `NOTIFICATION_CHANNEL_ID_MAX_LENGTH` characters), checked against the API's registry where a new value is written. `PLATFORM_NOTIFICATION_CHANNEL_IDS` names the platform's three for information only.

## Data

None. The schemas describe rows the API slice persists (`notifications`, `push_subscriptions`, `notification_broadcasts`, the `notifications` keys of `system_settings`, `org_settings` and `user_settings`, the `webPush` row), never a table of their own.

## Permissions and settings

None declared. The shapes are gated where they are served: `/api/notifications/*` by a signed-in user, `/api/admin/push-config` by `push:*`, `/api/admin/broadcasts` by `broadcasts:*` or `org_broadcasts:*`. The settings namespace schemas are registered by the API slice (`notifications`, user and system with its org layer).

## UI

None.

## Infra

None.

## Observability

None.

## Security notes

- **No secret crosses this contract.** `PushContractCarriesNoSecret` fails the build when any push response or diagnostic type gains a field named like key material, the subscription keys or the endpoint (a capability URL). The VAPID private key has no field anywhere here.
- **A broadcast link is root-relative** (`/...`, never `//`, `/\` or another origin), refused at the schema, so a stored link can never become an off-site navigation.

## Conformance suite

None. The API slice's `notifications` suite checks, among others, that the push schemas carry no secret-bearing field.

## Upgrade notes

New subpath in this version (#738). The shapes moved from the reference app's DTOs and settings schemas without change, except: channel ids are open (`NOTIFICATION_CHANNELS` and its enum are gone; validate with the pattern), `createBroadcastSchema` and `broadcastSchema` gain `targetOrgId`, `orgNotificationsSchema` and `broadcastAudienceQuerySchema` are new, and `BROADCAST_CHUNK_SIZE` moved here from the API's audience module.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A channel id fails the schema | Upper case, a hyphen, a leading digit, or longer than 32 characters | Use `^[a-z][a-z0-9_]*$` (`android_app`, not `android-app`) |
| `ctaLabel requires link` | A call-to-action label without a link | Add a root-relative `link` or drop the label |
| `a critical broadcast must include the "browser" channel` | A critical broadcast without the inbox | Add `browser`: the inbox row is the record a recipient can go back to |
| The build fails on `PushContractCarriesNoSecret` | A push response type gained a secret-named field | Remove the field; secrets stay in the credential store |

## Links

- [Package README](../../README.md)
- [API slice](../../../platform-api/src/notifications/README.md)
- [Web slice](../../../platform-web/src/notifications/README.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
