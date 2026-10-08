// =============================================================================
// The exports slice's wire shapes (issue #744, PP-9.2)
// =============================================================================
//
// The request and responses of `/api/exports` (sources, create, list, get),
// the format-free cell, column and request-field shapes a source declares, and
// the JSON writer's file envelope (`schemaVersion: 1`). Shared by
// `@marinoscar/platform-api/exports` (which wraps them as DTOs, so the OpenAPI
// document is generated from them) and `@marinoscar/platform-web/exports`.
//
// Every object schema is exported so an app can `.extend()` it (a source with
// richer request fields, a client that reads an extra field).
// =============================================================================

import { z } from 'zod';

import {
  EXPORT_COLUMN_TYPES,
  EXPORT_DATASET_PATTERN,
  EXPORT_ID_PATTERN,
  EXPORT_JSON_SCHEMA_VERSION,
  EXPORT_REQUEST_FIELD_KINDS,
  EXPORT_SCOPES,
  EXPORT_STATUSES,
} from './constants.js';

// =============================================================================
// Enum entry types (named, so the published types stay readable)
// =============================================================================

/**
 * The entries of the status enum.
 *
 * @stability experimental
 */
export type ExportStatusEnum = { [K in (typeof EXPORT_STATUSES)[number]]: K };
/**
 * The entries of the scope enum.
 *
 * @stability experimental
 */
export type ExportScopeEnum = { [K in (typeof EXPORT_SCOPES)[number]]: K };
/**
 * The entries of the column type enum.
 *
 * @stability experimental
 */
export type ExportColumnTypeEnum = { [K in (typeof EXPORT_COLUMN_TYPES)[number]]: K };
/**
 * The entries of the request field kind enum.
 *
 * @stability experimental
 */
export type ExportRequestFieldKindEnum = { [K in (typeof EXPORT_REQUEST_FIELD_KINDS)[number]]: K };

/**
 * An export's derived status.
 *
 * @stability experimental
 */
export const exportStatusSchema: z.ZodEnum<ExportStatusEnum> = z.enum(EXPORT_STATUSES);
/**
 * A source's scope.
 *
 * @stability experimental
 */
export const exportScopeSchema: z.ZodEnum<ExportScopeEnum> = z.enum(EXPORT_SCOPES);
/**
 * A column's value type.
 *
 * @stability experimental
 */
export const exportColumnTypeSchema: z.ZodEnum<ExportColumnTypeEnum> = z.enum(EXPORT_COLUMN_TYPES);
/**
 * A request field's kind.
 *
 * @stability experimental
 */
export const exportRequestFieldKindSchema: z.ZodEnum<ExportRequestFieldKindEnum> = z.enum(EXPORT_REQUEST_FIELD_KINDS);

const exportId = z.string().regex(EXPORT_ID_PATTERN);
const isoDateTime = z.string().datetime({ offset: true });

// =============================================================================
// Cells, columns and the JSON file
// =============================================================================

/**
 * One exported value: text, a number, a boolean or `null`. Dates travel as
 * ISO 8601 strings; binary columns are never exported.
 *
 * @stability experimental
 */
export const exportCellSchema: z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

/**
 * One exported value.
 *
 * @stability experimental
 */
export type ExportCell = z.infer<typeof exportCellSchema>;

/**
 * One column of a dataset: its key (the CSV header and the JSON key), a human
 * label (the XLSX header) and its value type.
 *
 * @stability experimental
 */
export const exportColumnSchema = z.object({
  /** Machine name: the CSV header and the JSON key. */
  key: z.string().min(1).max(128),
  /** Human header: the XLSX header. */
  label: z.string().min(1).max(256),
  /** The value type; numbers are never formula-neutralised in a CSV. */
  type: exportColumnTypeSchema,
});

/**
 * One column of a dataset.
 *
 * @stability experimental
 */
export type ExportColumn = z.infer<typeof exportColumnSchema>;

/**
 * One dataset inside the JSON file.
 *
 * @stability experimental
 */
