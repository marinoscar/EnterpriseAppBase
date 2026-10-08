# @marinoscar/platform-contract/jobs

The admin job routes' wire shapes (issue #734, PP-8.2), as zod schemas with their inferred types, plus the zod-free status, reason and window lists. `@marinoscar/platform-api/jobs` wraps every schema with `createZodDto` (its `dto/` files); a web client or a script that reads `GET /api/admin/jobs` types its data with these. It depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

One definition of what the queue's admin API accepts and returns: the job list query and row (`jobListQuerySchema`, `jobSchema`, `orgId` included since #734), the summary (`jobStatsSchema`), the insights (`jobInsightsQuerySchema`, `jobInsightsSchema`) and the bulk actions (`retryFailedSchema`, `resetStuckSchema` and their results). `constants.ts` holds `JOB_STATUSES`, `JOB_REASONS`, `PROCESSED_WITHIN_VALUES`, `PROCESSED_WITHIN_MS`, the insights window bounds and `JOB_ETA_BASES`, zod-free.

Not here: the queue itself, the handler contract and the services (`@marinoscar/platform-api/jobs`), and node **result** schemas. Those stay with their handlers and cross to nodes as JSON Schema through `GET /api/nodes/job-types` (the reference app's [`jobs/contracts/README.md`](../../../../apps/api/src/jobs/contracts/README.md) explains why).

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { JOB_STATUSES, jobSchema } from '@marinoscar/platform-contract/jobs';
import type { JobListQuery } from '@marinoscar/platform-contract/jobs';
```

None beyond the package's own peer, `zod` (`^4.4.3`).

## Quick start

The API slice's list DTO wraps the schema ([`job-type-snapshot.spec.ts`](../../../../apps/api/test/jobs/job-type-snapshot.spec.ts) reads the served rows):

```ts
import { createZodDto } from 'nestjs-zod';
import { jobListQuerySchema } from '@marinoscar/platform-contract/jobs';

export class JobListQueryDto extends createZodDto(jobListQuerySchema) {}
```

## Configuration

None. Schemas and constants take no options.

## Extension-point catalog

None. The schemas describe the platform's own routes; an app that adds a field to its own job route extends a schema with `.extend()` in app code.

Supporting exports (experimental unless tagged stable): the constants above, every `*Schema` of `schemas.ts` and of `settings-schemas.ts` (stable) the inferred types `JobListQuery`, `JobInsightsQuery`, `JobDurationStats`, `JobStatusCounts`, `JobStatusName`, `ProcessedWithin`, `JobEtaBasis`, and the enum entry types `JobStatusEnum`, `JobReasonEnum`, `ProcessedWithinEnum`, `JobEtaBasisEnum`, `JobBooleanFlagEnum`.

## Data

No tables. `jobSchema` mirrors the public columns of `jobs` (the `jobs` fragment of `@marinoscar/platform-db`) minus `payload`, `claimToken` and `traceContext`, plus the server-resolved `typeLabel`. `orgId` is `null` for a deployment-wide (system) job. Dates are ISO strings; always-present fields are `.nullable()`.

## Permissions and settings

None declared here. The routes these shapes describe require `jobs:read` / `jobs:write` (`@marinoscar/platform-api/jobs`). The `jobs` system-settings namespace's schemas are here (`settings-schemas.ts`, #865): `systemJobsSchema`, `systemJobsPatchSchema`, `jobsSettingsSchema`, `jobsSettingsPatchSchema`, `jobsResponseSchema`, with `SystemJobsValue` and `JobsSettingsPatchInput`; its declaration is `JOBS_SYSTEM_SETTINGS` of `@marinoscar/platform-api/jobs`.

## UI

None. The jobs and workers pages are still in the reference web app (a follow-up moves them to `@marinoscar/platform-web`).

## Infra

None.

## Observability

None. The package emits nothing at run time.

## Security notes

`jobSchema` has no field able to carry a job's `payload` (arbitrary handler input) or its claim token. Keep it that way: a list endpoint that a dashboard polls must not publish unbounded handler input.

## Conformance suite

None of its own. `test/jobs-nodes.test.ts` parses representative rows and queries; the API slice's specs exercise the DTOs end to end.

## Upgrade notes

New in this version: the schemas moved here from `@marinoscar/platform-api/jobs`'s `dto/` files, unchanged except for the additive `orgId` (row) and `orgId` (list filter). The API still re-exports them under the same names.

#865: the `jobs` settings namespace's five schemas moved here from the reference app's `common/schemas/` files, unchanged (the app re-exports them under the same names).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `orgId` fails to parse on the list query | Not a UUID | Pass an organization id, or omit the filter for every job |

## Links

- [Package README](../../README.md)
- [The API slice](../../../platform-api/src/jobs/README.md)
- [Contract conventions](../../../../docs/PACKAGES.md#contract-conventions)
