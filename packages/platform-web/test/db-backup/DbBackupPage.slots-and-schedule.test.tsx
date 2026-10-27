/**
 * The database backup page after PP-14.12: the `Sections` slot, the cron
 * schedule and an app restore gate (the markup with none of them is pinned by
 * `DbBackupPage.builtin-dom.test.tsx`).
 *
 *   - `slots.Sections` renders below the run history with the page's own state,
 *     and nothing at all when it is not passed;
 *   - choosing the cron frequency shows a cron field (and hides the time of
 *     day, which a cron schedule ignores), saves `cron` and nothing else new,
 *     and every other frequency saves exactly the fields it always did;
 *   - the API's refusal of an expression is shown verbatim;
 *   - a gate an app registered renders in the restore dialog like any other, its
 *     block is named by its own title and offers no override, and the schema
 *     panel is not shown for it.
 */
import { fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

import { NUMERIC_DATE_TIME, PlatformHostProvider, formatDateTime, setPreferredTimeZone } from '../../src/core/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import { DbBackupWebAdaptersProvider } from '../../src/db-backup/headless/index.js';
import type { DbBackupApi, DbBackupConfig, DbBackupRun, RestorePreflight } from '../../src/db-backup/headless/index.js';
import DbBackupPage from '../../src/db-backup/ui/DbBackupPage.js';
import type { DbBackupSectionsProps } from '../../src/db-backup/ui/DbBackupPage.js';

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

function api(overrides: Partial<Record<keyof DbBackupApi, unknown>> = {}, config: DbBackupConfig = CONFIG): DbBackupApi {
  return {
    getDbBackupConfig: vi.fn().mockResolvedValue(config),
    updateDbBackupConfig: vi.fn().mockImplementation(async (input: Partial<DbBackupConfig>) => ({ ...config, ...input })),
    getBackupRuns: vi.fn().mockResolvedValue({ items: [RUN], total: 1, page: 1, pageSize: 20, totalPages: 1 }),
    getBackupRun: vi.fn(),
    startBackupRun: vi.fn(),
    cancelBackupRun: vi.fn(),
    deleteBackupRun: vi.fn(),
    getBackupDownloadUrl: vi.fn(),
    startRestore: vi.fn(),
    rollbackRestore: vi.fn(),
    ...overrides,
  } as unknown as DbBackupApi;
}

function mount(client: DbBackupApi, props: { slots?: { Sections?: (props: DbBackupSectionsProps) => ReactElement | null } } = {}) {
  const host = createTestPlatformHost({ permissions: ['db_backup:read', 'db_backup:write', 'db_backup:restore'] });
  const adapters = { api: client };
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <MemoryRouter initialEntries={['/admin/settings/db-backup']}>
        <PlatformHostProvider host={host}>
          <DbBackupWebAdaptersProvider adapters={adapters}>{children}</DbBackupWebAdaptersProvider>
        </PlatformHostProvider>
      </MemoryRouter>
    );
  }
  return rtlRender(<DbBackupPage {...props} />, { wrapper: Wrapper });
}

const chooseFrequency = async (label: string) => {
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Frequency' }));
  fireEvent.click(await screen.findByRole('option', { name: label }));
};

