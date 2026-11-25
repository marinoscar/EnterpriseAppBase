/**
 * PP-14.23: an app adds a per-run action to the packaged database backup page
 * through `slots.RunRowActions`, with no package edit.
 *
 * `apps/web/src/platform-extensions/db-backup/CopyArchiveKeyAction.example.tsx`
 * is the example. This renders the REAL packaged page
 * (`@marinoscar/platform-web/db-backup/ui`) over MSW responses for the two
 * routes it reads, passes the slot, and asserts the action is drawn for each
 * run, in an extra "More actions" column, from the run the page holds, and is
 * disabled for a run that has no archive. It also pins that the page without
 * the slot draws no such action.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import DbBackupPage from '@marinoscar/platform-web/db-backup/ui';
import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { CopyArchiveKeyAction } from '../../../platform-extensions/db-backup/CopyArchiveKeyAction.example';

const API_BASE = '*/api';

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

const config = {
  enabled: true,
  frequency: 'daily',
  dayOfWeek: 0,
  dayOfMonth: 1,
  timeOfDay: '02:00',
  timezone: 'UTC',
  retentionCount: 7,
  storageProvider: '',
  runStaleMinutes: 120,
  compressionLevel: 6,
  restoreRollbackMode: 'retain_database',
  oldDatabaseRetentionHours: 48,
  nodeOffloadEnabled: false,
  nextRunAt: null,
  activeRunId: null,
  restore: { available: true, reason: null },
};

const run = (overrides: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  status: 'completed',
  trigger: 'scheduled',
  bytesWritten: '1000',
  sizeBytes: '1000',
  storageProvider: 's3',
  storageKey: 'database-backups/app/2026/03/app-1111.dump',
  bucket: 'backups',
  format: 'custom',
  checksumSha256: 'abc',
  verifiedAt: iso(2),
  dbVersion: '17.2',
  appVersion: '1.0.0',
  migrationName: '20260101_init',
  lastError: null,
  startedAt: iso(2),
  finishedAt: iso(2),
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
  createdAt: iso(2),
  updatedAt: iso(2),
  ...overrides,
});

function serve(runs: unknown[]) {
  server.use(
    http.get(`${API_BASE}/admin/db-backup/config`, () => HttpResponse.json({ data: config })),
    http.get(`${API_BASE}/admin/db-backup/runs`, () =>
      HttpResponse.json({ data: { items: runs, total: runs.length, page: 1, pageSize: 20, totalPages: 1 } }),
    ),
  );
}

const renderPage = (withSlot: boolean) =>
  render(<DbBackupPage slots={withSlot ? { RunRowActions: CopyArchiveKeyAction } : undefined} />, {
    wrapperOptions: { user: mockAdminUser, route: '/admin/settings/db-backup' },
  });

describe('the database backup page with an app RunRowActions slot (PP-14.23)', () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it('draws the action for a completed run and copies its storage key', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    serve([run()]);
    renderPage(true);

    const table = await screen.findByTestId('admin-db-backup-table');
    await userEvent.click(await within(table).findByRole('button', { name: 'Copy key' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('database-backups/app/2026/03/app-1111.dump'));
    expect(await within(table).findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'More actions' })).toBeInTheDocument();
  });

  it('disables the action for a run with no archive', async () => {
    serve([run({ status: 'failed', storageKey: null, lastError: 'pg_dump exited with code 1' })]);
    renderPage(true);

    const table = await screen.findByTestId('admin-db-backup-table');
    expect(await within(table).findByRole('button', { name: 'Copy key' })).toBeDisabled();
  });

  it('draws no such action without the slot', async () => {
    serve([run()]);
    renderPage(false);

    const table = await screen.findByTestId('admin-db-backup-table');
    await within(table).findByText(/Scheduled/);
    expect(within(table).queryByRole('button', { name: 'Copy key' })).not.toBeInTheDocument();
  });
});
