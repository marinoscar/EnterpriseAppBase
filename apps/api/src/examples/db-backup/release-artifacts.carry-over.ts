// =============================================================================
// Reference example: a restore carry-over (issue #740)
// =============================================================================
//
// A restore replaces the live database with an archive, so a row written
// after that archive was taken is gone. That is right for almost every table
// and wrong for a table that records something that happened OUTSIDE the
// database: here, a fork's `release_artifacts` table, one row per build
// uploaded to object storage. Restoring last week's database must not forget
// this week's uploads, whose files are still in the bucket.
//
// The fork declares the table's carry ONCE, and passes it to the slice:
//
//   DbBackupModule.forRoot({ extraCarryOver: [RELEASE_ARTIFACTS_CARRY_OVER], ... })
//
// (or calls `registerRestoreCarryOver(RELEASE_ARTIFACTS_CARRY_OVER)` from a
// module-level file the app imports before bootstrap). The restore then reads
// every row from the live database before the swap and upserts each into the
// promoted one after it, as `$1::jsonb`.
//
// The reference app has no `release_artifacts` table, so it does NOT register
// this carry (a carry whose `exportSql` fails is logged as CRITICAL on every
// restore). `release-artifacts.carry-over.spec.ts` registers it temporarily
// and drives a restore's carry path to prove the round trip.
// =============================================================================

import type { RestoreCarryOver } from '@marinoscar/platform-api/db-backup';

/** The fork's `release_artifacts` rows survive a restore. */
export const RELEASE_ARTIFACTS_CARRY_OVER: RestoreCarryOver = Object.freeze({
  id: 'release_artifacts',
  // After the four built-in carries; a carry that references this table
  // would take a higher order.
  order: 10,
  exportSql: 'SELECT * FROM release_artifacts ORDER BY created_at',
  reinsertSql:
    'INSERT INTO release_artifacts ' +
    'SELECT * FROM jsonb_populate_record(NULL::release_artifacts, $1::jsonb) ' +
    'ON CONFLICT (id) DO UPDATE SET ' +
    'storage_key = EXCLUDED.storage_key, sha256 = EXCLUDED.sha256, is_current = EXCLUDED.is_current',
});
