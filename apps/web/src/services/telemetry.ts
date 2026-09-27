/**
 * Telemetry API client (issue #537, epic #528).
 *
 * The wire shapes mirror the API contract for epic #528:
 *
 *   - `GET  /telemetry/config`                  (#534, any signed-in user)
 *   - `GET  /admin/telemetry/config`            (#534, `telemetry:read`)
 *   - `PUT  /admin/telemetry/config`            (#534, `telemetry:write`, If-Match)
 *   - `GET  /admin/telemetry/status`            (#534, `telemetry:read`)
 *   - `POST /admin/telemetry/query`             (#535, `telemetry:query`)
 *   - `GET  /admin/telemetry/schema`            (#535, `telemetry:query`)
 *   - `POST /admin/telemetry/export`            (#535, `telemetry:query`)
 *   - `POST /admin/telemetry/assistant/stream`  (#536, `telemetry:query` + `ai:use`)
 *
 * The browser only presents and collects. Whether a statement is read-only,
 * how many rows it may return and how long it may run are decided by the API;
 * the SQL typed here is sent verbatim and the server's guard is the gate.
 */
import { api, API_BASE_URL, ApiError, type BlobWithHeaders } from './api';
import { postSse } from './sse';

// =============================================================================
// Configuration and status (#534)
// =============================================================================

/** `GET /telemetry/config` — the feature flag every signed-in client reads. */
export interface TelemetryPublicConfig {
  /** A telemetry store is deployed. False hides every telemetry surface. */
  available: boolean;
  /** `telemetry.enabled` — whether this deployment is collecting. */
  enabled: boolean;
  /** `telemetry.assistant.enabled`. Whether AI itself is on is `GET /ai/config`. */
  assistantEnabled: boolean;
}

/** The stored `telemetry` settings namespace — the `PUT` body, verbatim. */
export interface TelemetrySettings {
  enabled: boolean;
  /** 1..3650. */
  retentionDays: number;
  query: {
    /** 1..100000. */
    maxRows: number;
    /** 1..120. */
    timeoutSeconds: number;
  };
  assistant: {
    enabled: boolean;
    provider: string | null;
    modelId: string | null;
    shareResults: boolean;
    /** 1..100. */
    maxResultRowsToModel: number;
    /** 1..12. */
    maxSteps: number;
  };
}

/** `GET /admin/telemetry/config` — the settings plus provenance. */
export interface TelemetryAdminConfig extends TelemetrySettings {
  available: boolean;
  /** Whether the GreptimeDB admin credential is set, which retention needs. */
  retentionApplicable: boolean;
  /** Send back as `If-Match`. `0` when nothing is stored yet. */
  version: number;
  updatedAt: string | null;
  updatedBy: { id: string; email: string } | null;
}

/** `GET /admin/telemetry/status` — a diagnosis, always 200. */
export interface TelemetryStatus {
  configured: boolean;
  reachable: boolean;
  version: string | null;
  database: string;
  ttl: { raw: string; days: number | null } | null;
  retentionDays: number;
  tables: { name: string; rows: number | null }[];
  error: string | null;
}

export const TELEMETRY_LIMITS = {
  retentionDays: { min: 1, max: 3650 },
  maxRows: { min: 1, max: 100000 },
  timeoutSeconds: { min: 1, max: 120 },
  maxResultRowsToModel: { min: 1, max: 100 },
  maxSteps: { min: 1, max: 12 },
} as const;

export async function getTelemetryConfig(): Promise<TelemetryPublicConfig> {
  return api.get<TelemetryPublicConfig>('/telemetry/config');
}

export async function getTelemetryAdminConfig(): Promise<TelemetryAdminConfig> {
  return api.get<TelemetryAdminConfig>('/admin/telemetry/config');
}

/**
 * Replace the telemetry settings. `expectedVersion` travels as `If-Match`; a
 * stale version answers 409, the same convention as the AI admin config.
 */
export async function updateTelemetryAdminConfig(
  settings: TelemetrySettings,
  expectedVersion?: number,
): Promise<TelemetryAdminConfig> {
  return api.put<TelemetryAdminConfig>('/admin/telemetry/config', settings, {
    headers:
      expectedVersion === undefined ? undefined : { 'If-Match': String(expectedVersion) },
  });
}

export async function getTelemetryStatus(): Promise<TelemetryStatus> {
  return api.get<TelemetryStatus>('/admin/telemetry/status');
}

