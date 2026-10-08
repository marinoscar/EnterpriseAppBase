// =============================================================================
// The backup-run list's filters (issue #283, epic #254)
// =============================================================================
//
// Four query parameters and no more. `page`/`pageSize` are copied field for
// field from `jobs/dto/job-list-query.dto.ts` — which copied them from
// `users/dto/user-list-query.dto.ts` — so that every paginated list in this API
// takes the same names and enforces the same 100-row ceiling. A client that has
// learned one of these lists has learned all of them.
//
// `status` and `trigger` are plain equality matches on the two enums the row
// carries, and they are the two questions an operator actually asks of this
// table: "show me the failures" and "which of these did a person start".
//
// -----------------------------------------------------------------------------
// WHAT IS DELIBERATELY NOT OFFERED
// -----------------------------------------------------------------------------
//
// NO DATE WINDOW, and no `processedWithin` equivalent. The jobs list needs one
// because a queue accumulates thousands of rows an hour; this table gains ONE
// ROW PER BACKUP — a nightly schedule with the default retention of 7 keeps a
// handful, and even a deployment that has been failing for a year has a few
// hundred. Newest-first pagination answers every question a window would, and a
// filter nobody needs is still a filter that has to be documented, tested and
// kept correct.
//
// NO SORT PARAMETER. The ordering is `createdAt DESC`, always, and it is served
// by the `[status, createdAt DESC]` index the retention sweep already uses. A
// sortable column set would need an index per column to stay usable, which is a
// real cost for a table whose only interesting order is "what happened most
// recently".
// =============================================================================

import { createZodDto } from 'nestjs-zod';

import {
  backupRunListQuerySchema,
} from '@marinoscar/platform-contract/db-backup';

// The wire shapes live in `@marinoscar/platform-contract/db-backup` (#740);
// re-exported so every importer of this file keeps its import.
export {
  backupRunListQuerySchema,
} from '@marinoscar/platform-contract/db-backup';
export type {
  BackupRunListQuery,
} from '@marinoscar/platform-contract/db-backup';

export class BackupRunListQueryDto extends createZodDto(backupRunListQuerySchema) {}

