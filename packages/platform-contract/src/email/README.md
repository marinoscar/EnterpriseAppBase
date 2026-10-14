# @marinoscar/platform-contract/email

The wire contract of the email slice's admin routes (issue #737, PP-8.4), as zod schemas with their inferred types, plus the zod-free built-in transport list, the transport id pattern and the SMTP ports: the stored settings (`emailSettingsSchema`), the `PUT /api/email-settings` body (`updateEmailSettingsSchema`), the `GET`/`PUT` response (`emailSettingsResponseSchema`) and the `POST /api/email-settings/test` result (`testEmailResultSchema`). `@marinoscar/platform-api/email` wraps them as DTOs; `@marinoscar/platform-web/email` reads their types. 

## Purpose and scope

One definition of what crosses the wire for email configuration, so the API's validation, its OpenAPI document and the web page's types cannot drift. `constants.ts` holds `BUILTIN_EMAIL_PROVIDER_KINDS` (`ses`, `smtp`; the transports the platform ships, not a closed set, with `EMAIL_PROVIDER_KINDS` as a deprecated alias), `EMAIL_TRANSPORT_ID_PATTERN`, the legacy flat-field map, `DEFAULT_SMTP_PORT` (587) and `IMPLICIT_TLS_SMTP_PORT` (465), zod-free. It depends on the `settings` slice for the descriptor shape (`packages/platform-slices.json`).

Not here: the transports, the templates and the settings row (the API slice), the page (the web slice).

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { emailSettingsResponseSchema, BUILTIN_EMAIL_PROVIDER_KINDS } from '@marinoscar/platform-contract/email';
import type { EmailSettingsResponse, UpdateEmailSettingsInput } from '@marinoscar/platform-contract/email';
```

None beyond the package's own peer, `zod` (`^4.4.3`).

## Quick start

The API slice wraps the body as a DTO (its `dto/update-email-settings.dto.ts`); the reference app's page tests type their fixtures with the same shapes through `@marinoscar/platform-web/email/headless` ([`EmailSettingsPage.wire.test.tsx`](../../../../apps/web/src/__tests__/pages/Admin/EmailSettingsPage.wire.test.tsx)):

```ts
import { createZodDto } from 'nestjs-zod';
import { updateEmailSettingsSchema } from '@marinoscar/platform-contract/email';

export class UpdateEmailSettingsDto extends createZodDto(updateEmailSettingsSchema) {}
```

## Configuration

None. Schemas and constants take no options.

## Extension-point catalog

The shapes are the contract of one admin route; what is open is the transport id. A transport an app or package registers (`registerEmailTransport` of `@marinoscar/platform-api/email`) is a valid `provider` everywhere, with its own settings under `transports.<id>` and its own write-only secrets under `secrets.<id>`.

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `emailTransportIdSchema` | option | `z.ZodString` matching `EMAIL_TRANSPORT_ID_PATTERN` | Validate a transport id on the wire (the API checks it against the registry) | experimental | [example](../../../../apps/api/src/app-registrations/email.ts) |

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

## Data

No tables. `emailSettingsSchema` is the value of the `email` row of `system_settings`; `version`, `updatedAt` and `updatedBy` in the response come from that row. Always-present response fields are `.nullable()`; dates are ISO strings.

## Permissions and settings

None declared here. The routes that carry these shapes are gated by `system_settings:read` / `system_settings:write`.

## UI

None. The page is `@marinoscar/platform-web/email/ui`.

## Infra

None.

## Observability

None. The package emits nothing at run time.

## Security notes

No secret is representable in the stored settings or in the response (`secretStatuses` and the two legacy statuses are masked statuses, never values): `EMAIL_SETTINGS_CARRIES_NO_SECRET` and `EMAIL_SETTINGS_RESPONSE_CARRIES_NO_SECRET` are compile-time proofs that fail the build the moment a secret-named field (`smtpPassword`, `password`, `secret`, `apiKey`, `accessKeyId`, `secretAccessKey`, `ciphertext`) is added. The PUT body's `smtpPassword` and `sesSecretAccessKey` are write-only (blank preserves the stored secret); the response describes each as a masked status (`configured`, the store's `hint`, provenance) only. `test/email.test.ts` asserts it at run time too.

## Conformance suite

The API slice's `email` suite (`@marinoscar/platform-api/email/testing`) scans `emailSettingsSchema` and `emailSettingsResponseSchema` for secret-bearing fields; see its README.

## Upgrade notes

New in this version, from the reference app's `src/email/email-settings.schema.ts` and `src/email/dto/`. The transport became an open id (PP-14.8): `provider` is a pattern-checked string instead of an enum, the response gains `transports`, `descriptors` and `secretStatuses`, the PUT body gains `transports` and `secrets`, and the flat `ses*` / `smtp*` fields stay as a deprecated read view and aliases. The OpenAPI document changes only there (an enum becomes a pattern, new optional request fields, new response fields).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `EmailSettingsCarriesNoSecret` resolves to `never` and the build fails | A secret-named field was added to the stored settings | Store the secret with `CredentialsService`; keep only its masked status in the response |
| A PUT with `''` or `null` in a field is not a 400 | By design: the blank forms mean "not configured" and are stripped by the service | Nothing to fix |

## Links

- [Package README](../../README.md)
- [The API slice](../../../platform-api/src/email/README.md)
- [The web slice](../../../platform-web/src/email/README.md)
- [Contract conventions](../../../../docs/PACKAGES.md#contract-conventions)
