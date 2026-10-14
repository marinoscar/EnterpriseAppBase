import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseLock, readAppMigrations, type PlatformLock } from '@marinoscar/platform-db';

/** The reference app's own `prisma/` directory. */
export const APP_PRISMA = join(__dirname, '..', '..', '..', 'prisma');

/** The directory name the example migration would get from `prisma migrate dev` (after every installed one). */
export const COACH_NOTES_DIR = '20270101000000_add_coach_notes';

export const COACH_NOTES_SQL = readFileSync(join(__dirname, 'coach-notes.migration.sql'), 'utf8');
export const COACH_NOTES_FRAGMENT = readFileSync(join(__dirname, 'coach-notes.prisma'), 'utf8');

/** The index definition exactly as `pg_indexes.indexdef` prints it (the DB spec asserts it against Postgres). */
export const COACH_NOTES_INDEX_DEFINITION =
  'CREATE UNIQUE INDEX coach_notes_notification_plain_uniq_idx ON public.coach_notes USING btree (notification_id) WHERE ((grant_id IS NULL) AND (notification_id IS NOT NULL))';

/** What `platform db policies` prints for the example's policy (USING and WITH CHECK are the same expression). */
export const COACH_NOTES_POLICY_HASH = '83e7bb1689b1bd0427e7061bf085f69c35922ba56bedf6275925f52e58cb440b';

/** The reference app's real lock, plus the example's lock entries. */
export function lockWithCoachNotes(): PlatformLock {
  const real = parseLock(readFileSync(join(APP_PRISMA, 'platform.lock'), 'utf8'));
  return {
    ...real,
    rawSqlIndexes: [...(real.rawSqlIndexes ?? []), { name: 'coach_notes_notification_plain_uniq_idx', definition: COACH_NOTES_INDEX_DEFINITION }],
    rlsPolicies: [
      ...(real.rlsPolicies ?? []),
      { name: 'coach_notes_org_isolation', table: 'coach_notes', usingSha256: COACH_NOTES_POLICY_HASH, checkSha256: COACH_NOTES_POLICY_HASH },
    ],
  };
}

/** The reference app's real migration history, plus the example migration after it. */
export function historyWithCoachNotes(): Array<[string, string]> {
  return [...readAppMigrations(join(APP_PRISMA, 'migrations')), [COACH_NOTES_DIR, COACH_NOTES_SQL]];
}
