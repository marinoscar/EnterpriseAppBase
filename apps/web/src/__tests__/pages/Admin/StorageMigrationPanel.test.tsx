/**
 * The copy-only storage provider migration section of the Storage page
 * (issue #1093), as this app uses it: `StorageMigrationPanel` from
 * `@marinoscar/platform-web/storage/ui` over a transport, starting a run from
 * the first other driver to the active one and following its progress.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlatformApiClient } from '@marinoscar/platform-web/core';
import type { StorageMigrationRun } from '@marinoscar/platform-web/storage/headless';
import { StorageMigrationPanel } from '@marinoscar/platform-web/storage/ui';

import { render } from '../../utils/test-utils';

const running: StorageMigrationRun = {
  id: 'run-1',
  sourceProvider: 's3',
  targetProvider: 'r2',
  status: 'running',
  totalCount: 4,
  migratedCount: 1,
  failedCount: 0,
  skippedCount: 1,
  pendingCount: 2,
  startedById: null,
  startedAt: '2026-11-01T00:00:00.000Z',
  plannedAt: '2026-11-01T00:00:01.000Z',
  finishedAt: null,
  cancelledAt: null,
  lastError: null,
  createdAt: '2026-11-01T00:00:00.000Z',
};

describe('StorageMigrationPanel in the Storage page', () => {
  it('starts a migration to the active driver and shows its progress', async () => {
    let started = false;
    const api = {
      get: vi.fn(async () => ({ items: started ? [running] : [], meta: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 } })),
      post: vi.fn(async () => {
        started = true;
        return running;
      }),
    } as unknown as PlatformApiClient;

    render(
      <StorageMigrationPanel
        api={api}
        drivers={[
          { id: 's3', label: 'Amazon S3' },
          { id: 'r2', label: 'Cloudflare R2' },
        ]}
        activeProvider="r2"
        canWrite
        pollMs={60_000}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Start migration' }));

    expect(api.post).toHaveBeenCalledWith('/admin/storage/migrations', { sourceProvider: 's3', targetProvider: 'r2' });
    await waitFor(() =>
      expect(screen.getByTestId('storage-migration-progress')).toHaveTextContent('2 of 4 processed: 1 migrated, 0 failed, 1 skipped, 2 to go'),
    );
  });
});
