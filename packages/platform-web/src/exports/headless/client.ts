import { EXPORTS_PATH, EXPORTS_SOURCES_PATH } from '@marinoscar/platform-contract/exports';
import type {
  CreateExportInput,
  ExportListResponse,
  ExportSourcesResponse,
  ExportView,
} from '@marinoscar/platform-contract/exports';

import type { PlatformApiClient } from '../../core/index.js';

/**
 * The export API calls (`/api/exports`).
 *
 * @stability experimental
 */
export interface ExportsClient {
  /** `GET /exports/sources`: the sources and formats the caller may use. */
  sources(): Promise<ExportSourcesResponse>;
  /** `GET /exports`: the caller's recent exports, without download URLs. */
  list(): Promise<ExportListResponse>;
  /** `GET /exports/:id`: one export, with a fresh signed `download` while ready. */
  get(id: string): Promise<ExportView>;
  /** `POST /exports`: queues an export; resolves with it, `pending`. */
  create(input: CreateExportInput): Promise<ExportView>;
}

/**
 * The exports client over the app's transport.
 *
 * @param api - the app's transport (`usePlatformApi()`).
 * @returns the client.
 *
 * @example
 * ```ts
 * const client = createExportsClient(usePlatformApi());
 * const view = await client.create({ source: 'user-data', format: 'json' });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function createExportsClient(api: PlatformApiClient): ExportsClient {
  return {
    sources: () => api.get<ExportSourcesResponse>(EXPORTS_SOURCES_PATH),
    list: () => api.get<ExportListResponse>(EXPORTS_PATH),
    get: (id) => api.get<ExportView>(`${EXPORTS_PATH}/${encodeURIComponent(id)}`),
    create: (input) => api.post<ExportView>(EXPORTS_PATH, input),
  };
}

/**
 * Whether an export may still change on its own (`pending`, `running`).
 *
 * @param view - an export.
 * @returns `true` while the job has not settled.
 *
 * @stability experimental
 */
export function isExportInProgress(view: Pick<ExportView, 'status'>): boolean {
  return view.status === 'pending' || view.status === 'running';
}

/**
 * An export's status in words (never a colour alone).
 *
 * @param status - the derived status.
 * @returns the label.
 *
 * @stability experimental
 */
export function exportStatusLabel(status: ExportView['status']): string {
  switch (status) {
    case 'pending':
      return 'Queued';
    case 'running':
      return 'Preparing';
    case 'ready':
      return 'Ready to download';
    case 'expired':
      return 'Expired';
    case 'failed':
      return 'Failed';
  }
}

/**
 * Bytes as a short human size (`1.5 MB`).
 *
 * @param bytes - the size, or `null`.
 * @returns the text, or an empty string for `null`.
 *
 * @stability experimental
 */
export function formatExportSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
