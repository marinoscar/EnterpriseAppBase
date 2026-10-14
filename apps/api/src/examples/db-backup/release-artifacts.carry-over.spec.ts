import { restoreCarryOverRegistry } from '@marinoscar/platform-api/db-backup';
import { checkCarryOvers } from '@marinoscar/platform-api/db-backup/testing';
import { withTemporaryEntries } from '@marinoscar/platform-api/core';

import { RELEASE_ARTIFACTS_CARRY_OVER } from './release-artifacts.carry-over';

// The reference example of a RestoreCarryOver (#740). The restore path itself
// (export from the live database before the swap, one `$1::jsonb` upsert per
// row into the promoted one after it) is proved in the package's
// `database-restore.service.spec.ts`; this proves the example is a carry the
// registry accepts and the conformance suite can require.
describe('RELEASE_ARTIFACTS_CARRY_OVER', () => {
  it('registers, orders after the built-in carries and binds its row as $1', async () => {
    await withTemporaryEntries(restoreCarryOverRegistry, [RELEASE_ARTIFACTS_CARRY_OVER], () => {
      expect(restoreCarryOverRegistry.get('release_artifacts')).toBe(RELEASE_ARTIFACTS_CARRY_OVER);
      expect(RELEASE_ARTIFACTS_CARRY_OVER.reinsertSql).toContain('$1::jsonb');
      expect(RELEASE_ARTIFACTS_CARRY_OVER.reinsertSql).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
      expect(checkCarryOvers(['release_artifacts'])).toEqual([]);
    });
  });

  it('is not registered by the reference app, which has no such table', () => {
    expect(restoreCarryOverRegistry.has('release_artifacts')).toBe(false);
    expect(checkCarryOvers(['release_artifacts'])).toHaveLength(1);
  });
});
