// =============================================================================
// StorageMigrationPanel and useStorageMigrations (issue #1093): start, live
// progress, cancel, history, the 409 and read-only access
// =============================================================================

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import { createTestApiError, createTestPlatformHost } from '../../src/testing/index.js';
import { isActiveStorageMigration } from '../../src/storage/headless/index.js';
import type { StorageMigrationRun } from '../../src/storage/headless/index.js';
import { StorageMigrationPanel } from '../../src/storage/ui/index.js';

const DRIVERS = [
  { id: 's3', label: 'Amazon S3' },
  { id: 'r2', label: 'Cloudflare R2' },
];

function run(overrides: Partial<StorageMigrationRun> = {}): StorageMigrationRun {
  return {
    id: 'run-1',
    sourceProvider: 's3',
    targetProvider: 'r2',
    status: 'running',
    totalCount: 10,
    migratedCount: 4,
    failedCount: 1,
    skippedCount: 0,
    pendingCount: 5,
    startedById: 'u1',
    startedAt: '2026-11-01T00:00:00.000Z',
    plannedAt: '2026-11-01T00:00:01.000Z',
    finishedAt: null,
    cancelledAt: null,
    lastError: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

const page = (items: StorageMigrationRun[]) => ({ items, meta: { page: 1, pageSize: 10, totalItems: items.length, totalPages: 1 } });
const LIST = 'GET /admin/storage/migrations';

function renderPanel(responses: Record<string, unknown>, permissions: string[] = ['storage_config:read', 'storage_config:write'], pollMs = 20) {
  const host = createTestPlatformHost({ permissions, responses });
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <MemoryRouter>
        <PlatformHostProvider host={host}>{children}</PlatformHostProvider>
      </MemoryRouter>
    );
  }
  const utils = render(<StorageMigrationPanel drivers={DRIVERS} activeProvider="r2" canWrite={permissions.includes('storage_config:write')} pollMs={pollMs} />, {
    wrapper: Wrapper,
  });
  return { ...utils, host };
}

describe('isActiveStorageMigration', () => {
  it('is true for pending and running only', () => {
    expect(['pending', 'running', 'completed', 'failed', 'cancelled'].map((status) => isActiveStorageMigration({ status } as StorageMigrationRun))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(isActiveStorageMigration(null)).toBe(false);
  });
});

describe('StorageMigrationPanel', () => {
  it('shows the empty history and starts a run from the first other driver to the active one', async () => {
    let started: unknown = null;
    const { host } = renderPanel({
      [LIST]: () => (started ? page([run({ status: 'pending', totalCount: 0, migratedCount: 0, failedCount: 0, pendingCount: 0, plannedAt: null })]) : page([])),
      'POST /admin/storage/migrations': (request: { body: unknown }) => {
        started = request.body;
        return run({ status: 'pending' });
      },
    });

    expect(await screen.findByText('No migration has run yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start migration' }));

    await waitFor(() => expect(started).toEqual({ sourceProvider: 's3', targetProvider: 'r2' }));
    expect(await screen.findByTestId('storage-migration-progress')).toHaveTextContent('Listing objects');
    expect(host.requests.some((r) => r.method === 'POST')).toBe(true);
  });

  it('shows live progress for the active run and keeps polling until it finishes', async () => {
    let reads = 0;
    renderPanel({
      [LIST]: () => {
        reads += 1;
        return page([reads < 3 ? run() : run({ status: 'completed', migratedCount: 9, pendingCount: 0, finishedAt: '2026-11-01T00:01:00.000Z' })]);
      },
    });

    expect(await screen.findByTestId('storage-migration-progress')).toHaveTextContent('5 of 10 processed: 4 migrated, 1 failed, 0 skipped, 5 to go');
    expect(screen.getByRole('button', { name: 'Start migration' })).toBeDisabled();

    await waitFor(() => expect(screen.queryByTestId('storage-migration-progress')).not.toBeInTheDocument());
    const row = screen.getByTestId('storage-migration-run-run-1');
    expect(within(row).getByText('completed')).toBeInTheDocument();
    const settled = reads;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(reads).toBe(settled); // no polling once nothing is active
  });

  it('cancels the active run', async () => {
    let cancelled = false;
    renderPanel({
      [LIST]: () => page([cancelled ? run({ status: 'cancelled', pendingCount: 0 }) : run()]),
      'POST /admin/storage/migrations/run-1/cancel': () => {
        cancelled = true;
        return run({ status: 'cancelled' });
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(cancelled).toBe(true));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument());
  });

  it('names the run that holds the slot when a start is refused with 409', async () => {
    renderPanel({
      [LIST]: page([run({ id: 'other-run', status: 'completed' })]),
      'POST /admin/storage/migrations': () => {
        throw createTestApiError(409, 'A storage migration is already in progress', undefined, { activeRunId: 'other-run' });
      },
    }, ['storage_config:read', 'storage_config:write'], 10_000);

    fireEvent.click(await screen.findByRole('button', { name: 'Start migration' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already in progress (run other-run)');
  });

  it('is read-only without storage_config:write: no controls, history only', async () => {
    renderPanel({ [LIST]: page([run()]) }, ['storage_config:read'], 10_000);

    expect(await screen.findByTestId('storage-migration-progress')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start migration' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });
});
