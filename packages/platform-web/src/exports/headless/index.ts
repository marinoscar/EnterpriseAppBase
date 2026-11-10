// `@marinoscar/platform-web/exports/headless`: the exports client and hooks
// (issue #744): the sources the caller may use, their recent exports (polled
// while one is in progress), requesting one, and one export polled until it
// settles. No UI. Documented in ../README.md.

export {
  createExportsClient,
  exportStatusLabel,
  formatExportSize,
  isExportInProgress,
} from './client.js';
export type { ExportsClient } from './client.js';
export {
  DEFAULT_EXPORT_POLL_MS,
  useCreateExport,
  useExport,
  useExportSources,
  useExports,
  useExportsClient,
} from './hooks.js';
export type { CreateExportState, ExportSourcesState, ExportState, ExportsState } from './hooks.js';
