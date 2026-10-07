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
import type { TelemetryStackDeployStatus } from '@marinoscar/platform-contract/telemetry';
import { isPlatformApiError } from '../../../core/index.js';

// =============================================================================
// Configuration and status (#534)
// =============================================================================

/**
 * `GET /telemetry/config` — the feature flag every signed-in client reads.
 *
 * @stability experimental
 */
export type TelemetryPublicConfig = ContractTelemetryPublicConfig;

/**
 * The stored `telemetry` settings namespace — the `PUT` body, verbatim.
 *
 * @stability experimental
 */
export type TelemetrySettings = ContractTelemetrySettings;

/**
 * `GET /admin/telemetry/config` — the settings plus provenance.
 *
 * @stability experimental
 */
export type TelemetryAdminConfig = TelemetryConfigResponse;

/**
 * `GET /admin/telemetry/status` — a diagnosis, always 200.
 *
 * @stability experimental
 */
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
 *
 * @stability experimental
 */
export type TelemetrySettingsUpdate = UpdateTelemetryConfigInput;





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
/**
 * Where the connection in force comes from: the stored (admin UI) connection, the deployment default (environment) or none.
 *
 * @stability experimental
 */
export type TelemetryConnectionSource = ContractTelemetryConnectionSource;

/**
 * How the connection names its host: `auto` (the GreptimeDB deployed with this application) or `custom`.
 *
 * @stability experimental
 */
export type TelemetryConnectionHostMode = ContractTelemetryConnectionHostMode;

/** GreptimeDB's Postgres-wire port and database when nothing says otherwise. */
export { TELEMETRY_CONNECTION_DEFAULTS };

/**
 * Masked, non-secret facts about one password. Never the password.
 *
 * @stability experimental
 */
export type TelemetryCredentialStatus = ContractTelemetryCredentialStatus;

/**
 * The GreptimeDB deployed with this application, as the deployment describes
 * it (issue #570). What an automatic host uses. Non-secret: never a password.
 *
 * @stability experimental
 */
export type TelemetryDeploymentConnection = ContractTelemetryDeploymentConnection;

/**
 * `GET /admin/telemetry/connection` (and the `PUT` / `DELETE` responses).
 *
 * @stability experimental
 */
export type TelemetryConnection = TelemetryConnectionResponse;

/**
 * AUTOMATIC: the GreptimeDB deployed with this application. The deployment
 * supplies everything else, so nothing else is sent (#570).
 *
 * @stability experimental
 */
export interface TelemetryConnectionAutomaticInput {
  /** No host: the deployment supplies the connection. */
  host: null;
}

/**
 * CUSTOM: an external GreptimeDB. An omitted (or empty) password KEEPS the
 * stored one on save, and means "the connection in force's password" on test.
 *
 * @stability experimental
 */
export interface TelemetryConnectionCustomInput {
  /** The external GreptimeDB's hostname or IP address. */
  host: string;
  /** Omitted: 4003. */
  pgPort?: number;
  /** Omitted: `public`. */
  database?: string;
  /** The read-only login the explorer and dashboard query with. */
  readerUser: string;
  /** The reader's password. Write-only; omitted or empty keeps the stored one. */
  readerPassword?: string;
  /** Null: no admin login (a stored admin password is deleted). */
  adminUser: string | null;
  /** The admin login's password. Write-only; omitted or empty keeps the stored one. */
  adminPassword?: string;
}

/**
 * The `PUT` / `POST …/test` body. INTENTIONALLY NARROWER than the contract's
 * request schema (one object whose fields are all optional): the form sends
 * exactly one of the two shapes the API distinguishes. Each variant is
 * assignable to the contract's input type (pinned in telemetryContract.test.ts).
 *
 * @stability experimental
 */
export type TelemetryConnectionInput =
  | TelemetryConnectionAutomaticInput
  | TelemetryConnectionCustomInput;

/**
 * One probe of a connection test (reader or admin login): whether it connected, and why not.
 *
 * @stability experimental
 */
export type TelemetryConnectionProbe = ContractTelemetryConnectionProbe;

/**
 * A probe the connection test did not run: the admin probe when the candidate has no admin login.
 *
 * @stability experimental
 */