describe('slots.Sections', () => {
  it('renders below the run history with the config, the rows, the permissions and a refresh', async () => {
    const seen: DbBackupSectionsProps[] = [];
    const Sections = (props: DbBackupSectionsProps): ReactElement | null => {
      seen.push(props);
      // Rendered at both ends: this panel belongs below the history.
      if (props.position !== 'bottom') return null;
      return <section data-testid="app-sections">Mirror status: {props.runs.length} run(s)</section>;
    };

    const { container } = mount(api(), { slots: { Sections } });

    const section = await screen.findByTestId('app-sections');
    await waitFor(() => expect(section.textContent).toBe('Mirror status: 1 run(s)'));

    const latest = seen[seen.length - 1] as DbBackupSectionsProps;
    expect(latest.config?.frequency).toBe('daily');
    expect(latest.canWrite).toBe(true);
    expect(latest.canRestore).toBe(true);
    expect(typeof latest.refresh).toBe('function');

    // Below the history: after the run table, inside the page.
    const table = screen.getByTestId('admin-db-backup-table');
    expect(table.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.contains(section)).toBe(true);
  });

  it('refresh re-reads the policy and the history', async () => {
    const client = api();
    let refresh: () => void = () => undefined;
    const Sections = (props: DbBackupSectionsProps): ReactElement | null => {
      refresh = props.refresh;
      return props.position === 'bottom' ? <span data-testid="app-sections" /> : null;
    };
    mount(client, { slots: { Sections } });
    await screen.findByTestId('app-sections');
    await waitFor(() => expect(client.getBackupRuns).toHaveBeenCalled());
    const before = (client.getBackupRuns as ReturnType<typeof vi.fn>).mock.calls.length;

    refresh();

    await waitFor(() => expect((client.getBackupRuns as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(before));
  });

  it('renders at both ends, once under the header and once after the history', async () => {
    const Sections = ({ position }: DbBackupSectionsProps): ReactElement => (
      <section data-testid={`app-sections-${position}`}>{position}</section>
    );

    mount(api(), { slots: { Sections } });

    const top = await screen.findByTestId('app-sections-top');
    const bottom = await screen.findByTestId('app-sections-bottom');
    const heading = screen.getByRole('heading', { level: 1, name: 'Database Backup' });
    const table = screen.getByTestId('admin-db-backup-table');
    expect(heading.compareDocumentPosition(top) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(top.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(table.compareDocumentPosition(bottom) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders nothing extra without the slot', async () => {
    mount(api());

    await screen.findByText('Database Backup');
    expect(screen.queryByTestId('app-sections')).toBeNull();
  });
});

describe('the cron schedule', () => {
  it('offers the cron frequency, then shows the expression field and hides the time of day', async () => {
    mount(api());
    expect(await screen.findByLabelText('Time of day')).toBeTruthy();
    expect(screen.queryByLabelText('Cron expression')).toBeNull();

    await chooseFrequency('On a cron schedule');

    expect(await screen.findByLabelText('Cron expression')).toBeTruthy();
    expect(screen.queryByLabelText('Time of day')).toBeNull();
  });

  it('saves frequency cron with the trimmed expression and nothing else new', async () => {
    const client = api();
    mount(client);
    await chooseFrequency('On a cron schedule');
    fireEvent.change(await screen.findByLabelText('Cron expression'), { target: { value: '  0 */6 * * *  ' } });

    fireEvent.click(await screen.findByRole('button', { name: /save/i }));

    await waitFor(() => expect(client.updateDbBackupConfig).toHaveBeenCalledTimes(1));
    expect(client.updateDbBackupConfig).toHaveBeenCalledWith(
      expect.objectContaining({ frequency: 'cron', cron: '0 */6 * * *', retentionCount: 7, timezone: 'UTC' }),
    );
  });

  it('a save under any other frequency carries exactly the fields it always did', async () => {
    const client = api();
    mount(client);
    fireEvent.change(await screen.findByLabelText('Backups to keep'), { target: { value: '9' } });

    fireEvent.click(await screen.findByRole('button', { name: /save/i }));

    await waitFor(() => expect(client.updateDbBackupConfig).toHaveBeenCalledTimes(1));
    const sent = (client.updateDbBackupConfig as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(
      [
        'compressionLevel',
        'dayOfMonth',
        'dayOfWeek',
        'enabled',
        'frequency',
        'oldDatabaseRetentionHours',
        'restoreRollbackMode',
        'retentionCount',
        'timeOfDay',
        'timezone',
      ].sort(),
    );
    expect(sent.retentionCount).toBe(9);
  });

  it('seeds the field from a stored expression and shows the API\'s refusal verbatim', async () => {
    const client = api(
      {
        updateDbBackupConfig: vi.fn().mockRejectedValue(
          Object.assign(new Error("The cron expression '*/15 * * * *' can fire 15 minute(s) after its previous run."), { status: 400 }),
        ),
      },
      { ...CONFIG, frequency: 'cron', cron: '*/15 * * * *' },
    );
    mount(client);
    const field = (await screen.findByLabelText('Cron expression')) as HTMLInputElement;
    expect(field.value).toBe('*/15 * * * *');

    fireEvent.change(field, { target: { value: '*/15 * * * * ' } });
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));

    await waitFor(() => expect(client.updateDbBackupConfig).toHaveBeenCalled());
    expect(await screen.findByTestId('db-backup-config-error')).toBeTruthy();
  });
});

describe('an app restore gate in the restore dialog', () => {
  const preflight = (verdict: 'pass' | 'block'): RestorePreflight =>
    ({
      outcome: verdict === 'block' ? 'blocked' : 'ok',
      runId: RUN.id,
      targetDatabase: 'app',
      scratchDatabase: 'app_restore_x',
      oldDatabase: 'app_old_x',
      gates: [
        { id: 'schema_compatibility', kind: 'overridable', verdict: 'pass', title: 'Schema compatibility', detail: 'Match.', action: null },
        {
          id: 'cdn-quiesced',
          kind: 'app',
          verdict,
          title: 'CDN quiesced',
          detail: verdict === 'block' ? 'The CDN is still serving traffic.' : 'The CDN is quiesced.',
          action: verdict === 'block' ? 'Pause or purge the CDN, then retry.' : null,
        },
      ],
      rollback: { configured: 'retain_database', effective: 'retain_database', downgraded: false, reason: null },
      archiveMigration: '20260101_init',
      liveMigration: '20260101_init',
      databaseSizeBytes: '1000',
      freeDiskBytes: '100000',
    }) as unknown as RestorePreflight;

  it('renders beside the built-ins, is named by its title, and has no override or schema panel', async () => {
    const client = api({
      startRestore: vi.fn().mockResolvedValue({
        mode: 'blocked',
        runId: RUN.id,
        block: { gateId: 'cdn-quiesced', message: 'The CDN is still serving traffic.', overridable: false, overrideParameter: null },
        preflight: preflight('block'),
      }),
    });
    mount(client);

    // The default table draws each row action as a labelled icon button.
    fireEvent.click(await screen.findByRole('button', { name: 'Restore from this backup' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Acknowledge the consequences' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Type RESTORE to confirm' }), { target: { value: 'RESTORE' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore this backup' }));

    expect(await within(dialog).findByTestId('restore-gate-cdn-quiesced')).toBeTruthy();
    expect(within(dialog).getByTestId('restore-gate-schema_compatibility')).toBeTruthy();
    expect(within(dialog).getByTestId('restore-blocked').textContent).toContain('Refused by the CDN quiesced check');
    expect(within(dialog).getByText('Pause or purge the CDN, then retry.')).toBeTruthy();
    expect(within(dialog).queryByTestId('restore-schema-mismatch')).toBeNull();
    expect(within(dialog).queryByTestId('restore-override')).toBeNull();
    expect(within(dialog).getByText(/There is no override for this check/)).toBeTruthy();
  });
});

describe('the deployment schedule zone picker', () => {
  afterEach(() => setPreferredTimeZone(null));

  it("suggests the runtime's zones and saves the one picked as the deployment's timezone", async () => {
    const client = api();
    mount(client);
    const field = await screen.findByLabelText('Timezone');
    expect(field).toHaveProperty('value', 'UTC');

    fireEvent.change(field, { target: { value: 'Costa' } });
    fireEvent.click(await screen.findByRole('option', { name: 'America/Costa_Rica' }));
    expect(field).toHaveProperty('value', 'America/Costa_Rica');

    fireEvent.click(await screen.findByRole('button', { name: /save/i }));
    await waitFor(() => expect(client.updateDbBackupConfig).toHaveBeenCalledTimes(1));
    expect(client.updateDbBackupConfig).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'America/Costa_Rica' }));
  });

  it('still accepts a zone it does not list, leaving validation to the API', async () => {
    const client = api();
    mount(client);
    const field = await screen.findByLabelText('Timezone');
    fireEvent.change(field, { target: { value: 'Mars/Olympus' } });
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));
    await waitFor(() => expect(client.updateDbBackupConfig).toHaveBeenCalledTimes(1));
    expect(client.updateDbBackupConfig).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'Mars/Olympus' }));
  });

  it("renders the next scheduled backup in the viewer's zone, not the schedule's", async () => {
    setPreferredTimeZone('Asia/Tokyo');
    mount(api());
    const next = await screen.findByTestId('db-backup-next-run');
    expect(next.textContent).toContain(formatDateTime(CONFIG.nextRunAt, { ...NUMERIC_DATE_TIME, timeZone: 'Asia/Tokyo' }));
  });
});
