/**
 * Telemetry API client (issue #537, epic #528).
 *
 * The routes this client calls (epic #528):
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
 *
 * THE WIRE SHAPES ARE `@marinoscar/platform-contract/telemetry` (#702): the
 * same zod schemas the API's DTOs wrap. This file aliases the contract's types
 * to the names the components already use, and re-exports its zod-free
 * constants. Types are imported with `import type` and values come from the
 * contract's constants module only, so zod never reaches the bundle
 * (`"sideEffects": false`). Where a web type deliberately differs from the
 * wire (looser, for a server ahead of or behind this build, or narrower, for
 * a form), it is derived from the contract type, says why, and
 * `src/__tests__/services/telemetryContract.test.ts` pins the relation.
 */
import {
  TELEMETRY_CONNECTION_DEFAULTS,
  TELEMETRY_CONNECTION_SOURCES,
  TELEMETRY_EXPORT_FORMATS as TELEMETRY_EXPORT_WIRE_FORMATS,
  TELEMETRY_INSTANCE_ID_PATTERN,
  TELEMETRY_LIMITS,
  TELEMETRY_SQL_MAX_LENGTH,
} from '@marinoscar/platform-contract/telemetry';
import type {
  TelemetryAssistantAnswerEvent,
  TelemetryAssistantConfidence,
  TelemetryAssistantFinding,
  TelemetryAssistantQuery,
  TelemetryAssistantReport as ContractTelemetryAssistantReport,
  TelemetryAssistantReportStatus,
  TelemetryAssistantRequest as ContractTelemetryAssistantRequest,
  TelemetryAssistantSeverity,
  TelemetryAssistantStepEvent,
  TelemetryAssistantToolName,
  TelemetryAssistantTurn as ContractTelemetryAssistantTurn,
  TelemetryColumn as ContractTelemetryColumn,
  TelemetryColumnType as ContractTelemetryColumnType,
  TelemetryConfigResponse,
  TelemetryConnectionHostMode as ContractTelemetryConnectionHostMode,
  TelemetryConnectionProbe as ContractTelemetryConnectionProbe,
  TelemetryConnectionResponse,
  TelemetryConnectionSkipped as ContractTelemetryConnectionSkipped,
  TelemetryConnectionSource as ContractTelemetryConnectionSource,
  TelemetryConnectionTestResult as ContractTelemetryConnectionTestResult,
  TelemetryCredentialStatus as ContractTelemetryCredentialStatus,
  TelemetryDeploymentConnection as ContractTelemetryDeploymentConnection,
  TelemetryExportFormat as ContractTelemetryExportFormat,
  TelemetryPublicConfig as ContractTelemetryPublicConfig,
  TelemetryQueryResult as ContractTelemetryQueryResult,
  TelemetrySchema as ContractTelemetrySchema,
  TelemetrySchemaColumn as ContractTelemetrySchemaColumn,
  TelemetrySchemaTable as ContractTelemetrySchemaTable,
  TelemetrySemanticType as ContractTelemetrySemanticType,
  TelemetrySettings as ContractTelemetrySettings,
  TelemetryStackAgentState,
  TelemetryStackDeploy as ContractTelemetryStackDeploy,
  TelemetryStackService as ContractTelemetryStackService,
  TelemetryStackServiceHealth as ContractTelemetryStackServiceHealth,
  TelemetryStackServiceState as ContractTelemetryStackServiceState,
  TelemetryStackStatus,
  TelemetryStatus as ContractTelemetryStatus,
  UpdateTelemetryConfigInput,
} from '@marinoscar/platform-contract/telemetry';
import { api, API_BASE_URL, ApiError, type BlobWithHeaders } from './api';
import { postSse } from './sse';
import type { JobStatusName } from './jobs';

// =============================================================================
// Configuration and status (#534)
// =============================================================================

/** `GET /telemetry/config` — the feature flag every signed-in client reads. */
export type TelemetryPublicConfig = ContractTelemetryPublicConfig;

/** The stored `telemetry` settings namespace — the `PUT` body, verbatim. */
export type TelemetrySettings = ContractTelemetrySettings;

/** `GET /admin/telemetry/config` — the settings plus provenance. */
export type TelemetryAdminConfig = TelemetryConfigResponse;

/** `GET /admin/telemetry/status` — a diagnosis, always 200. */
export type TelemetryStatus = ContractTelemetryStatus;