export type TelemetryConnectionSkipped = ContractTelemetryConnectionSkipped;

/**
 * `POST /admin/telemetry/connection/test` — a diagnosis, always 200.
 *
 * @stability experimental
 */
export type TelemetryConnectionTestResult = ContractTelemetryConnectionTestResult;

/**
 * Whether a connection-test probe was skipped rather than run.
 *
 * @param probe - one probe of a {@link TelemetryConnectionTestResult}.
 * @returns `true` for a skipped probe.
 *
 * @stability experimental
 */
export function isTelemetryProbeSkipped(
  probe: TelemetryConnectionProbe | TelemetryConnectionSkipped,
): probe is TelemetryConnectionSkipped {
  return 'skipped' in probe && probe.skipped === true;
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

/**
 * Whether the API can reach the deployment agent that manages the containers.
 *
 * @stability experimental
 */
export type TelemetryStackAgent = TelemetryStackAgentState;

/**
 * The services the API reports today (it may add one: see {@link TelemetryStackService}).
 *
 * @stability experimental
 */
export type TelemetryStackServiceName = 'greptimedb' | 'otel-collector';

/**
 * A telemetry container's state as the deployment agent reports it (`running`, `exited`, ...).
 *
 * @stability experimental
 */
export type TelemetryStackServiceState = ContractTelemetryStackServiceState;

/**
 * A telemetry container's health check result, when it has one.
 *
 * @stability experimental
 */
export type TelemetryStackServiceHealth = ContractTelemetryStackServiceHealth;

/**
 * One telemetry container. INTENTIONALLY LOOSER than the wire: `name` and
 * `state` are typed open-ended so a service or state the API adds later still
 * renders. The contract's type is assignable to it.
 *
 * @stability experimental
 */
export type TelemetryStackService = Omit<ContractTelemetryStackService, 'name' | 'state'> & {
  /** The service name (`greptimedb`, `otel-collector`, or one the API adds later). */
  name: TelemetryStackServiceName | (string & {});
  /** The container state (open-ended, so a new state still renders). */
  state: TelemetryStackServiceState | (string & {});
};

/**
 * The latest deploy job. INTENTIONALLY LOOSER than the wire: `status` is the
 * queue's own (`JOB_STATUSES` in `services/jobs.ts`), open-ended. The
 * contract's type is assignable to it.
 *
 * @stability experimental
 */
export type TelemetryStackDeploy = Omit<ContractTelemetryStackDeploy, 'status'> & {
  /** The deploy job's queue status (open-ended). */
  status: TelemetryStackDeployStatus | (string & {});
};

/**
 * `GET /admin/telemetry/stack`, with the looser {@link TelemetryStackService}
 * and {@link TelemetryStackDeploy}. `agentError` is the deployment agent's own
 * secret-free message when `agent` is `unavailable` or `unauthorized`.
 *
 * @stability experimental
 */
export type TelemetryStack = Omit<TelemetryStackStatus, 'services' | 'deploy'> & {
  /** The telemetry containers. */
  services: TelemetryStackService[];
  /** The latest deploy job, or `null` when none ran. */
  deploy: TelemetryStackDeploy | null;
};



// =============================================================================
// Explorer (#535)
// =============================================================================

/**
 * The PostgreSQL-wire type name: `bool`, `int2`, `int4`, `int8`, `float4`,
 * `float8`, `numeric`, `text`, `bytea`, `date`, `time`, `timestamp`, `json`
 * or `unknown`. `int8` and `numeric` VALUES arrive as strings (no precision
 * loss in JSON). Timestamps are truncated to microseconds by the wire
 * protocol — `CAST(ts AS STRING)` keeps nanoseconds.
 *
 * @stability experimental
 */
export type TelemetryColumnType = ContractTelemetryColumnType;

/**
 * A result column. INTENTIONALLY LOOSER than the wire: `type` is open-ended
 * so a new wire type never breaks the grid. The contract's type is assignable
 * to it.
 *
 * @stability experimental
 */
export type TelemetryColumn = Omit<ContractTelemetryColumn, 'type'> & {
  /** A {@link TelemetryColumnType}; typed loosely so a new one never breaks the grid. */
  type: TelemetryColumnType | (string & {});
};

/**
 * GreptimeDB's role for a schema column.
 *
 * @stability experimental
 */
export type TelemetrySemanticType = ContractTelemetrySemanticType;

/**
 * A schema column. INTENTIONALLY LOOSER than the wire (whose `semanticType`
 * is a nullable string): `semanticType` names the three roles GreptimeDB
 * reports and may be absent. The contract's type is assignable to it.
 *
 * @stability experimental
 */
export type TelemetrySchemaColumn = Omit<ContractTelemetrySchemaColumn, 'semanticType' | 'type'> & {
  /** The PostgreSQL-wire type name (open-ended). */
  type: TelemetryColumn['type'];
  /** GreptimeDB's role for the column (`TAG`, `FIELD`, `TIMESTAMP`), when known. */
  semanticType?: TelemetrySemanticType | (string & {}) | null;
};

/**
 * The longest statement `POST /admin/telemetry/query` accepts. The API
 * enforces it; the browser uses it only to ignore an oversized SQL handoff
 * into the explorer (#579).
 */
export { TELEMETRY_SQL_MAX_LENGTH };

/**
 * `POST /admin/telemetry/query`. Rows are POSITIONAL: names can repeat. Columns as {@link TelemetryColumn}.
 *
 * @stability experimental
 */
export type TelemetryQueryResult = Omit<ContractTelemetryQueryResult, 'columns'> & {
  /** The result columns, positional. */
  columns: TelemetryColumn[];
};

/**
 * One table of `GET /admin/telemetry/schema`, with the looser {@link TelemetrySchemaColumn}.
 *
 * @stability experimental
 */
export type TelemetrySchemaTable = Omit<ContractTelemetrySchemaTable, 'columns'> & {
  /** The table's columns. */
  columns: TelemetrySchemaColumn[];
};

/**
 * `GET /admin/telemetry/schema`, with the looser {@link TelemetrySchemaTable}.
 *
 * @stability experimental
 */
export type TelemetrySchema = Omit<ContractTelemetrySchema, 'tables'> & {
  /** The tables the reader login may query. */
  tables: TelemetrySchemaTable[];
};

/**
 * An export format of `POST /admin/telemetry/export` (the wire enum).
 *
 * @stability experimental
 */
export type TelemetryExportFormat = ContractTelemetryExportFormat;

/**
 * The export formats in MENU order (CSV, Excel, Parquet, NDJSON), which is
 * not the wire enum's order (`csv, ndjson, xlsx, parquet`): a display list
 * over the contract's `TELEMETRY_EXPORT_FORMATS`, holding exactly its values
 * (pinned in telemetryContract.test.ts).
 *
 * @stability experimental
 */
export const TELEMETRY_EXPORT_MENU_ORDER = ['csv', 'xlsx', 'parquet', 'ndjson'] as const satisfies readonly TelemetryExportFormat[];

/**
 * The export menu's formats, in menu order: {@link TELEMETRY_EXPORT_MENU_ORDER}.
 *
 * @stability experimental
 */
export const TELEMETRY_EXPORT_FORMATS = TELEMETRY_EXPORT_MENU_ORDER;

/** The wire enum of export formats, in its own order. */
export { TELEMETRY_EXPORT_WIRE_FORMATS };

/**
 * The export menu's label of each format.
 *
 * @stability experimental
 */
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
 *
 * @stability experimental
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
/**
 * One of {@link TELEMETRY_ERROR_REASONS}.
 *
 * @stability experimental
 */
export type TelemetryErrorReason = (typeof TELEMETRY_ERROR_REASONS)[number];

/**
 * `details.reason` of a telemetry API error, or `null`.
 *
 * @stability experimental
 */
export function telemetryErrorReason(err: unknown): string | null {
  if (!isPlatformApiError(err)) return null;
  const details = err.details;
  if (typeof details === 'object' && details !== null && 'reason' in details) {
    const reason = (details as { reason?: unknown }).reason;
    return typeof reason === 'string' ? reason : null;
  }
  return null;
}



/**
 * `telemetry-<timestamp>.<ext>` — what the server's Content-Disposition names it too.
 *
 * @stability experimental
 */
export function telemetryExportFilename(format: TelemetryExportFormat, now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `telemetry-${stamp}.${format}`;
}

/**
 * Hand a Blob to the browser as a download (object URL + anchor + revoke).
 *
 * @stability experimental
 */
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
 *
 * @stability experimental
 */
export function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  let name: string | null = null;
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (extended) {
    try {
      name = decodeURIComponent(extended[1]!.trim().replace(/^"|"$/g, ''));
    } catch {
      name = null;
    }
  }
  if (!name) {
    const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
    name = plain ? (plain[2] ?? plain[1]!).trim() : null;
  }
  const safe = name?.replace(/[/\\]/g, '_').trim();
  return safe ? safe : null;
}