export const exportJsonDatasetSchema = z.object({
  /** The human title (an XLSX sheet name). */
  title: z.string(),
  /** The columns, in order. */
  columns: z.array(exportColumnSchema),
  /** The rows, keyed by column key. */
  rows: z.array(z.record(z.string(), exportCellSchema)),
});

/**
 * One dataset inside the JSON file.
 *
 * @stability experimental
 */
export type ExportJsonDataset = z.infer<typeof exportJsonDatasetSchema>;

/**
 * The JSON writer's file, version 1: the contract a reader of a JSON export
 * validates against. `datasets` is keyed by dataset name, in the order the
 * source produced them.
 *
 * @stability experimental
 */
export const exportJsonFileSchema = z
  .object({
    /** {@link EXPORT_JSON_SCHEMA_VERSION}. */
    schemaVersion: z.literal(EXPORT_JSON_SCHEMA_VERSION),
    /** The source id (`user-data`). */
    source: exportId,
    /** When the export was produced. */
    exportedAt: isoDateTime,
    /** One entry per dataset. */
    datasets: z.record(z.string().regex(EXPORT_DATASET_PATTERN), exportJsonDatasetSchema),
  })
  .strict();

/**
 * The JSON writer's file, version 1.
 *
 * @stability experimental
 */
export type ExportJsonFile = z.infer<typeof exportJsonFileSchema>;

// =============================================================================
// GET /exports/sources
// =============================================================================

/**
 * One choice of a `select` request field.
 *
 * @stability experimental
 */
export const exportRequestFieldOptionSchema = z.object({
  /** The value sent. */
  value: z.string(),
  /** What the dialog shows. */
  label: z.string(),
});

/**
 * One field of a source's request, as the export dialog draws it. Derived
 * from the source's request schema unless the source declares its own.
 *
 * @stability experimental
 */
export const exportRequestFieldSchema = z.object({
  /** The key in `request`. */
  key: z.string().min(1).max(64),
  /** The field's label. */
  label: z.string().min(1),
  /** What to draw. */
  kind: exportRequestFieldKindSchema,
  /** Whether the request is refused without it. */
  required: z.boolean(),
  /** One line under the field. */
  description: z.string().optional(),
  /** The choices of a `select`. */
  options: z.array(exportRequestFieldOptionSchema).optional(),
  /** The value when the request omits it. */
  default: z.union([z.string(), z.boolean()]).optional(),
});

/**
 * One field of a source's request.
 *
 * @stability experimental
 */
export type ExportRequestField = z.infer<typeof exportRequestFieldSchema>;

/**
 * One output format a source offers.
 *
 * @stability experimental
 */
export const exportFormatDescriptorSchema = z.object({
  /** The writer id (`csv`), sent as `format`. */
  id: exportId,
  /** What the dialog calls it. */
  label: z.string(),
  /** The file extension, without the dot (`zip` for `csv`). */
  extension: z.string(),
  /** The file's media type. */
  mimeType: z.string(),
});

/**
 * One output format a source offers.
 *
 * @stability experimental
 */
export type ExportFormatDescriptor = z.infer<typeof exportFormatDescriptorSchema>;

/**
 * One source the caller may use.
 *
 * @stability experimental
 */
export const exportSourceDescriptorSchema = z.object({
  /** The source id (`user-data`), sent as `source`. */
  id: exportId,
  /** Whose data it exports. */
  scope: exportScopeSchema,
  /** What the dialog calls it. */
  label: z.string(),
  /** One sentence about what it contains. */
  description: z.string().optional(),
  /** The formats it offers, in registry order. */
  formats: z.array(exportFormatDescriptorSchema),
  /** The request fields the dialog draws (empty for a source without options). */
  fields: z.array(exportRequestFieldSchema),
  /** For an `org` source: whether the caller may export an organization other than the active one. */
  crossOrg: z.boolean(),
});

/**
 * One source the caller may use.
 *
 * @stability experimental
 */