// =============================================================================
// Explorer (#535)
// =============================================================================

/**
 * The PostgreSQL-wire type name: `bool`, `int2`, `int4`, `int8`, `float4`,
 * `float8`, `numeric`, `text`, `bytea`, `date`, `time`, `timestamp`, `json`
 * or `unknown`. `int8` and `numeric` VALUES arrive as strings (no precision
 * loss in JSON). Timestamps are truncated to microseconds by the wire
 * protocol — `CAST(ts AS STRING)` keeps nanoseconds.
 */
export type TelemetryColumnType =
  | 'bool'
  | 'int2'
  | 'int4'
  | 'int8'
  | 'float4'
  | 'float8'
  | 'numeric'
  | 'text'
  | 'bytea'
  | 'date'
  | 'time'
  | 'timestamp'
  | 'json'
  | 'unknown';

export interface TelemetryColumn {
  name: string;
  /** A {@link TelemetryColumnType}; typed loosely so a new one never breaks the grid. */
  type: TelemetryColumnType | (string & {});
}

/** GreptimeDB's role for a schema column. */
export type TelemetrySemanticType = 'TAG' | 'FIELD' | 'TIMESTAMP';

export interface TelemetrySchemaColumn extends TelemetryColumn {
  semanticType?: TelemetrySemanticType | null;
}

/** `POST /admin/telemetry/query`. Rows are POSITIONAL: names can repeat. */
export interface TelemetryQueryResult {
  columns: TelemetryColumn[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
}

export interface TelemetrySchemaTable {
  name: string;
  rows: number | null;
  columns: TelemetrySchemaColumn[];
}

export interface TelemetrySchema {
  tables: TelemetrySchemaTable[];
}

export const TELEMETRY_EXPORT_FORMATS = ['csv', 'xlsx', 'parquet', 'ndjson'] as const;
export type TelemetryExportFormat = (typeof TELEMETRY_EXPORT_FORMATS)[number];

export const TELEMETRY_EXPORT_LABELS: Record<TelemetryExportFormat, string> = {
  csv: 'CSV',
  xlsx: 'Excel (.xlsx)',
  parquet: 'Parquet',
  ndjson: 'NDJSON',
};

/**
 * The telemetry REASONS the explorer routes answer with. The envelope's
 * `code` is derived from the HTTP status; the reason is `details.reason`
 * (read it with {@link telemetryErrorReason}).
 */
export const TELEMETRY_ERROR_REASONS = [
  'TELEMETRY_NOT_CONFIGURED', // 503
  'TELEMETRY_UNREACHABLE', // 503
  'TELEMETRY_DISABLED', // 409
  'TELEMETRY_QUERY_REJECTED', // 400 — the SQL guard refused it
  'TELEMETRY_QUERY_FAILED', // 400 — the database reported an error (+ details.sqlState)
  'TELEMETRY_QUERY_TIMEOUT', // 504 (+ details.timeoutMs)
  'TELEMETRY_ASSISTANT_DISABLED', // 409
] as const;
export type TelemetryErrorReason = (typeof TELEMETRY_ERROR_REASONS)[number];

/** `details.reason` of a telemetry `ApiError`, or `null`. */
export function telemetryErrorReason(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const details = err.details;
  if (typeof details === 'object' && details !== null && 'reason' in details) {
    const reason = (details as { reason?: unknown }).reason;
    return typeof reason === 'string' ? reason : null;
  }
  return null;
}

export async function runTelemetryQuery(
  sql: string,
  options: { maxRows?: number; signal?: AbortSignal } = {},
): Promise<TelemetryQueryResult> {
  const body: { sql: string; maxRows?: number } = { sql };
  if (options.maxRows !== undefined) body.maxRows = options.maxRows;
  return api.post<TelemetryQueryResult>('/admin/telemetry/query', body, {
    signal: options.signal,
  });
}

export async function getTelemetrySchema(): Promise<TelemetrySchema> {
  return api.get<TelemetrySchema>('/admin/telemetry/schema');
}

/** `telemetry-<timestamp>.<ext>` — what the server's Content-Disposition names it too. */
export function telemetryExportFilename(format: TelemetryExportFormat, now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `telemetry-${stamp}.${format}`;
}

/** Hand a Blob to the browser as a download (object URL + anchor + revoke). */
export function downloadBlob(blob: Blob, filename: string): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } finally {
    // Deferred: revoking synchronously can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * The filename from a `Content-Disposition` header (`filename*=UTF-8''…` or
 * `filename="…"` / `filename=…`), or `null`. Path separators are stripped.
 */
