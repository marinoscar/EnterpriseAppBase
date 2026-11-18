import { RAW_SQL_INDEXES } from '@marinoscar/platform-db';

import { alertsConformanceSuite, checkAlertsStatic } from '../../src/alerts/testing/index';
import { conformanceSuites } from '../../src/testing/index';

describe('alerts conformance suite', () => {
  it('registers itself with the harness on import', () => {
    expect(conformanceSuites.has('alerts')).toBe(true);
  });

  it('finds no violation in the slice', () => {
    expect(checkAlertsStatic({ rawSqlIndexNames: RAW_SQL_INDEXES.map((i) => i.name) })).toEqual([]);
  });

  it('flags a missing raw-SQL index entry', () => {
    expect(checkAlertsStatic({ rawSqlIndexNames: [] }).map((f) => f.file)).toEqual(['raw-sql-indexes']);
  });

  it('runs every case it registers', async () => {
    const report = alertsConformanceSuite.check({ sourceRoots: [] }, { rawSqlIndexNames: RAW_SQL_INDEXES.map((i) => i.name) });
    for (const testCase of alertsConformanceSuite.cases({ rawSqlIndexNames: [] })) {
      await testCase.run(report, expect as never);
    }
  });
});