export type ExportSourceDescriptor = z.infer<typeof exportSourceDescriptorSchema>;

/**
 * `GET /exports/sources`.
 *
 * @stability experimental
 */
export const exportSourcesResponseSchema = z.object({
  /** The sources, in registry order. */
  items: z.array(exportSourceDescriptorSchema),
});

/**
 * `GET /exports/sources`.
 *
 * @stability experimental
 */
export type ExportSourcesResponse = z.infer<typeof exportSourcesResponseSchema>;

// =============================================================================
// POST /exports
// =============================================================================

/**
 * `POST /exports`. `request` is validated by the source's own schema, at the
 * route and again when the job starts. `orgId` names the organization of an
 * `org` source (default: the caller's active organization); another
 * organization needs the source's cross-organization permission.
 *
 * @stability experimental
 */
export const createExportSchema = z
  .object({
    /** The source id. */
    source: exportId,
    /** The format (writer) id. */
    format: exportId,
    /** The source's request; `{}` when it takes none. */
    request: z.record(z.string(), z.unknown()).default({}),
    /** An `org` source's organization; ignored by a `user` source. */
    orgId: z.string().uuid().optional(),
  })
  .strict();

/**
 * `POST /exports`, as parsed.
 *
 * @stability experimental
 */
export type CreateExport = z.infer<typeof createExportSchema>;

/**
 * `POST /exports`, as a client sends it.
 *
 * @stability experimental
 */
export type CreateExportInput = z.input<typeof createExportSchema>;

// =============================================================================
// The export
// =============================================================================

/**
 * A short-lived signed download, present only on `GET /exports/:id` of a
 * `ready` export. Never logged, never stored.
 *
 * @stability experimental
 */
export const exportDownloadSchema = z.object({
  /** A signed GET with `Content-Disposition: attachment`. */
  url: z.string().url(),
  /** When the URL stops working. */
  expiresAt: isoDateTime,
});

/**
 * A short-lived signed download.
 *
 * @stability experimental
 */
export type ExportDownload = z.infer<typeof exportDownloadSchema>;

/**
 * One export. Its id is the job id: there is no export table.
 *
 * @stability experimental
 */
export const exportSchema = z.object({
  /** The export (job) id. */
  id: z.string().uuid(),
  /** The source id. */
  source: exportId,
  /** The format id. */
  format: exportId,
  /** Whose data. */
  scope: exportScopeSchema,
  /** The organization of an `org` export, else `null`. */
  orgId: z.string().uuid().nullable(),
  /** The derived status. */
  status: exportStatusSchema,
  /** When it was requested. */
  createdAt: isoDateTime,
  /** When the file was produced, or the job settled. */
  completedAt: isoDateTime.nullable(),
  /** When the file is deleted. */
  expiresAt: isoDateTime.nullable(),
  /** The download name. */
  fileName: z.string().nullable(),
  /** The file's media type. */
  mimeType: z.string().nullable(),
  /** The file's size in bytes. */
  sizeBytes: z.number().int().nonnegative().nullable(),
  /** Rows per dataset. */
  rowCounts: z.record(z.string(), z.number().int().nonnegative()).nullable(),
  /** The fixed failure message of a `failed` export, else `null`. */
  error: z.string().nullable(),
  /** The signed download (`GET /exports/:id` of a `ready` export only), else `null`. */
  download: exportDownloadSchema.nullable(),
});

/**
 * One export.
 *
 * @stability experimental
 */
export type ExportView = z.infer<typeof exportSchema>;

/**
 * `GET /exports`: the caller's most recent exports, newest first, without
 * download URLs.
 *
 * @stability experimental
 */
export const exportListResponseSchema = z.object({
  /** At most `EXPORT_LIST_LIMIT`. */
  items: z.array(exportSchema),
});

/**
 * `GET /exports`.
 *
 * @stability experimental
 */
export type ExportListResponse = z.infer<typeof exportListResponseSchema>;