/** The bounds of every numeric setting; the settings schema is built from them. */
export { TELEMETRY_LIMITS };

/**
 * `telemetry.instanceId`'s pattern: 1-63 characters, lowercase letters,
 * digits, `.`, `_` or `-`, starting with a letter or digit. A convenience for
 * inline feedback — the API is the gate.
 */
export { TELEMETRY_INSTANCE_ID_PATTERN };

/**
 * The `PUT /admin/telemetry/config` body: the stored namespace, except that
 * `instanceId` may be omitted (absent keeps the stored value, `null` resets it
 * to the default, a string overrides it).
 */
export type TelemetrySettingsUpdate = UpdateTelemetryConfigInput;

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
  settings: TelemetrySettingsUpdate,
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
// GreptimeDB connection (#558)
// =============================================================================
//
//   - `GET    /admin/telemetry/connection`       (`telemetry:read`)
//   - `PUT    /admin/telemetry/connection`       (`telemetry:write`, If-Match)
//   - `DELETE /admin/telemetry/connection`       (`telemetry:write`, If-Match)
//   - `POST   /admin/telemetry/connection/test`  (`telemetry:write`, always 200)
//
// Passwords are WRITE-ONLY: they appear in request bodies and never in a
// response, which carries only a masked `credentials.<login>` status. Its
// `version` is the stored connection's own counter — NOT `/config`'s.

export { TELEMETRY_CONNECTION_SOURCES };
export type TelemetryConnectionSource = ContractTelemetryConnectionSource;

export type TelemetryConnectionHostMode = ContractTelemetryConnectionHostMode;

/** GreptimeDB's Postgres-wire port and database when nothing says otherwise. */
export { TELEMETRY_CONNECTION_DEFAULTS };

/** Masked, non-secret facts about one password. Never the password. */
export type TelemetryCredentialStatus = ContractTelemetryCredentialStatus;

/**
 * The GreptimeDB deployed with this application, as the deployment describes
 * it (issue #570). What an automatic host uses. Non-secret: never a password.
 */
export type TelemetryDeploymentConnection = ContractTelemetryDeploymentConnection;

/** `GET /admin/telemetry/connection` (and the `PUT` / `DELETE` responses). */
export type TelemetryConnection = TelemetryConnectionResponse;

/**
 * AUTOMATIC: the GreptimeDB deployed with this application. The deployment
 * supplies everything else, so nothing else is sent (#570).
 */
export interface TelemetryConnectionAutomaticInput {
  host: null;
}

/**
 * CUSTOM: an external GreptimeDB. An omitted (or empty) password KEEPS the
 * stored one on save, and means "the connection in force's password" on test.
 */
export interface TelemetryConnectionCustomInput {
  host: string;
  /** Omitted: 4003. */
  pgPort?: number;
  /** Omitted: `public`. */
  database?: string;
  readerUser: string;
  readerPassword?: string;
  /** Null: no admin login (a stored admin password is deleted). */
  adminUser: string | null;
  adminPassword?: string;
}

/**
 * The `PUT` / `POST …/test` body. INTENTIONALLY NARROWER than the contract's
 * request schema (one object whose fields are all optional): the form sends
 * exactly one of the two shapes the API distinguishes. Each variant is
 * assignable to the contract's input type (pinned in telemetryContract.test.ts).
 */
export type TelemetryConnectionInput =
  | TelemetryConnectionAutomaticInput
  | TelemetryConnectionCustomInput;

export type TelemetryConnectionProbe = ContractTelemetryConnectionProbe;

export type TelemetryConnectionSkipped = ContractTelemetryConnectionSkipped;

/** `POST /admin/telemetry/connection/test` — a diagnosis, always 200. */
export type TelemetryConnectionTestResult = ContractTelemetryConnectionTestResult;

export function isTelemetryProbeSkipped(
  probe: TelemetryConnectionProbe | TelemetryConnectionSkipped,
): probe is TelemetryConnectionSkipped {
  return 'skipped' in probe && probe.skipped === true;
}

function ifMatch(expectedVersion: number | undefined) {
  return expectedVersion === undefined ? undefined : { 'If-Match': String(expectedVersion) };
}

export async function getTelemetryConnection(): Promise<TelemetryConnection> {
  return api.get<TelemetryConnection>('/admin/telemetry/connection');
}

