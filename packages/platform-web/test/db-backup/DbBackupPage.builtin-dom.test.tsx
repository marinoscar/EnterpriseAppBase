/**
 * The database backup page's markup did not move (PP-14.12).
 *
 * `DbBackupPage` gained `slots.Sections` (and the policy panel a `cron`
 * schedule field that renders only for `frequency: 'cron'`). The snapshot
 * beside this file (`__snapshots__/`) was RECORDED FROM THE PAGE AS IT WAS
 * BEFORE THAT CHANGE (the same fixtures, rendered by the old `DbBackupPage`),
 * so passing means the page an administrator sees with no slot passed is,
 * element for element and class for class, the one they had: the policy panel,
 * the run history and the restore actions, in every state below.
 *
 * The only normalisation is React's generated ids (`_r_1f_`), which depend on
 * render order; the markup around them is what is compared. Re-record only for
 * a deliberate change of the page.
 */
import { act, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

import { PlatformHostProvider } from '../../src/core/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import { DbBackupWebAdaptersProvider } from '../../src/db-backup/headless/index.js';
import type { DbBackupApi, DbBackupConfig, DbBackupRun } from '../../src/db-backup/headless/index.js';
import DbBackupPage from '../../src/db-backup/ui/DbBackupPage.js';

const NOW = new Date('2026-03-02T12:00:00.000Z');

const CONFIG: DbBackupConfig = {
  enabled: true,
  frequency: 'daily',
  dayOfWeek: 0,
  dayOfMonth: 1,
  timeOfDay: '02:30',
  timezone: 'UTC',
  retentionCount: 7,
  storageProvider: '',
  runStaleMinutes: 180,
  compressionLevel: 6,
  restoreRollbackMode: 'retain_database',
  oldDatabaseRetentionHours: 48,
  nextRunAt: '2026-03-03T02:30:00.000Z',
  activeRunId: null,
  restore: { available: true, reason: null },
};

const COMPLETED: DbBackupRun = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'completed',
  trigger: 'scheduled',
  bytesWritten: '1200000000',
  sizeBytes: '1200000000',
  storageProvider: 's3',
  storageKey: 'database-backups/app/2026/03/app-20260302T023000Z-1111.dump',
  bucket: 'backups',
  format: 'custom',
  checksumSha256: 'abc123',
  verifiedAt: '2026-03-02T02:40:00.000Z',
  dbVersion: '17.2',
  appVersion: '1.0.0',
  migrationName: '20260101_init',
  lastError: null,
  startedAt: '2026-03-02T02:30:00.000Z',
  finishedAt: '2026-03-02T02:40:00.000Z',
  lastHeartbeatAt: null,
  createdById: null,
  restoreStatus: null,
  restoreError: null,
  restoredAt: null,
  restoredById: null,
  restoreScratchDb: null,
  restoreOldDb: null,
  swappedAt: null,
  preRestoreBackupId: null,
  createdAt: '2026-03-02T02:30:00.000Z',
  updatedAt: '2026-03-02T02:40:00.000Z',
};

const FAILED: DbBackupRun = {
  ...COMPLETED,
  id: '22222222-2222-4222-8222-222222222222',
  status: 'failed',
  trigger: 'manual',
  bytesWritten: '5000',
  sizeBytes: '0',
  checksumSha256: null,
  verifiedAt: null,
  lastError: 'pg_dump exited with code 1',
  startedAt: '2026-03-01T10:00:00.000Z',
  finishedAt: '2026-03-01T10:01:00.000Z',
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:01:00.000Z',
};

const RUNNING: DbBackupRun = {
  ...COMPLETED,
  id: '33333333-3333-4333-8333-333333333333',
  status: 'running',
  trigger: 'manual',
  bytesWritten: '600000000',
  sizeBytes: '0',
  checksumSha256: null,
  verifiedAt: null,
  finishedAt: null,
  lastHeartbeatAt: '2026-03-02T11:59:30.000Z',
  startedAt: '2026-03-02T11:50:00.000Z',
  createdAt: '2026-03-02T11:50:00.000Z',
};

const html = (root: Element): string => root.innerHTML.replace(/_r_[0-9a-z]+_/g, '_rX_');

function mockApi(config: DbBackupConfig, runs: DbBackupRun[]): DbBackupApi {
  return {
    getDbBackupConfig: vi.fn().mockResolvedValue(config),
    updateDbBackupConfig: vi.fn(),
    getBackupRuns: vi
      .fn()
      .mockResolvedValue({ items: runs, total: runs.length, page: 1, pageSize: 20, totalPages: 1 }),
    getBackupRun: vi.fn(),
    startBackupRun: vi.fn(),
    cancelBackupRun: vi.fn(),
    deleteBackupRun: vi.fn(),
    getBackupDownloadUrl: vi.fn(),
    startRestore: vi.fn(),
    rollbackRestore: vi.fn(),
  } as unknown as DbBackupApi;
}

async function mount(
  config: DbBackupConfig,
  runs: DbBackupRun[],
  permissions: readonly string[] = ['db_backup:read', 'db_backup:write', 'db_backup:restore'],
): Promise<string> {
  const host = createTestPlatformHost({ permissions });
  const adapters = { api: mockApi(config, runs) };
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <MemoryRouter initialEntries={['/admin/settings/db-backup']}>
        <PlatformHostProvider host={host}>
          <DbBackupWebAdaptersProvider adapters={adapters}>{children}</DbBackupWebAdaptersProvider>
        </PlatformHostProvider>
      </MemoryRouter>
    );
  }
  const { container, unmount } = rtlRender(<DbBackupPage />, { wrapper: Wrapper });
  await screen.findByText('Database Backup');
  await waitFor(() => {
    if (runs.length > 0) expect(container.textContent).toContain('Scheduled');
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  const out = html(container);
  unmount();
  return out;
}

describe("the database backup page's markup is unchanged", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('a daily schedule, a completed and a failed run, a full administrator', async () => {
    expect(await mount(CONFIG, [COMPLETED, FAILED])).toMatchSnapshot();
  });

  it('a weekly schedule with a run in flight', async () => {
    expect(
      await mount({ ...CONFIG, frequency: 'weekly', dayOfWeek: 3, activeRunId: RUNNING.id }, [RUNNING, COMPLETED]),
    ).toMatchSnapshot();
  });

  it('a read-only viewer', async () => {
    expect(await mount(CONFIG, [COMPLETED, FAILED], ['db_backup:read'])).toMatchSnapshot();
  });

  it('a deployment that offers no in-app restore', async () => {
    expect(
      await mount({ ...CONFIG, restore: { available: false, reason: 'deployment_mode_saas' } }, [COMPLETED]),
    ).toMatchSnapshot();
  });
});
