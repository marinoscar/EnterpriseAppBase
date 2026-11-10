// The "recent organization export" offboarding precondition (#743 with #744).

import { RECENT_ORG_EXPORT_PRECONDITION_ID, recentOrgExportPrecondition } from '../../src/user-data/index';
import { createFakeDb } from './fake-db';

const ORG = '00000000-0000-4000-8000-0000000000e1';
const NOW = Date.parse('2026-10-08T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000);
const RESULT = {
  storageObjectId: 'o',
  fileName: 'f.zip',
  mimeType: 'application/zip',
  sizeBytes: 10,
  rowCounts: { a: 1 },
  completedAt: new Date(NOW).toISOString(),
  expiresAt: new Date(NOW + 5 * 86_400_000).toISOString(),
};

function job(extra: Record<string, unknown>) {
  return {
    id: `j-${Math.random()}`,
    type: 'export.run',
    subjectType: 'organization',
    subjectId: ORG,
    status: 'succeeded',
    finishedAt: daysAgo(2),
    payload: { source: 'org-data', result: RESULT },
    ...extra,
  };
}

describe('recentOrgExportPrecondition', () => {
  const check = (jobs: unknown[], windowDays?: number) =>
    recentOrgExportPrecondition(windowDays, () => NOW).check({ orgId: ORG }, createFakeDb({ job: jobs as never[] }).client);

  it('passes on a succeeded org-data export of the organization inside the window', async () => {
    await expect(check([job({})])).resolves.toEqual({ passed: true });
  });

  it('fails with no export, an old one, another organization, another source, a failed run or no committed result', async () => {
    await expect(check([])).resolves.toMatchObject({ passed: false });
    await expect(check([job({ finishedAt: daysAgo(8) })])).resolves.toMatchObject({ passed: false });
    await expect(check([job({ subjectId: '00000000-0000-4000-8000-0000000000ff' })])).resolves.toMatchObject({ passed: false });
    await expect(check([job({ payload: { source: 'user-data', result: RESULT } })])).resolves.toMatchObject({ passed: false });
    await expect(check([job({ status: 'failed' })])).resolves.toMatchObject({ passed: false });
    await expect(check([job({ payload: { source: 'org-data' } })])).resolves.toMatchObject({ passed: false });
  });

  it('takes its window from the argument and refuses a bad one', async () => {
    await expect(check([job({ finishedAt: daysAgo(8) })], 10)).resolves.toEqual({ passed: true });
    expect(recentOrgExportPrecondition().id).toBe(RECENT_ORG_EXPORT_PRECONDITION_ID);
    expect(recentOrgExportPrecondition().label).toMatch(/7 days/);
    expect(() => recentOrgExportPrecondition(0)).toThrow();
  });
});