export async function updateTelemetryConnection(
  input: TelemetryConnectionInput,
  expectedVersion?: number,
): Promise<TelemetryConnection> {
  return api.put<TelemetryConnection>('/admin/telemetry/connection', input, {
    headers: ifMatch(expectedVersion),
  });
}

/** Forget the stored connection: the deployment default (environment) or none is in force again. */
export async function resetTelemetryConnection(
  expectedVersion?: number,
): Promise<TelemetryConnection> {
  return api.delete<TelemetryConnection>('/admin/telemetry/connection', {
    headers: ifMatch(expectedVersion),
  });
}

export async function testTelemetryConnection(
  input: TelemetryConnectionInput,
): Promise<TelemetryConnectionTestResult> {
  return api.post<TelemetryConnectionTestResult>('/admin/telemetry/connection/test', input);
}

// =============================================================================
// Telemetry services — deploy the GreptimeDB stack (#567)
// =============================================================================
//
//   - `GET  /admin/telemetry/stack`         (`system_settings:read`)
//   - `POST /admin/telemetry/stack/deploy`  (`system_settings:write`, 202; 409 without an agent)
//
// The browser only shows what the API reports and asks it to (re)deploy; the
// deployment itself is a queue job run server-side.

/** Whether the API can reach the deployment agent that manages the containers. */
export type TelemetryStackAgent = TelemetryStackAgentState;

/** The services the API reports today (it may add one: see {@link TelemetryStackService}). */
export type TelemetryStackServiceName = 'greptimedb' | 'otel-collector';

export type TelemetryStackServiceState = ContractTelemetryStackServiceState;

export type TelemetryStackServiceHealth = ContractTelemetryStackServiceHealth;

/**
 * One telemetry container. INTENTIONALLY LOOSER than the wire: `name` and
 * `state` are typed open-ended so a service or state the API adds later still
 * renders. The contract's type is assignable to it.
 */
export type TelemetryStackService = Omit<ContractTelemetryStackService, 'name' | 'state'> & {
  name: TelemetryStackServiceName | (string & {});
  state: TelemetryStackServiceState | (string & {});
};

/**
 * The latest deploy job. INTENTIONALLY LOOSER than the wire: `status` is the
 * queue's own (`JOB_STATUSES` in `services/jobs.ts`), open-ended. The
 * contract's type is assignable to it.
 */
export type TelemetryStackDeploy = Omit<ContractTelemetryStackDeploy, 'status'> & {
  status: JobStatusName | (string & {});
};

/**
 * `GET /admin/telemetry/stack`, with the looser {@link TelemetryStackService}
 * and {@link TelemetryStackDeploy}. `agentError` is the deployment agent's own
 * secret-free message when `agent` is `unavailable` or `unauthorized`.
 */
export type TelemetryStack = Omit<TelemetryStackStatus, 'services' | 'deploy'> & {
  services: TelemetryStackService[];
  deploy: TelemetryStackDeploy | null;
};

export async function getTelemetryStack(): Promise<TelemetryStack> {
  return api.get<TelemetryStack>('/admin/telemetry/stack');
}

