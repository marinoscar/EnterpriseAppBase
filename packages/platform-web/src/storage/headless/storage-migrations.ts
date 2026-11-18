/**
 * The `/api/admin/storage/migrations` client (issue #1093): start, list, read
 * and cancel a copy-only storage provider migration.
 */

import {
  STORAGE_MIGRATION_ACTIVE_RUN_STATUSES,
  STORAGE_MIGRATION_RUN_STATUSES,
} from '@marinoscar/platform-contract/storage';
import type {
  StartStorageMigrationInput,
  StorageMigrationRun,
  StorageMigrationRunList,
  StorageMigrationRunStatusName,
} from '@marinoscar/platform-contract/storage';

import type { PlatformApiClient } from '../../core/index.js';

export { STORAGE_MIGRATION_ACTIVE_RUN_STATUSES, STORAGE_MIGRATION_RUN_STATUSES };
export type { StartStorageMigrationInput, StorageMigrationRun, StorageMigrationRunList, StorageMigrationRunStatusName };

const BASE = '/admin/storage/migrations';

/**
 * Whether a run still holds the one active slot (pending or running): the page polls while one does.
 *
 * @param run - a run, or nothing.
 * @returns true for `pending` and `running`.
 *
 * @stability experimental
 */
export function isActiveStorageMigration(run: Pick<StorageMigrationRun, 'status'> | null | undefined): boolean {
  return !!run && (STORAGE_MIGRATION_ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status);
}

/**
 * The four calls of the migration admin routes.
 *
 * @stability experimental
 */
export interface StorageMigrationsClient {
  /** `POST`: start a run (409 with `details.activeRunId` when one is active). */
  start(input: StartStorageMigrationInput): Promise<StorageMigrationRun>;
  /** `GET`: one page of runs, newest first. */
  list(query?: { page?: number; pageSize?: number }): Promise<StorageMigrationRunList>;
  /** `GET /:runId`: one run with live counts. */
  get(runId: string): Promise<StorageMigrationRun>;
  /** `POST /:runId/cancel`. */
  cancel(runId: string): Promise<StorageMigrationRun>;
}

/**
 * The migration client over the host's transport.
 *
 * @param api - the transport.
 * @returns the client.
 *
 * @stability experimental
 */
export function createStorageMigrationsClient(api: PlatformApiClient): StorageMigrationsClient {
  return {
    start: (input) => api.post<StorageMigrationRun>(BASE, input),
    list: (query = {}) =>
      api.get<StorageMigrationRunList>(`${BASE}?page=${query.page ?? 1}&pageSize=${query.pageSize ?? 10}`),
    get: (runId) => api.get<StorageMigrationRun>(`${BASE}/${encodeURIComponent(runId)}`),
    cancel: (runId) => api.post<StorageMigrationRun>(`${BASE}/${encodeURIComponent(runId)}/cancel`),
  };
}
