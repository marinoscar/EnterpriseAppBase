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
// =============================================================================

export const TELEMETRY_ERROR_REASONS = {
  NOT_CONFIGURED: 'TELEMETRY_NOT_CONFIGURED',
  UNREACHABLE: 'TELEMETRY_UNREACHABLE',
  DISABLED: 'TELEMETRY_DISABLED',
  QUERY_REJECTED: 'TELEMETRY_QUERY_REJECTED',
  QUERY_FAILED: 'TELEMETRY_QUERY_FAILED',
  QUERY_TIMEOUT: 'TELEMETRY_QUERY_TIMEOUT',
} as const;

export type TelemetryErrorReason = (typeof TELEMETRY_ERROR_REASONS)[keyof typeof TELEMETRY_ERROR_REASONS];

const STATUS: Record<TelemetryErrorReason, HttpStatus> = {
  TELEMETRY_NOT_CONFIGURED: HttpStatus.SERVICE_UNAVAILABLE,
  TELEMETRY_UNREACHABLE: HttpStatus.SERVICE_UNAVAILABLE,
  TELEMETRY_DISABLED: HttpStatus.CONFLICT,
  TELEMETRY_QUERY_REJECTED: HttpStatus.BAD_REQUEST,
  TELEMETRY_QUERY_FAILED: HttpStatus.BAD_REQUEST,
  TELEMETRY_QUERY_TIMEOUT: HttpStatus.GATEWAY_TIMEOUT,
};

/** A telemetry failure with its reason in `details.reason`. */
export class TelemetryHttpError extends HttpException {
  constructor(
    readonly reason: TelemetryErrorReason,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    // `reason` last, so a caller-supplied detail can never contradict it.
    super({ message, details: { ...details, reason } }, STATUS[reason]);
  }
}
