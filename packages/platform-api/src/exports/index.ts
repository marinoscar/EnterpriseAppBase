// `@marinoscar/platform-api/exports`: the data export framework (issue #744,
// PP-9.2; from EvoPath's `health-export/` and `common/export/csv.ts`, and
// kvox's `export/`). Export sources and writers (rung 2), the `user-data` and
// `org-data` sources, the `json`, `csv` and `xlsx` writers, the CSV helpers,
// the document exporter primitives, the `export.run` and `export.purge` jobs
// and `/api/exports`. Documented in ./README.md. Explicit named exports only.

// ---- the module and its options (rung 1) ---------------------------------------------------
export { ExportsModule } from './exports.module';
export {
  DEFAULT_EXPORT_JOB_PROFILE,
  DEFAULT_EXPORT_PURGE_PROFILE,
  EXPORTS_OPTIONS,
  exportFileSlug,
  resolveExportsModuleOptions,
} from './exports.options';
export type { ExportLegacyJobType, ExportsModuleOptions, ResolvedExportsModuleOptions } from './exports.options';
export {
  DEFAULT_EXPORT_DOWNLOAD_URL_TTL_SECONDS,
  DEFAULT_EXPORT_MAX_IN_FLIGHT,
  DEFAULT_EXPORT_PAGE_SIZE,
  DEFAULT_EXPORT_RETENTION_DAYS,
  EXPORTS_KEY_PREFIXES,
  EXPORTS_ORGS_KEY_PREFIX,
  EXPORTS_STORAGE_ROOT,
  EXPORTS_USERS_KEY_PREFIX,
  EXPORT_AUDIT_ACTION,
  EXPORT_AUDIT_TARGET,
  EXPORT_OBJECT_SOURCE,
  EXPORT_ORG_SUBJECT_TYPE,
  EXPORT_PURGE_BATCH,
  EXPORT_PURGE_JOB_TYPE,
  EXPORT_RUN_JOB_TYPE,
  EXPORT_USER_SUBJECT_TYPE,
} from './exports.constants';

// ---- sources and writers (rung 2) ------------------------------------------------------------
export {
  exportSourceRegistry,
  exportWriterRegistry,
  registerExportSource,
  registerExportWriter,
  writersFor,
} from './export.registries';
export type {
  ExportCell,
  ExportColumn,
  ExportContext,
  ExportDb,
  ExportRequestField,
  ExportRow,
  ExportScope,
  ExportSource,
  ExportTable,
  ExportWriteContext,
  ExportWriteResult,
  ExportWriter,
} from './export.types';
export { requestFieldsOf } from './request-fields';
export {
  USER_DATA_EXPORT_PERMISSION,
  USER_DATA_EXPORT_SOURCE,
  USER_DATA_EXPORT_SOURCE_ID,
  userDataTables,
} from './sources/user-data.source';
export {
  ORG_DATA_CROSS_ORG_PERMISSION,
  ORG_DATA_EXPORT_PERMISSION,
  ORG_DATA_EXPORT_SOURCE,
  ORG_DATA_EXPORT_SOURCE_ID,
  orgDataTables,
} from './sources/org-data.source';
export { modelTable } from './sources/model-table';
export type { ModelTableSpec } from './sources/model-table';
export {
  BUILTIN_EXPORT_WRITERS,
  CSV_EXPORT_WRITER,
  JSON_EXPORT_WRITER,
  XLSX_EXPORT_WRITER,
  assertDataset,
  csvLines,
  xlsxSheetName,
} from './writers/index';

// ---- columns and redaction ---------------------------------------------------------------------
export {
  ALWAYS_REDACTED_EXPORT_FIELDS,
  ALWAYS_REDACTED_EXPORT_SUFFIXES,
  datasetNameOf,
  datasetTitleOf,
  delegateNameOf,
  exportColumnsOf,
  isDate,
  isRedactedExportField,
  toExportCell,
} from './datamodel';
export type { ExportDatamodel, ExportDatamodelField, ExportDatamodelModel } from './datamodel';

// ---- CSV helpers and stream helpers ------------------------------------------------------------
export { CSV_LINE_END, FORMULA_TRIGGER, UTF8_BOM, csvCell, csvField, csvRecord, neutralizeFormula } from './csv';
export { endStream, failStream, writeChunk } from './export-stream';

// ---- document exporters (kvox's primitives) ----------------------------------------------------
export { ExporterRegistry } from './documents/exporter-registry';
export type { Exporter } from './documents/exporter-registry';
export { canonicalJson, defaultOptions, hashExportRequest, optionsSchemaFor } from './documents/export-options';
export type { ExportOptionField, ExportOptions, ExportOptionsSchema } from './documents/export-options';

// ---- the jobs, the routes and the status ---------------------------------------------------------
export { ExportRunHandler } from './handlers/export-run.handler';
export { ExportPurgeHandler } from './handlers/export-purge.handler';
export type { ExportPurgeResult } from './handlers/export-purge.handler';
export { ExportPurgeTask } from './tasks/export-purge.task';
export { EXPORT_NOT_FOUND, ExportsService } from './exports.service';
export type { ExportPrincipal, ExportsJobsPrisma } from './exports.service';
export {
  CreateExportDto,
  ExportListResponseDto,
  ExportResponseDto,
  ExportSourcesResponseDto,
  ExportsController,
} from './exports.controller';
export {
  deriveExportStatus,
  exportJobPayloadSchema,
  exportResultSchema,
  readExportResult,
  toExportView,
} from './export-job';
export type { ExportJobPayload, ExportJobRow, ExportResult } from './export-job';

// ---- host ports (rung 3), notifications, metrics ------------------------------------------------
export { EXPORTS_NOTIFIER, EXPORTS_SYSTEM_DATA } from './ports';
export type { ExportNotificationData, ExportsNotifier, ExportsSystemData } from './ports';
export {
  DATA_EXPORT_PAGE_PATH,
  EXPORT_FAILED_EVENT,
  EXPORT_READY_EVENT,
  exportFailedBrowserTemplate,
  exportReadyBrowserTemplate,
} from './exports.notifications';
export type { ExportBrowserContent, ExportNotificationEventDef } from './exports.notifications';
export {
  EXPORTS_APP_METRICS,
  EXPORTS_RUNS_METRIC,
  EXPORT_DURATION_METRIC,
  EXPORT_OUTCOMES,
  EXPORT_SIZE_METRIC,
} from './exports.metrics';
export type { ExportOutcome } from './exports.metrics';
