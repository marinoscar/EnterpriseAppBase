import { EXPORT_FAILED_MESSAGE, exportSchema } from '@marinoscar/platform-contract/exports';

import { deriveExportStatus, readExportResult, resolveExportsModuleOptions, toExportView, exportFileSlug, type ExportResult } from '../../src/exports';
import { FIXTURE_DATAMODEL, UUID } from './support';

const NOW = new Date('2026-10-08T10:00:00.000Z');
const result: ExportResult = {
  storageObjectId: UUID.object,
  fileName: 'app-user-data-2026-10-08.json',
  mimeType: 'application/json',
  sizeBytes: 10,
  rowCounts: { account: 1 },
  completedAt: '2026-10-08T09:00:00.000Z',
  expiresAt: '2026-10-15T09:00:00.000Z',
};
const payload = {
  source: 'user-data',
  format: 'json',
  request: {},
  requestedById: UUID.user,
  scope: 'user',
  subjectId: UUID.user,
  orgId: UUID.orgA,
};

describe('export status derivation (EvoPath rules)', () => {
  it.each([
    ['pending', null, false, 'pending'],
    ['running', null, false, 'running'],
    ['succeeded', null, false, 'failed'],
    ['failed', null, false, 'failed'],
    ['succeeded', result, true, 'ready'],
    ['succeeded', result, false, 'expired'],
    ['running', result, true, 'ready'],
  ] as const)('job %s, result %#, object %s -> %s', (jobStatus, res, objectExists, expected) => {
    expect(deriveExportStatus({ jobStatus, result: res, objectExists, now: NOW })).toBe(expected);
  });

  it('is expired past expiresAt even when the object still exists', () => {
    expect(deriveExportStatus({ jobStatus: 'succeeded', result, objectExists: true, now: new Date('2026-10-16T00:00:00.000Z') })).toBe('expired');
  });

  it('reads a result only when it parses', () => {
    expect(readExportResult({ ...payload, result })).toEqual(result);
    expect(readExportResult({ ...payload, result: { storageObjectId: 1 } })).toBeNull();
    expect(readExportResult(null)).toBeNull();
    expect(readExportResult([])).toBeNull();
  });

  it('builds a contract-valid view; a failed export carries the fixed message, never lastError', () => {
    const job = { id: UUID.job, status: 'failed', payload, createdAt: NOW, finishedAt: NOW };
    const view = toExportView(job, false, NOW)!;
    expect(exportSchema.parse(view)).toEqual(view);
    expect(view.status).toBe('failed');
    expect(view.error).toBe(EXPORT_FAILED_MESSAGE);
    expect(view.download).toBeNull();

    const ready = toExportView({ ...job, status: 'succeeded', payload: { ...payload, result } }, true, NOW)!;
    expect(ready).toMatchObject({ status: 'ready', fileName: result.fileName, sizeBytes: 10, rowCounts: { account: 1 }, error: null, orgId: null });
    expect(toExportView({ ...job, payload: { not: 'an export' } }, false, NOW)).toBeNull();
    expect(toExportView({ ...job, payload: { ...payload, scope: 'org', subjectId: UUID.orgB } }, false, NOW)!.orgId).toBe(UUID.orgB);
  });
});

describe('ExportsModule options', () => {
  it('applies EvoPath defaults', () => {
    const resolved = resolveExportsModuleOptions({ datamodel: FIXTURE_DATAMODEL });
    expect(resolved).toMatchObject({
      retentionDays: 7,
      downloadUrlTtlSeconds: 300,
      maxInFlightPerSubject: 3,
      jobProfile: { maxRuntimeMs: 15 * 60 * 1000, maxAttempts: 2 },
      purgeProfile: { maxRuntimeMs: 30 * 60 * 1000, maxAttempts: 3 },
      platformSources: { userData: true, orgData: true },
    });
    expect(resolved.appSlug()).toBe('app');
  });

  it('refuses a missing datamodel, bad numbers and profile keys beyond the two', () => {
    expect(() => resolveExportsModuleOptions({} as never)).toThrow(/datamodel is required/);
    expect(() => resolveExportsModuleOptions({ datamodel: FIXTURE_DATAMODEL, retentionDays: 0 })).toThrow(/retentionDays/);
    expect(() =>
      resolveExportsModuleOptions({ datamodel: FIXTURE_DATAMODEL, jobProfile: { maxRuntimeMs: 1, maxAttempts: 1, leaseMs: 5 } as never }),
    ).toThrow(/only maxRuntimeMs and maxAttempts/);
    expect(() => resolveExportsModuleOptions({ datamodel: FIXTURE_DATAMODEL, legacyJobTypes: [{ type: 'x', handles: 'other' as never }] })).toThrow(
      /handles/,
    );
  });

  it('slugs the app name for file names', () => {
    expect(exportFileSlug('My App!')).toBe('my-app');
    expect(exportFileSlug('Évo Path')).toBe('evo-path');
    expect(exportFileSlug('***')).toBe('app');
    expect(resolveExportsModuleOptions({ datamodel: FIXTURE_DATAMODEL, appSlug: () => 'Acme Corp' }).appSlug()).toBe('acme-corp');
  });
});
