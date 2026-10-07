# @marinoscar/platform-contract/doctor

The wire shapes of the admin Doctor (`GET /api/admin/doctor`): the report, one row of it, a check's status and the query, as zod schemas plus their inferred types, and the status constants, and the support bundle envelope (`GET /api/admin/doctor/support-bundle`, issue #772). `@marinoscar/platform-api/doctor` wraps the schemas as its nestjs-zod DTOs (so the OpenAPI document is generated from them); `@marinoscar/platform-web/doctor` takes its types and constants from here. The first slice of the contract (issue #701); it depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

One source for what the Doctor sends and accepts, so the API and the web app can no longer drift apart. The slice follows the contract layout: `constants.ts` (zod-free: `DOCTOR_STATUSES`, `DOCTOR_STATUS_RANK`, `DoctorStatus`), `schemas.ts` (the four report schemas, the two support-bundle schemas and the inferred types) and `index.ts`. A support bundle section's `data` is `unknown` here: each section validates it with its own strict schema on the server.

Not here: the checks, the registry and the service (`@marinoscar/platform-api/doctor`), the page, the client and the hook (`@marinoscar/platform-web/doctor`), and the category labels (presentation, in `platform-web`).

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { doctorReportSchema, DOCTOR_STATUS_RANK } from '@marinoscar/platform-contract/doctor';
import type { DoctorReport, DoctorStatus } from '@marinoscar/platform-contract/doctor';
```

None beyond the package's own peer, `zod` (`^4.4.3`). A browser that imports only the constants and the types never bundles `zod`: the package is `"sideEffects": false` and `constants.ts` imports no zod, so the bundler drops `schemas.ts`.

## Quick start

The app's Doctor page test types its fixture with the contract ([`DoctorPage.test.tsx`](../../../../apps/web/src/__tests__/pages/Admin/DoctorPage.test.tsx)), and the API integration test proves the wire matches it ([`doctor.integration.spec.ts`](../../../../apps/api/test/doctor/doctor.integration.spec.ts)):

```ts
import { doctorCheckReportSchema, doctorReportSchema } from '@marinoscar/platform-contract/doctor';
import { z } from 'zod';

// Extended in app code, never edited: refuse any field the contract does not declare.
const exactReportSchema = doctorReportSchema
  .extend({ checks: z.array(doctorCheckReportSchema.strict()) })
  .strict();

exactReportSchema.parse(body.data);
```

## Configuration

None. Schemas and constants take no options; the route's path and permission are options of `DoctorModule.forRoot()` in `@marinoscar/platform-api/doctor`.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `doctorReportSchema` | schema | `ZodObject<{ verdict; generatedAt; durationMs; checks }>` | Validate or `.extend()` the whole report in app code (a stricter test, an app-side field) | stable | [example](../../../../apps/api/test/doctor/doctor.integration.spec.ts) |
| `doctorCheckReportSchema` | schema | `ZodObject<{ id; category; label; settingsPath; status; detail; remedy; error; data; durationMs }>` | Validate or `.extend()` one row | stable | [example](../../../../apps/api/test/doctor/doctor.integration.spec.ts) |
| `doctorStatusSchema` | schema | `ZodEnum<DoctorStatusEnum>` (`pass`, `warn`, `fail`, `skip`) | Validate a status in an app-side schema of its own | stable | [example](../../../../apps/api/test/doctor/doctor.integration.spec.ts) |
| `doctorQuerySchema` | schema | `ZodObject<{ category?; refresh? }>`, `refresh` `'true' \| 'false'` parsed to a boolean | Validate the route's query the way the API does | stable | [example](../../../../apps/api/test/doctor/doctor.integration.spec.ts) |
| `supportBundleSchema` | schema | `ZodObject<{ bundleVersion; generatedAt; redaction; sections }>` | Parse a downloaded support bundle before trusting its shape (#772) | experimental | [example](../../../../apps/api/test/doctor/support-bundle.integration.spec.ts) |
| `supportBundleSectionResultSchema` | schema | discriminated union on `status`: `ok` (`data`, `truncated?`), `omitted` (`reason`), `error` (`error`) | Validate one section of a bundle | experimental | [example](../../../../apps/api/test/doctor/support-bundle.integration.spec.ts) |

Supporting exports: the constants `DOCTOR_STATUSES` (severity order, `pass < skip < warn < fail`) and `DOCTOR_STATUS_RANK`, and the types `DoctorStatus`, `DoctorCheckReport`, `DoctorReport`, `DoctorQuery` (the parsed query), `DoctorReportQueryInput` (the query a client builds), `DoctorStatusEnum` and `DoctorBooleanStringEnum` (the enum entries as `z.enum` types them). Support bundle (#772, experimental): the constants `SUPPORT_BUNDLE_VERSION` (`1`), `SUPPORT_BUNDLE_REDACTION_RULES` (`'v1'`), `SUPPORT_BUNDLE_SECTION_STATUSES` and the types `SupportBundle`, `SupportBundleSectionResult`, `SupportBundleSectionStatus`.

`doctorStatusSchema` lists the statuses in the order the OpenAPI document has always published (`pass, warn, fail, skip`), which is not the severity order; rank with `DOCTOR_STATUS_RANK`, never with the enum's order.

## Data

None. The schemas describe an HTTP payload; the Doctor stores nothing.

## Permissions and settings

None. The route that returns this report is gated by `@marinoscar/platform-api/doctor` (`system_settings:read` by default).

## UI

None. `@marinoscar/platform-web/doctor` renders the report; it imports only the types and the zod-free constants from here.

## Infra

None. Schemas read no environment variable and ship no deployment configuration.

## Observability

None. Validation is pure; the Doctor service logs and traces around it.

## Security notes

`data`, `detail` and `error` are documented as never carrying secret material; the schema cannot enforce that, the check contract in `@marinoscar/platform-api/doctor` does. Never loosen a schema here to accept a payload the API would not send; an app that needs more extends the schema in its own code.

## Conformance suite

None. The slice ships no conformance suite; `test/doctor.test.ts` and `test/dual-format.test.ts` cover the schemas and both module formats, and the app's integration test parses the live route with them.

## Upgrade notes

New in this release (#701). The schemas moved here from `@marinoscar/platform-api/doctor` (`dto/`), and the types from the hand-written mirrors in `@marinoscar/platform-web/doctor/headless`. Both packages still re-export the types and constants under their old names, so no import has to change; `DOCTOR_STATUS_ORDER` and `DoctorReportQuery` in `platform-web` are deprecated aliases of `DOCTOR_STATUSES` and `DoctorReportQueryInput`. The generated OpenAPI document is byte-identical.

#772 adds the support bundle envelope (experimental). It is versioned by `bundleVersion`: adding an optional field is minor; renaming a field, narrowing a type or adding a section status bumps `bundleVersion`.

## Troubleshooting

- **A type error about a missing field after an upgrade.** A contract field was renamed or narrowed, which is a major change: read the changeset's migration note.
- **`zod` appears in the web bundle.** Something imports a schema at run time in browser code; import types with `import type` and constants only.

## Links

- [Package README](../../README.md): the contract conventions
- [Doctor spec](../../../../docs/specs/doctor.md): the check contract and the route
- [`@marinoscar/platform-api/doctor`](../../../platform-api/src/doctor/README.md) and [`@marinoscar/platform-web/doctor`](../../../platform-web/src/doctor/README.md): the two consumers
