/**
 * The packaged-page slot contract on the database backup page (PP-14.23): the
 * base slots (`Header`, `BeforeContent`, `Sections` at both ends, `AfterContent`)
 * and `RunRowActions`. The markup with NO slot is pinned by
 * `DbBackupPage.builtin-dom.test.tsx`.
 */
import { render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

import { PlatformHostProvider } from '../../src/core/index.js';
import type { PageHeaderSlotProps } from '../../src/core/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import { DbBackupWebAdaptersProvider } from '../../src/db-backup/headless/index.js';
import type { DbBackupApi, DbBackupConfig, DbBackupRun } from '../../src/db-backup/headless/index.js';
import DbBackupPage from '../../src/db-backup/ui/DbBackupPage.js';
import type { DbBackupPageSlots, DbBackupRunActionsProps } from '../../src/db-backup/ui/DbBackupPage.js';

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

const RUN: DbBackupRun = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'completed',
  trigger: 'scheduled',
  bytesWritten: '1200000000',
  sizeBytes: '1200000000',
  storageProvider: 's3',
  storageKey: 'database-backups/app/2026/03/app-1111.dump',
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

function api(): DbBackupApi {
  return {
    getDbBackupConfig: vi.fn().mockResolvedValue(CONFIG),
    updateDbBackupConfig: vi.fn(),
    getBackupRuns: vi.fn().mockResolvedValue({ items: [RUN], total: 1, page: 1, pageSize: 20, totalPages: 1 }),
    getBackupRun: vi.fn(),
    startBackupRun: vi.fn(),
    cancelBackupRun: vi.fn(),
    deleteBackupRun: vi.fn(),
    getBackupDownloadUrl: vi.fn(),
    startRestore: vi.fn(),
    rollbackRestore: vi.fn(),
  } as unknown as DbBackupApi;
}

function mount(slots: DbBackupPageSlots, permissions = ['db_backup:read', 'db_backup:write', 'db_backup:restore'], client = api()) {
  const host = createTestPlatformHost({ permissions });
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <MemoryRouter initialEntries={['/admin/settings/db-backup']}>
        <PlatformHostProvider host={host}>
          <DbBackupWebAdaptersProvider adapters={{ api: client }}>{children}</DbBackupWebAdaptersProvider>
        </PlatformHostProvider>
      </MemoryRouter>
    );
  }
  return rtlRender(<DbBackupPage slots={slots} />, { wrapper: Wrapper });
}

const follows = (a: Element, b: Element): boolean => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('DbBackupPage slots', () => {
  it('replaces the header with the title, description and readOnly the default one prints', async () => {
    const seen: PageHeaderSlotProps[] = [];
    const Header = (props: PageHeaderSlotProps) => {
      seen.push(props);
      return <h1>{props.title} custom{props.readOnly ? ' ro' : ''}</h1>;
    };
    mount({ Header }, ['db_backup:read']);

    expect(await screen.findByRole('heading', { level: 1, name: 'Database Backup custom ro' })).toBeInTheDocument();
    expect(seen[0]).toMatchObject({ title: 'Database Backup', readOnly: true, actions: null });
    expect(typeof seen[0]?.description).toBe('string');
  });

  it('draws BeforeContent, Sections (both ends) and AfterContent in the contract order', async () => {
    mount({
      BeforeContent: () => <p data-testid="before">banner</p>,
      Sections: ({ position }) => <p data-testid={`section-${position}`}>{position}</p>,
      AfterContent: () => <p data-testid="after">end</p>,
    });

    const table = await screen.findByTestId('admin-db-backup-table');
    const order = [
      screen.getByRole('heading', { level: 1, name: 'Database Backup' }),
      screen.getByTestId('before'),
      screen.getByTestId('section-top'),
      table,
      screen.getByTestId('section-bottom'),
      screen.getByTestId('after'),
    ];
    for (let i = 0; i < order.length - 1; i += 1) expect(follows(order[i]!, order[i + 1]!)).toBe(true);
  });

  it('draws RunRowActions in a "More actions" column with the run, the permissions and a refresh', async () => {
    const seen: DbBackupRunActionsProps[] = [];
    const RunRowActions = (props: DbBackupRunActionsProps) => {
      seen.push(props);
      return <button type="button">Verify copy of {props.run.id.slice(0, 4)}</button>;
    };
    const client = api();
    mount({ RunRowActions }, undefined, client);

    const table = await screen.findByTestId('admin-db-backup-table');
    const button = await within(table).findByRole('button', { name: 'Verify copy of 1111' });
    expect(within(table).getByRole('columnheader', { name: 'More actions' })).toBeInTheDocument();
    expect(seen[0]).toMatchObject({ canWrite: true, canRestore: true });

    const before = (client.getBackupRuns as ReturnType<typeof vi.fn>).mock.calls.length;
    seen[0]?.refresh();
    await waitFor(() => expect((client.getBackupRuns as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(before));
    // The built-in actions are untouched.
    expect(within(table).getByRole('button', { name: 'Download archive' })).toBeInTheDocument();
    expect(button).toBeInTheDocument();
  });

  it('reports canWrite and canRestore for a read-only viewer', async () => {
    const seen: DbBackupRunActionsProps[] = [];
    mount(
      {
        RunRowActions: (props) => {
          seen.push(props);
          return <span>read-only actions</span>;
        },
      },
      ['db_backup:read'],
    );

    await screen.findByText('read-only actions');
    expect(seen[0]).toMatchObject({ canWrite: false, canRestore: false });
  });
});