export function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  let name: string | null = null;
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (extended) {
    try {
      name = decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''));
    } catch {
      name = null;
    }
  }
  if (!name) {
    const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
    name = plain ? (plain[2] ?? plain[1]).trim() : null;
  }
  const safe = name?.replace(/[/\\]/g, '_').trim();
  return safe ? safe : null;
}

export interface TelemetryExportResult {
  filename: string;
  /** `X-Telemetry-Row-Count`, or `null` when absent. */
  rowCount: number | null;
  /** `X-Telemetry-Truncated: true` — the export hit the row cap. */
  truncated: boolean;
}

/**
 * `POST /admin/telemetry/export` — fetched as a Blob through the same
 * authenticated client (bearer token, 401 → refresh → retry), then handed to
 * the browser as a download named by `Content-Disposition`. Resolves with the
 * filename and the row-count/truncation headers.
 */
export async function exportTelemetry(
  sql: string,
  format: TelemetryExportFormat,
): Promise<TelemetryExportResult> {
  const { blob, headers } = await api.post<BlobWithHeaders>(
    '/admin/telemetry/export',
    { sql, format },
    { responseType: 'blobWithHeaders' },
  );
  const filename =
    filenameFromContentDisposition(headers.get('Content-Disposition')) ??
    telemetryExportFilename(format);
  downloadBlob(blob, filename);
  const rawCount = headers.get('X-Telemetry-Row-Count');
  const rowCount = rawCount !== null && rawCount.trim() !== '' ? Number(rawCount) : null;
  return {
    filename,
    rowCount: rowCount !== null && Number.isFinite(rowCount) ? rowCount : null,
    truncated: (headers.get('X-Telemetry-Truncated') ?? '').toLowerCase() === 'true',
  };
}

// =============================================================================
// Assistant (#536)
// =============================================================================

export type TelemetryAssistantTool = 'list_tables' | 'describe_table' | 'run_query';

export interface TelemetryAssistantStep {
  index: number;
  tool: TelemetryAssistantTool | string;
  input?: { table?: string; sql?: string };
  rowCount?: number;
  truncated?: boolean;
  durationMs: number;
  error?: string;
}

export interface TelemetryAssistantAnswer {
  sql: string | null;
  explanation: string;
}

export interface TelemetryAssistantTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface TelemetryAssistantRequest {
  /** 1..4000 characters. */
  question: string;
  /** At most 20 turns. */
  history?: TelemetryAssistantTurn[];
}

export interface TelemetryAssistantHandlers {
  onStep?: (step: TelemetryAssistantStep) => void;
  onAnswer?: (answer: TelemetryAssistantAnswer) => void;
  onError?: (error: { code: string; message: string }) => void;
  signal?: AbortSignal;
}

export function telemetryAssistantStreamUrl(): string {
  return `${API_BASE_URL}/admin/telemetry/assistant/stream`;
}

/**
 * Stream one assistant turn. Resolves when the stream ends (or quietly on
 * abort). REJECTS with `ApiError` when a gate refused the request before the
 * first byte (`TELEMETRY_ASSISTANT_DISABLED`, `AI_DISABLED`, …).
 */
export async function streamTelemetryAssistant(
  request: TelemetryAssistantRequest,
  handlers: TelemetryAssistantHandlers = {},
): Promise<void> {
  await postSse<Record<string, unknown>>({
    url: telemetryAssistantStreamUrl(),
    body: request,
    authorization: () => {
      const token = api.getAccessToken();
      return token ? `Bearer ${token}` : null;
    },
    reauthenticate: () => api.refreshToken(),
    signal: handlers.signal,
    onFrame: (eventName, data) => {
      const payload = typeof data === 'object' && data !== null ? data : {};
      switch (eventName) {
        case 'step':
          handlers.onStep?.(payload as unknown as TelemetryAssistantStep);
          break;
        case 'answer':
          handlers.onAnswer?.(payload as unknown as TelemetryAssistantAnswer);
          break;
        case 'error':
          handlers.onError?.({
            code: String((payload as { code?: unknown }).code ?? 'ERROR'),
            message: String((payload as { message?: unknown }).message ?? 'The assistant failed'),
          });
          break;
        default:
          break;
      }
    },
  });
}
