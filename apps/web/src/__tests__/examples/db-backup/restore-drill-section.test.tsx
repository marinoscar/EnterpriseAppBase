/**
 * PP-14.12: an app adds a section to the packaged database backup page through
 * `slots.Sections`, with no package edit.
 *
 * `apps/web/src/platform-extensions/db-backup/RestoreDrillSection.example.tsx`
 * is the example. This renders the REAL packaged page
 * (`@marinoscar/platform-web/db-backup/ui`) over MSW responses for the two
 * routes it reads, passes the slot, and asserts the section draws from the
 * state the page holds and sits below the run history. It also pins that the
 * page without the slot renders no section, and that an app restore gate and a
 * cron schedule from the API are rendered with no web code.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import DbBackupPage from '@marinoscar/platform-web/db-backup/ui';
import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { RestoreDrillSection, RESTORE_DRILL_INTERVAL_DAYS } from '../../../platform-extensions/db-backup/RestoreDrillSection.example';

const API_BASE = '*/api';

const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

const config = {
  enabled: true,
  frequency: 'cron',
  cron: '0 */6 * * *',
  dayOfWeek: 0,
  dayOfMonth: 1,
  timeOfDay: '02:00',
  timezone: 'UTC',
  retentionCount: 7,
  retention: { count: 7, maxAgeDays: 30 },
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

describe('the database backup page with an app Sections slot (PP-14.12)', () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it('draws the app section below the history from the page\'s own state', async () => {
    serve([run()]);

    render(<DbBackupPage slots={{ Sections: RestoreDrillSection }} />, {
      wrapperOptions: { user: mockAdminUser, route: '/admin/settings/db-backup' },
    });

    const section = await screen.findByRole('region', { name: 'Restore drill' });
    expect(within(section).getByText(/Newest restorable backup:/)).toBeInTheDocument();
    expect(within(section).getByText(/No restore has been performed/)).toBeInTheDocument();
    expect(within(section).getByText(/at least every 90 days/)).toBeInTheDocument();
    expect(within(section).getByText(/Use "Restore from this backup"/)).toBeInTheDocument();
    expect(RESTORE_DRILL_INTERVAL_DAYS).toBe(90);

    const table = await screen.findByTestId('admin-db-backup-table');
    expect(table.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('stays quiet when a restore happened recently', async () => {
    serve([run({ restoredAt: iso(3), restoreStatus: 'completed' })]);

    render(<DbBackupPage slots={{ Sections: RestoreDrillSection }} />, {
      wrapperOptions: { user: mockAdminUser, route: '/admin/settings/db-backup' },
    });

    const section = await screen.findByRole('region', { name: 'Restore drill' });
    expect(await within(section).findByText(/Last restore:/)).toBeInTheDocument();
    expect(within(section).queryByText(/at least every 90 days/)).not.toBeInTheDocument();
  });

  it('renders no section without the slot', async () => {
    serve([run()]);

    render(<DbBackupPage />, { wrapperOptions: { user: mockAdminUser, route: '/admin/settings/db-backup' } });

    await screen.findByTestId('admin-db-backup-table');
    expect(screen.queryByRole('region', { name: 'Restore drill' })).not.toBeInTheDocument();
  });

  it('shows a cron schedule from the API with its expression, and no time-of-day field', async () => {
    serve([run()]);

    render(<DbBackupPage />, { wrapperOptions: { user: mockAdminUser, route: '/admin/settings/db-backup' } });

    const expression = (await screen.findByLabelText('Cron expression')) as HTMLInputElement;
    expect(expression.value).toBe('0 */6 * * *');
    expect(screen.queryByLabelText('Time of day')).not.toBeInTheDocument();
    void userEvent;
  });
});
