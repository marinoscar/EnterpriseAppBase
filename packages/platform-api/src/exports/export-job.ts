// =============================================================================
// The `export.run` payload, its result and the derived status (issue #744)
// =============================================================================
//
// NO EXPORT TABLE (EvoPath's design): the export id is the job id, the request
// lives on the job payload, and the outcome is written to `payload.result` in
// the same transaction as the file's `storage_objects` row. The status is
// derived on every read:
//
//   - `pending` / `running`: the job's own status, while no result exists;
//   - `ready`: a result exists, its object exists and `expiresAt` is ahead;
//   - `expired`: a result exists but the object is gone or past its expiry;
//   - `failed`: otherwise (the job settled without a result).
//
// A failed export reports the fixed `EXPORT_FAILED_MESSAGE`, never `lastError`.
// =============================================================================

import {
  EXPORT_FAILED_MESSAGE,
  EXPORT_ID_PATTERN,
  exportScopeSchema,
  type ExportStatus,
  type ExportView,
} from '@marinoscar/platform-contract/exports';
import { z } from 'zod';

/**
 * What `export.run` writes to `payload.result` once the file is committed.
 *
 * @stability experimental
 */
export const exportResultSchema = z.object({
  /** The file's `storage_objects` row. */
  storageObjectId: z.string().min(1),
  /** The download name. */
  fileName: z.string().min(1),
  /** The file's media type. */
  mimeType: z.string().min(1),
  /** Bytes written. */
  sizeBytes: z.number().int().nonnegative(),
  /** Rows per dataset. */
  rowCounts: z.record(z.string(), z.number().int().nonnegative()),
  /** When the file was committed. */
  completedAt: z.string(),
  /** When the purge deletes it. */
  expiresAt: z.string(),
});

/**
 * An export's committed result.
 *
 * @stability experimental
 */
export type ExportResult = z.infer<typeof exportResultSchema>;

/**
 * The `export.run` job payload: identifiers only, plus the parsed request.
 *
 * @stability experimental
 */
export const exportJobPayloadSchema = z.object({
  /** The source id. */
  source: z.string().regex(EXPORT_ID_PATTERN),
  /** The format (writer) id. */
  format: z.string().regex(EXPORT_ID_PATTERN),
  /** The source's request, re-validated by the source when the job starts. */
  request: z.unknown(),
  /** The user who asked; the notification recipient and the file's uploader. */
  requestedById: z.string().min(1),
  /** The source's scope. */
  scope: exportScopeSchema,
  /** The user (`user`) or organization (`org`) whose data it is; equals the job's subject. */
  subjectId: z.string().min(1),
  /** The organization the file's `storage_objects` row belongs to. */
  orgId: z.string().min(1),
  /** Present once the file is committed. */
  result: exportResultSchema.optional(),
});

/**
 * The `export.run` job payload.
 *
 * @stability experimental
 */
export type ExportJobPayload = z.infer<typeof exportJobPayloadSchema>;

/**
 * The committed result on a job payload, or `null`.
 *
 * @param payload - a job's payload.
 * @returns the result, when one parses.
 *
 * @stability experimental
 */
export function readExportResult(payload: unknown): ExportResult | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const parsed = exportResultSchema.safeParse((payload as { result?: unknown }).result);
  return parsed.success ? parsed.data : null;
}

/**
 * Derives an export's status. See the file header.
 *
 * @param input - the job's status, its result, whether the result's object
 *   still exists, and the clock.
 * @returns the status.
 *
 * @example
 * ```ts
 * deriveExportStatus({ jobStatus: 'succeeded', result, objectExists: true, now: new Date() }); // 'ready'
 * ```
 *
 * @stability experimental
 */
export function deriveExportStatus(input: {
  /** The job's status. */
  jobStatus: string;
  /** Its committed result, or `null`. */
  result: ExportResult | null;
  /** Whether the result's storage object still exists (and is `ready`). */
  objectExists: boolean;
  /** Now. */
  now: Date;
}): ExportStatus {
  if (input.result) {
    return input.objectExists && Date.parse(input.result.expiresAt) > input.now.getTime() ? 'ready' : 'expired';
  }
  if (input.jobStatus === 'pending' || input.jobStatus === 'running') return input.jobStatus;
  return 'failed';
}

/**
 * The fields of a job the export view reads.
 *
 * @stability experimental
 */
export interface ExportJobRow {
  /** The export id. */
  id: string;
  /** The job status. */
  status: string;
  /** The payload. */
  payload: unknown;
  /** When it was enqueued. */
  createdAt: Date;
  /** When it settled. */
  finishedAt: Date | null;
}

/**
 * The API view of one export job (without a download).
 *
 * @param job - the job row.
 * @param objectExists - whether its result's object still exists.
 * @param now - the clock.
 * @returns the view, or `null` when the payload is not an export payload.
 *
 * @stability experimental
 */
export function toExportView(job: ExportJobRow, objectExists: boolean, now: Date): ExportView | null {
  const parsed = exportJobPayloadSchema.safeParse(job.payload);
  if (!parsed.success) return null;
  const payload = parsed.data;
  const result = payload.result ?? null;
  const status = deriveExportStatus({ jobStatus: job.status, result, objectExists, now });
  return {
    id: job.id,
    source: payload.source,
    format: payload.format,
    scope: payload.scope,
    orgId: payload.scope === 'org' ? payload.subjectId : null,
    status,
    createdAt: job.createdAt.toISOString(),
    completedAt: result?.completedAt ?? job.finishedAt?.toISOString() ?? null,
    expiresAt: result?.expiresAt ?? null,
    fileName: result?.fileName ?? null,
    mimeType: result?.mimeType ?? null,
    sizeBytes: result?.sizeBytes ?? null,
    rowCounts: result?.rowCounts ?? null,
    error: status === 'failed' ? EXPORT_FAILED_MESSAGE : null,
    download: null,
  };
}
