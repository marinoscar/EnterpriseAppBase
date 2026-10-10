# @marinoscar/platform-contract/user-data

The wire shapes of the user-data slice (issue #743, PP-9.1): the per-user deletion (`/api/user-data/*`), the admin factory reset (`/api/admin/factory-reset/*`) and organization offboarding (`/api/admin/orgs/:orgId/offboarding/*`), as zod schemas plus inferred types and zod-free constants. `@marinoscar/platform-api/user-data` wraps them as DTOs (so the OpenAPI document is generated from them); `@marinoscar/platform-web/user-data` takes the types. It depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

One source for what the three destructive flows accept and return. Categories and scopes are registries in the API slice, so their ids are plain strings here and the count maps are keyed by category id or model name.

Layout: `constants.ts` (zod-free: the three permanent job types, the two built-in scope ids and their phrases, the factory reset phrase, the scope layers, the user dispositions, the job statuses, the error codes, the three permissions and the route paths), `schemas.ts` and `index.ts`.

Not here: the registries, the purge planner, the jobs and the routes (`@marinoscar/platform-api/user-data`), the pages (`@marinoscar/platform-web/user-data`).

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { FACTORY_RESET_CONFIRMATION, userDataSummarySchema } from '@marinoscar/platform-contract/user-data';
import type { UserDataSummary, UserDataDeletionStatus } from '@marinoscar/platform-contract/user-data';
```

None beyond the package's own peer, `zod` (`^4.4.3`). A browser that imports only the constants and the types never bundles `zod` (`constants.ts` imports no zod).

## Quick start

The web slice types its client with these shapes ([`apps/web/src/App.tsx`](../../../../apps/web/src/App.tsx) mounts the pages that read them):

```ts
import type { UserDataSummary } from '@marinoscar/platform-contract/user-data';
const summary: UserDataSummary = await api.get('/user-data/summary');
```

## Configuration

None. Schemas and constants take no options.

## Extension-point catalog

None. The contract declares shapes; adding a category, a scope, a factory reset step or an offboarding precondition is a registry of `@marinoscar/platform-api/user-data`, not a contract change.

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

Supporting exports (experimental): `USER_DATA_PURGE_JOB_TYPE`, `FACTORY_RESET_JOB_TYPE`, `ORG_OFFBOARD_JOB_TYPE`, `USER_DATA_EVERYTHING_SCOPE`, `USER_DATA_CONTENT_SCOPE`, `USER_DATA_EVERYTHING_CONFIRMATION`, `USER_DATA_CONTENT_CONFIRMATION`, `FACTORY_RESET_CONFIRMATION`, `FACTORY_RESET_BACKUP_PATH`, `USER_DATA_SCOPE_LAYERS`, `OFFBOARDING_USER_DISPOSITIONS`, `USER_DATA_JOB_STATUSES`, `USER_DATA_ERROR_CODES`, `USER_DATA_PERMISSION`, `FACTORY_RESET_PERMISSION`, `ORG_OFFBOARD_PERMISSION`, `USER_DATA_PATHS`; the schemas `userDataSummarySchema`, `userDataCategorySummarySchema`, `userDataScopeSchema`, `userDataDeletionRequestSchema`, `userDataJobStartedSchema`, `userDataPurgeResultSchema`, `userDataDeletionStatusSchema`, `factoryResetRequestSchema`, `factoryResetSummarySchema`, `factoryResetResultSchema`, `factoryResetStatusSchema`, `orgOffboardingRequestSchema`, `orgOffboardingSummarySchema`, `orgOffboardingResultSchema`, `orgOffboardingStatusSchema`, `offboardingPreconditionResultSchema`, and their types.

## Data

None. The contract owns no table. A job's result lives on its own `jobs.payload.result` (the queue has no result column).

## Permissions and settings

Declares none. `USER_DATA_PERMISSION` (`user_settings:write`), `FACTORY_RESET_PERMISSION` (`system:factory_reset`) and `ORG_OFFBOARD_PERMISSION` (`orgs:offboard`) name the strings the API slice enforces, for a client's own checks. No settings namespace.

## UI

None. Types only.

## Infra

None.

## Observability

None. The API slice records the metrics and audit events.

## Security notes

`factoryResetRequestSchema` is a zod literal, so anything but `FACTORY RESET` is a `400` before the service runs. The deletion's phrase depends on the scope, so the wire type is a string and the API re-checks it with a literal built from the scope registry. No schema carries row contents: results are counts only.

## Conformance suite

None in the contract. The API slice's `user-data` suite checks the registries; `test/user-data.test.ts` pins these shapes.

## Upgrade notes

First release (#743). Every result map defaults to `{}` and every count to `0`, so a result an older job wrote still parses.

## Troubleshooting

A deletion answers `400` `CONFIRMATION_MISMATCH`: the phrase must be the scope's `confirmation`, exactly (case and spacing included), as `GET /api/user-data/summary` lists it.

## Links

- [docs/specs/user-data-reset.md](../../../../docs/specs/user-data-reset.md): the design.
- [`@marinoscar/platform-api/user-data`](../../../platform-api/src/user-data/README.md) and [`@marinoscar/platform-web/user-data`](../../../platform-web/src/user-data/README.md).