/** Enqueue a (re)deploy of the telemetry services. */
export async function deployTelemetryStack(): Promise<{ jobId: string }> {
  return api.post<{ jobId: string }>('/admin/telemetry/stack/deploy');
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
export type TelemetryColumnType = ContractTelemetryColumnType;

/**
 * A result column. INTENTIONALLY LOOSER than the wire: `type` is open-ended
 * so a new wire type never breaks the grid. The contract's type is assignable
 * to it.
 */
export type TelemetryColumn = Omit<ContractTelemetryColumn, 'type'> & {
  /** A {@link TelemetryColumnType}; typed loosely so a new one never breaks the grid. */
  type: TelemetryColumnType | (string & {});
};

/** GreptimeDB's role for a schema column. */
export type TelemetrySemanticType = ContractTelemetrySemanticType;

/**
 * A schema column. INTENTIONALLY LOOSER than the wire (whose `semanticType`
 * is a nullable string): `semanticType` names the three roles GreptimeDB
 * reports and may be absent. The contract's type is assignable to it.
 */
export type TelemetrySchemaColumn = Omit<ContractTelemetrySchemaColumn, 'semanticType' | 'type'> & {
  type: TelemetryColumn['type'];
  semanticType?: TelemetrySemanticType | (string & {}) | null;
};

/**
 * The longest statement `POST /admin/telemetry/query` accepts. The API
 * enforces it; the browser uses it only to ignore an oversized SQL handoff
 * into the explorer (#579).
 */
export { TELEMETRY_SQL_MAX_LENGTH };

/** `POST /admin/telemetry/query`. Rows are POSITIONAL: names can repeat. Columns as {@link TelemetryColumn}. */
export type TelemetryQueryResult = Omit<ContractTelemetryQueryResult, 'columns'> & {
  columns: TelemetryColumn[];
};

/** One table of `GET /admin/telemetry/schema`, with the looser {@link TelemetrySchemaColumn}. */
export type TelemetrySchemaTable = Omit<ContractTelemetrySchemaTable, 'columns'> & {
  columns: TelemetrySchemaColumn[];
};

/** `GET /admin/telemetry/schema`, with the looser {@link TelemetrySchemaTable}. */
export type TelemetrySchema = Omit<ContractTelemetrySchema, 'tables'> & {
  tables: TelemetrySchemaTable[];
};

export type TelemetryExportFormat = ContractTelemetryExportFormat;

/**
 * The export formats in MENU order (CSV, Excel, Parquet, NDJSON), which is
 * not the wire enum's order (`csv, ndjson, xlsx, parquet`): a display list
 * over the contract's `TELEMETRY_EXPORT_FORMATS`, holding exactly its values
 * (pinned in telemetryContract.test.ts).
 */
export const TELEMETRY_EXPORT_MENU_ORDER = ['csv', 'xlsx', 'parquet', 'ndjson'] as const satisfies readonly TelemetryExportFormat[];

/** The export menu's formats, in menu order: {@link TELEMETRY_EXPORT_MENU_ORDER}. */
export const TELEMETRY_EXPORT_FORMATS = TELEMETRY_EXPORT_MENU_ORDER;

/** The wire enum of export formats, in its own order. */
export { TELEMETRY_EXPORT_WIRE_FORMATS };

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

export type TelemetryAssistantTool = TelemetryAssistantToolName;

/**
 * `event: step`. INTENTIONALLY LOOSER than the wire: `tool` is open-ended so
 * a tool the API adds later still renders. The contract's type is assignable
 * to it.
 */
export type TelemetryAssistantStep = Omit<TelemetryAssistantStepEvent, 'tool'> & {
  tool: TelemetryAssistantTool | string;
};

export type TelemetryReportStatus = TelemetryAssistantReportStatus;
export type TelemetryFindingSeverity = TelemetryAssistantSeverity;
export type TelemetryReportConfidence = TelemetryAssistantConfidence;

export type TelemetryReportFinding = TelemetryAssistantFinding;

export type TelemetryReportQuery = TelemetryAssistantQuery;

/** The troubleshooting agent's structured report (#571). */
export type TelemetryAssistantReport = ContractTelemetryAssistantReport;

/**
 * `event: answer`. INTENTIONALLY LOOSER than the wire: `report` may be absent
 * (an older API sends none; the stream client normalizes it to `null`). The
 * contract's type is assignable to it.
 */
export type TelemetryAssistantAnswer = Omit<TelemetryAssistantAnswerEvent, 'report'> & {
  /** `null` when the model gave no parseable report; absent on an older API. */
  report?: TelemetryAssistantReport | null;
};

export type TelemetryAssistantTurn = ContractTelemetryAssistantTurn;

/** The request body: `question` (1..4000 characters) and at most 20 `history` turns. */
export type TelemetryAssistantRequest = ContractTelemetryAssistantRequest;

export interface TelemetryAssistantHandlers {
  onStep?: (step: TelemetryAssistantStep) => void;
  onAnswer?: (answer: TelemetryAssistantAnswer) => void;
  onError?: (error: { code: string; message: string }) => void;
  signal?: AbortSignal;
}

/** An older API sends no `report`; a newer one may send `null`. Both read as `null`. */
function normalizeAssistantAnswer(payload: Record<string, unknown>): TelemetryAssistantAnswer {
  const answer = payload as unknown as TelemetryAssistantAnswer;
  const report = answer.report;
  return {
    ...answer,
    report: report && typeof report === 'object' ? report : null,
  };
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
          handlers.onAnswer?.(normalizeAssistantAnswer(payload));
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
