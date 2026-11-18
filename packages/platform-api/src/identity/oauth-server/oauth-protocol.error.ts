// =============================================================================
// Protocol errors (RFC 6749 §5.2) of the authorization server (PP-15.4)
// =============================================================================
//
// A protocol endpoint answers `{ error, error_description? }` at the TOP LEVEL,
// never the platform's error body, because third-party clients branch on `error`
// (`invalid_grant` means "reconnect"). The exception carries the status, the
// body and any headers (`WWW-Authenticate`, `Retry-After`); the dedicated
// `OAuthProtocolExceptionFilter` writes it. It is also branded
// `withVerbatimErrorBody`, so the global filter would send the same body.
// =============================================================================

import { HttpException } from '@nestjs/common';

import { withVerbatimErrorBody } from '../../core/index';
import type { OAuthErrorCode } from '@marinoscar/platform-contract/identity';

/**
 * A protocol error the authorization server answers with.
 *
 * @stability experimental
 */
export class OAuthProtocolError extends HttpException {
  /** The OAuth error code. */
  readonly code: OAuthErrorCode;
  /** Extra response headers (`WWW-Authenticate`, `Retry-After`). */
  readonly headers: Readonly<Record<string, string>>;

  /**
   * @param status - the HTTP status (400, 401, 429, 500).
   * @param code - the OAuth error code.
   * @param description - a human sentence; never a secret and never the caller's input.
   * @param headers - extra response headers.
   */
  constructor(status: number, code: OAuthErrorCode, description?: string, headers: Record<string, string> = {}) {
    super(description ? { error: code, error_description: description } : { error: code }, status);
    this.code = code;
    this.headers = Object.freeze({ ...headers });
    withVerbatimErrorBody(this);
  }
}

/** `400` with `code`. */
export function oauthError(code: OAuthErrorCode, description?: string): OAuthProtocolError {
  return new OAuthProtocolError(400, code, description);
}

/** `401 invalid_client` with `WWW-Authenticate: Basic` (RFC 6749 §5.2). */
export function invalidClient(description = 'Client authentication failed.'): OAuthProtocolError {
  return new OAuthProtocolError(401, 'invalid_client', description, { 'WWW-Authenticate': 'Basic realm="oauth", charset="UTF-8"' });
}

/** `429 temporarily_unavailable` with `Retry-After` (whole seconds). */
export function rateLimited(retryAfterSeconds: number): OAuthProtocolError {
  return new OAuthProtocolError(429, 'temporarily_unavailable', 'Too many requests.', { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) });
}
