# @marinoscar/platform-contract/db-backup

The wire contract of the database backup and restore slice (issue #740, PP-8.7), as zod schemas with their inferred types, plus the zod-free value lists: the `databaseBackup` system-settings namespace (`systemDatabaseBackupSchema` and its partial, the PUT and PATCH branches `databaseBackupSettingsSchema` / `databaseBackupSettingsPatchSchema`, the GET branch `databaseBackupResponseSchema`), every admin route under `/api/admin/db-backup` (config, runs, actions, restore, rollback, node-credential pre-flight) and the result a worker node posts for `db.backup.run` (`dbBackupRunResultSchema`). `@marinoscar/platform-api/db-backup` wraps them as DTOs; `@marinoscar/platform-web/db-backup` reads their types and value lists. It depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

One definition of what crosses the wire for backups and restores, so the API's validation, its OpenAPI document, the node's result and the web page's types cannot drift. `constants.ts` holds the status, trigger and restore-status lists, the two confirmation words (`RESTORE`, `ROLLBACK`), the restore and rollback modes, the pre-flight gate ids (`RESTORE_GATE_IDS`, `rls_bypass` included) and the schedule's `HH:MM` pattern, zod-free.

Not here: the engine, the services and the routes (the API slice), the page (the web slice), the row-to-response projections (`toRunDto`, `toPreflightView`, ...), which read the Prisma row and stay in the API slice.

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { backupRunSchema, RESTORE_CONFIRMATION } from '@marinoscar/platform-contract/db-backup';
import type { BackupRunResponse, DatabaseBackupConfigResponse } from '@marinoscar/platform-contract/db-backup';
```

None beyond the package's own peer, `zod` (`^4.4.3`).

## Quick start

The API slice wraps a body as a DTO; the reference app's settings schemas re-export the namespace's ([`settings.schema.ts`](../../../../apps/api/src/common/schemas/settings.schema.ts)):

```ts
import { createZodDto } from 'nestjs-zod';
import { startRestoreRequestSchema } from '@marinoscar/platform-contract/db-backup';

export class StartRestoreRequestDto extends createZodDto(startRestoreRequestSchema) {}
```

## Configuration

None. Schemas and constants take no options.

## Extension-point catalog

None. The shapes are the closed contract of the slice's routes, its settings namespace and its node result. A fork extends the restore with a carry-over (`RestoreCarryOver`, in the API slice), never by widening these shapes.

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

## Data

No tables. `systemDatabaseBackupSchema` is the `databaseBackup` value of the `global` system-settings row. `bytesWritten` and `sizeBytes` are decimal strings on the way out (`JSON.stringify` refuses a `bigint`), and the node result's `bytes` is a decimal string on the way in (a JSON number loses precision above 2^53, exactly on the largest dumps). Dates are ISO strings.

## Permissions and settings

None declared here. The routes carrying these shapes are gated by `db_backup:read`, `db_backup:write` and `db_backup:restore` (system scope, `admin`), and the namespace by `system_settings:*` through `/api/system-settings`.

## UI

None. The page is `@marinoscar/platform-web/db-backup/ui`.

## Infra

None.

## Observability

None. The package emits nothing at run time.

## Security notes

The restore and rollback bodies require a typed literal (`RESTORE`, `ROLLBACK`), never `confirm: true`: a replayed or retried POST cannot reconstruct one by accident. The config response's `restore.available` is a deployment fact (`DEPLOYMENT_MODE`), never settable through `PUT config`. The node result carries no credential: the job-scoped database role is brokered through the jobs slice and never echoed back.

## Conformance suite

None of its own. The API slice's specs pin the restore-status and gate-id lists against the services that emit them.

## Upgrade notes

New in this version. The shapes are unchanged from the reference app's `db-backup/dto/`, `jobs/contracts/db-backup-run.contract.ts` and `common/schemas/`; the OpenAPI document is identical except for the new `rls_bypass` gate id.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A restore answers 400 for `{ "confirm": true }` | By design: the body wants `confirmation: "RESTORE"` | Send the literal |
| `bytes` is refused in a node result | It must be a decimal string of up to 20 digits | Send `"1234"`, never `1234` |

## Links

- [Package README](../../README.md)
- [The API slice](../../../platform-api/src/db-backup/README.md)
- [The web slice](../../../platform-web/src/db-backup/README.md)
- [Contract conventions](../../../../docs/PACKAGES.md#contract-conventions)