/**
 * What {@link TelemetryClient.exportTelemetry} resolves with.
 *
 * @stability experimental
 */
export interface TelemetryExportResult {
  /** The downloaded file's name. */
  filename: string;
  /** `X-Telemetry-Row-Count`, or `null` when absent. */
  rowCount: number | null;
  /** `X-Telemetry-Truncated: true` — the export hit the row cap. */
  truncated: boolean;
}


// =============================================================================
// Assistant (#536)
// =============================================================================

/**
 * A tool the troubleshooting assistant may call (the wire enum).
 *
 * @stability experimental
 */
export type TelemetryAssistantTool = TelemetryAssistantToolName;

/**
 * `event: step`. INTENTIONALLY LOOSER than the wire: `tool` is open-ended so
 * a tool the API adds later still renders. The contract's type is assignable
 * to it.
 *
 * @stability experimental
 */
export type TelemetryAssistantStep = Omit<TelemetryAssistantStepEvent, 'tool'> & {
  /** The tool the step called (open-ended, so a new tool still renders). */
  tool: TelemetryAssistantTool | string;
};

/**
 * Whether the assistant's report found an issue, found none, was inconclusive or had no data.
 *
 * @stability experimental
 */
export type TelemetryReportStatus = TelemetryAssistantReportStatus;
/**
 * A finding's severity in the assistant's report.
 *
 * @stability experimental
 */
