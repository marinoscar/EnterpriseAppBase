import { HttpException, HttpStatus } from '@nestjs/common';

// =============================================================================
// HTTP failures of the telemetry explorer (issue #535, epic #528)
// =============================================================================
//
// The error envelope derives `code` from the status (docs/API.md), so the
// machine-readable reason travels in `details.reason`, exactly like
// `AI_DISABLED`. One status per reason:
//
//   TELEMETRY_NOT_CONFIGURED  503  no telemetry store in this deployment (the
//                                  overlay is not deployed). 503 rather than
//                                  404: the ROUTE exists, the service behind
//                                  it does not — and `GET …/status` already
//                                  reports `configured: false` with a 200.
//   TELEMETRY_UNREACHABLE     503  configured, but the store did not answer.
//   TELEMETRY_DISABLED        409  `telemetry.enabled` is off — a state an
//                                  administrator can change (same status the
//                                  AI kill switch's admin-facing errors use for
//                                  "the configuration forbids this now").
//   TELEMETRY_QUERY_REJECTED  400  the SQL guard refused the statement.
//   TELEMETRY_QUERY_FAILED    400  GreptimeDB refused or failed the statement
//                                  (syntax, unknown column, not permitted).
//                                  The message is the server's own: it is
//                                  about the caller's SQL and carries no
//                                  credential.
//   TELEMETRY_QUERY_TIMEOUT   504  the statement outran
//                                  `telemetry.query.timeoutSeconds`.
//
// The assistant (#536) adds two, both 409 for the same reason as DISABLED
// (an administrator can change the configuration that forbids this):
//
//   TELEMETRY_ASSISTANT_DISABLED        409  `telemetry.assistant.enabled` is off.
//   TELEMETRY_ASSISTANT_NOT_CONFIGURED  409  no `assistant.provider`/`modelId`.
//
// The dashboard (#577) adds two request errors:
//
//   TELEMETRY_DASHBOARD_BAD_FILTER  400  `service`/`instance` is not among the
//                                        values seen in the requested range.
//   TELEMETRY_DASHBOARD_BAD_CURSOR  400  the events `cursor` is malformed.
// =============================================================================

/**
 * The `details.reason` of every telemetry error (see the table above).
 *
 * @stability stable
 */
export const TELEMETRY_ERROR_REASONS = {
  /** 503: no telemetry store is configured. */
  NOT_CONFIGURED: 'TELEMETRY_NOT_CONFIGURED',
  /** 503: the store did not answer. */
  UNREACHABLE: 'TELEMETRY_UNREACHABLE',
  /** 409: `telemetry.enabled` is off. */
  DISABLED: 'TELEMETRY_DISABLED',
  /** 400: the SQL guard refused the statement. */
  QUERY_REJECTED: 'TELEMETRY_QUERY_REJECTED',
  /** 400: the store refused the statement. */
  QUERY_FAILED: 'TELEMETRY_QUERY_FAILED',
  /** 504: the statement timed out. */
  QUERY_TIMEOUT: 'TELEMETRY_QUERY_TIMEOUT',
  /** 409: `telemetry.assistant.enabled` is off. */
  ASSISTANT_DISABLED: 'TELEMETRY_ASSISTANT_DISABLED',
  /** 409: no assistant provider or model is selected. */
  ASSISTANT_NOT_CONFIGURED: 'TELEMETRY_ASSISTANT_NOT_CONFIGURED',
  /** 400: a dashboard filter value was not seen in the range. */
  DASHBOARD_BAD_FILTER: 'TELEMETRY_DASHBOARD_BAD_FILTER',
  /** 400: the events `cursor` is malformed. */
  DASHBOARD_BAD_CURSOR: 'TELEMETRY_DASHBOARD_BAD_CURSOR',
} as const;

/**
 * One of {@link TELEMETRY_ERROR_REASONS}.
 *
 * @stability stable
 */
export type TelemetryErrorReason = (typeof TELEMETRY_ERROR_REASONS)[keyof typeof TELEMETRY_ERROR_REASONS];

const STATUS: Record<TelemetryErrorReason, HttpStatus> = {
  TELEMETRY_NOT_CONFIGURED: HttpStatus.SERVICE_UNAVAILABLE,
  TELEMETRY_UNREACHABLE: HttpStatus.SERVICE_UNAVAILABLE,
  TELEMETRY_DISABLED: HttpStatus.CONFLICT,
  TELEMETRY_QUERY_REJECTED: HttpStatus.BAD_REQUEST,
  TELEMETRY_QUERY_FAILED: HttpStatus.BAD_REQUEST,
  TELEMETRY_QUERY_TIMEOUT: HttpStatus.GATEWAY_TIMEOUT,
  TELEMETRY_ASSISTANT_DISABLED: HttpStatus.CONFLICT,
  TELEMETRY_ASSISTANT_NOT_CONFIGURED: HttpStatus.CONFLICT,
  TELEMETRY_DASHBOARD_BAD_FILTER: HttpStatus.BAD_REQUEST,
  TELEMETRY_DASHBOARD_BAD_CURSOR: HttpStatus.BAD_REQUEST,
};

/**
 * A telemetry failure with its reason in `details.reason`; the HTTP status
 * follows from the reason.
 *
 * @stability stable
 */
export class TelemetryHttpError extends HttpException {
  constructor(
    /** Why it failed. */
    readonly reason: TelemetryErrorReason,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    // `reason` last, so a caller-supplied detail can never contradict it.
    super({ message, details: { ...details, reason } }, STATUS[reason]);
  }
}
