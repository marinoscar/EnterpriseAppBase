import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { BUILTIN_ERROR_CODES, FALLBACK_ERROR_CODE } from './error-codes';

/**
 * The error body this API returns for every endpoint but one.
 *
 * `HttpExceptionFilter` rebuilds error responses from a fixed key allowlist —
 * `statusCode`, `code`, `message`, `details`, `timestamp`, `path` and nothing
 * else — so this class is not an approximation of the wire format, it is the
 * complete set of keys that can appear. In particular a custom top-level field
 * on a thrown `HttpException` payload is silently dropped; endpoint-specific
 * data belongs under {@link details}.
 *
 * THE ONE EXCEPTION (#153): an endpoint whose error body is fixed by an
 * external standard can opt out of this envelope entirely, by branding its
 * exception with `withVerbatimErrorBody`
 * (`./verbatim-error-body.exception.ts`). Its body is then sent
 * exactly as thrown, with none of the keys below. Today the only user is
 * `POST /auth/device/token`, which RFC 8628 §3.5 requires to answer with
 * `{ error, error_description }` — see `DeviceTokenErrorDto`, which the
 * operation declares for its 400 and 401 responses. That opt-out is deliberately
 * hard to reach and rare; assume this envelope unless an operation documents
 * otherwise.
 *
 * Kept as an `@ApiProperty` class rather than a zod DTO because nothing
 * validates it — it is documentation-only, produced by the filter and never
 * parsed on the way in. The OpenAPI schema name is `ErrorDto`; it is
 * published, so the class name does not change.
 *
 * @stability stable
 * @example
 * ```ts
 * @ApiResponse({ status: 409, description: 'Already exists', type: ErrorDto })
 * ```
 */
export class ErrorDto {
  /** HTTP status code, repeated in the body. */
  @ApiProperty({
    description: 'HTTP status code, repeated in the body so a logged payload is self-describing.',
    example: 409,
  })
  statusCode!: number;

  /** Machine-readable code: status-derived by default, or a registered domain code. */
  @ApiProperty({
    type: String,
    description:
      'Stable machine-readable code. By default derived from the status by the exception filter ' +
      '(`BAD_REQUEST`, `CONFLICT`, ...); an endpoint may answer with a domain code the application ' +
      'registered for that status (`registerErrorCode`). An open string, not an enum: the `examples` ' +
      'list the codes registered when the document was generated. Prefer branching on this over ' +
      'matching `message`, which is prose and may change.',
    example: 'CONFLICT',
    // The platform's own codes (mirrors `BUILTIN_ERROR_CODES` plus the `ERROR`
    // fallback); `enrichOpenApiDocument` replaces it with every REGISTERED code
    // when it builds a document, so an app's domain codes are listed too.
    examples: [...BUILTIN_ERROR_CODES.map((def) => def.code), FALLBACK_ERROR_CODE],
  })
  code!: string;

  /** Human-readable description of what went wrong. */
  @ApiProperty({
    description: 'Human-readable description of what went wrong.',
    example: 'Email already in allowlist',
  })
  message!: string;

  /** Endpoint-specific structured data, when the failure carried any. */
  @ApiPropertyOptional({
    description:
      'Endpoint-specific structured data — the only place a custom field survives the exception ' +
      'filter. Omitted when the failure carried none. Shape varies by endpoint and is documented ' +
      'on the operation that returns it.',
    example: { field: 'email' },
  })
  details?: unknown;

  /** When the error was produced, ISO 8601 UTC. */
  @ApiProperty({
    description: 'When the error was produced, ISO 8601 UTC.',
    example: '2026-08-17T04:37:58.000Z',
  })
  timestamp!: string;

  /** Request path that produced the error. */
  @ApiProperty({
    description: 'Request path that produced the error.',
    example: '/api/allowlist',
  })
  path!: string;
}