export type TelemetryFindingSeverity = TelemetryAssistantSeverity;
/**
 * How sure the assistant is of a finding or a report.
 *
 * @stability experimental
 */
export type TelemetryReportConfidence = TelemetryAssistantConfidence;

/**
 * One finding of the assistant's report: what, why, evidence and next step.
 *
 * @stability experimental
 */
export type TelemetryReportFinding = TelemetryAssistantFinding;

/**
 * A query the assistant ran, with its SQL and what it showed.
 *
 * @stability experimental
 */
export type TelemetryReportQuery = TelemetryAssistantQuery;

/**
 * The troubleshooting agent's structured report (#571).
 *
 * @stability experimental
 */
export type TelemetryAssistantReport = ContractTelemetryAssistantReport;

/**
 * `event: answer`. INTENTIONALLY LOOSER than the wire: `report` may be absent
 * (an older API sends none; the stream client normalizes it to `null`). The
 * contract's type is assignable to it.
 *
 * @stability experimental
 */
export type TelemetryAssistantAnswer = Omit<TelemetryAssistantAnswerEvent, 'report'> & {
  /** `null` when the model gave no parseable report; absent on an older API. */
  report?: TelemetryAssistantReport | null;
};

/**
 * One earlier turn sent back as context (`role` plus `content`).
 *
 * @stability experimental
 */
export type TelemetryAssistantTurn = ContractTelemetryAssistantTurn;

/**
 * The request body: `question` (1..4000 characters) and at most 20 `history` turns.
 *
 * @stability experimental
 */
export type TelemetryAssistantRequest = ContractTelemetryAssistantRequest;

/**
 * What {@link TelemetryClient.streamTelemetryAssistant} calls as the stream arrives.
 *
 * @stability experimental
 */
export interface TelemetryAssistantHandlers {
  /** A tool step (`event: step`). */
  onStep?: (step: TelemetryAssistantStep) => void;
  /** The final answer (`event: answer`). */
  onAnswer?: (answer: TelemetryAssistantAnswer) => void;
  /** A failure after streaming began (`event: error`). */
  onError?: (error: { code: string; message: string }) => void;
  /** Aborts the stream; the call then resolves quietly. */
  signal?: AbortSignal;
}
