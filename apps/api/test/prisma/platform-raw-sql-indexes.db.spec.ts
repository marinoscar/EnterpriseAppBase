// =============================================================================
// Real-Postgres test: the package's raw-SQL index list matches the catalogue
// (issue #710, PP-5.3)
// =============================================================================
//
// `prisma migrate diff` ignores partial and expression indexes in both
// directions, so the drift test asserts a list of them positively
// (`RAW_SQL_INDEXES`, read from `packages/platform-db/raw-sql-indexes.json`).
// That list is only a guard if it is complete, so this tripwire DERIVES the
// set from `pg_indexes` (every index whose definition has a WHERE clause or an
// expression key) and demands it equals the list: an unlisted raw-SQL index fails the build, and so does a
// listed one that is gone or has a different definition.
//
// Runs against the shared, migrated test database (`npm run test:db`, after
// `prisma:migrate`). Needs `npm run build:packages` first.
// =============================================================================

import { RAW_SQL_INDEXES, checkRawSqlIndexes, isRawSqlIndex } from '@marinoscar/platform-db';

import { createDbClient, resolveDbSuite } from '../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('platform-raw-sql-indexes.db.spec');

describeWithDb('platform raw-SQL index list against the migrated schema (real Postgres)', () => {
  const prisma = createDbClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function liveIndexes(): Promise<{ name: string; definition: string }[]> {
    return prisma.$queryRaw<{ name: string; definition: string }[]>`
      SELECT indexname AS name, indexdef AS definition FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`;
  }

  it('every listed index exists with its recorded definition', async () => {
    expect(checkRawSqlIndexes(RAW_SQL_INDEXES, await liveIndexes())).toEqual([]);
  });

  it('every partial or expression index in the catalogue is listed (the list is complete)', async () => {
    const listed = new Set(RAW_SQL_INDEXES.map((i) => i.name));
    const derived = (await liveIndexes()).filter((row) => isRawSqlIndex(row.definition)).map((row) => row.name);
    expect(derived.sort()).toEqual([...listed].sort());
  });
});
