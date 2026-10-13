// =============================================================================
// The error code registry and the error mapper contract (PP-14.14)
// =============================================================================
//
// `code` in the error envelope (`ErrorDto`) used to be one of ten values derived
// from the HTTP status, with a thrown payload's own `code` ignored. It is now an
// open vocabulary:
//
//   * the status-derived codes (`BAD_REQUEST`, `CONFLICT`, ...) are the
//     platform's registrations, made through the same `registerErrorCode` an app
//     uses, and stay the DEFAULT for every status;
//   * an app registers a DOMAIN code (`NOTE_TITLE_TAKEN`, 409) and throws an
//     `HttpException` whose payload carries it; the filter passes a payload
//     `code` through ONLY when it is registered AND registered for the
//     exception's own status. Anything else falls back to the status-derived
//     code, so an unregistered, misspelt or mismatched code can never reach the
//     wire and the published list is exactly the registry.
//
// `ErrorMapper`s turn FOREIGN errors (Prisma, SDKs) into an `HttpException`
// with a code the app chose; see `HttpExceptionFilterOptions`.
//
// FRAMEWORK-FREE except for the `HttpException` type.
// =============================================================================

import type { HttpException } from '@nestjs/common';

import { defineRegistry, type Registry } from '../registry/registry';

/**
 * The pattern an error code matches: UPPER_SNAKE, 3 to 64 characters, starting
 * with a letter (`NOTE_TITLE_TAKEN`).
 *
 * @stability experimental
 */
export const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;

/**
 * The code of a failure whose status has no registered default (for example a
 * 503). Never registered: it has no single status.
 *
 * @stability experimental
 */
export const FALLBACK_ERROR_CODE = 'ERROR';

/**
 * One registered error code.
 *
 * @stability experimental
 * @example
 * ```ts
 * const def: ErrorCodeDef = { code: 'NOTE_TITLE_TAKEN', status: 409, description: 'A note with this title already exists.' };
 * ```
 */
export interface ErrorCodeDef {
  /** The code. See {@link ERROR_CODE_PATTERN}. */
  readonly code: string;
  /** The HTTP status the code is for (an integer from 400 to 599). The filter passes the code through only for an exception of this status. */
  readonly status: number;
  /** One sentence for the API docs: when a client sees this code. */
  readonly description: string;
}

/**
 * The platform's status-derived codes, in the order the OpenAPI examples list
 * them. The FIRST entry for a status is the default `code` of that status.
 *
 * @stability experimental
 */
export const BUILTIN_ERROR_CODES: readonly ErrorCodeDef[] = Object.freeze([
  { code: 'BAD_REQUEST', status: 400, description: 'The request is malformed or failed validation.' },
  { code: 'UNAUTHORIZED', status: 401, description: 'No valid credential was presented.' },
  { code: 'FORBIDDEN', status: 403, description: 'The credential is valid but may not do this.' },
  { code: 'NOT_FOUND', status: 404, description: 'The resource does not exist, or is not visible to the caller.' },
  { code: 'CONFLICT', status: 409, description: 'The request conflicts with the current state, or a version precondition failed.' },
  { code: 'PRECONDITION_FAILED', status: 412, description: 'An HTTP precondition header did not match.' },
  { code: 'PAYLOAD_TOO_LARGE', status: 413, description: 'The request body is larger than the endpoint accepts.' },
  { code: 'UNPROCESSABLE_ENTITY', status: 422, description: 'The request is well formed but cannot be processed.' },
  { code: 'TOO_MANY_REQUESTS', status: 429, description: 'The caller is rate limited; see `Retry-After`.' },
  { code: 'INTERNAL_ERROR', status: 500, description: 'An unexpected failure on the server.' },
]);

/**
 * Every registered error code: the platform's ten first, then the app's.
 * Frozen once the application has bootstrapped.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const errorCodeRegistry: Registry<ErrorCodeDef> = defineRegistry<ErrorCodeDef>({
  name: 'core.error-codes',
  idOf: (def) => def.code,
  idPattern: ERROR_CODE_PATTERN,
  validate: (def) => {
    if (!Number.isInteger(def.status) || def.status < 400 || def.status > 599) {
      throw new Error(`error code "${def.code}": status must be an integer from 400 to 599, got ${JSON.stringify(def.status)}`);
    }
    if (typeof def.description !== 'string' || def.description.trim() === '') {
      throw new Error(`error code "${def.code}": description must be a non-empty string`);
    }
    if (def.code === FALLBACK_ERROR_CODE) {
      throw new Error(`error code "${def.code}" is the fallback for unmapped statuses and cannot be registered`);
    }
  },
});

/**
 * Registers a domain error code. Call it at module load, before the
 * application is created; a duplicate code (including a built-in one) throws.
 *
 * A code is for ONE status. To let the filter pass it through, throw an
 * `HttpException` of that status whose payload carries `code`.
 *
 * @param def - the code, its status and a description.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```ts
 * registerErrorCode({ code: 'NOTE_TITLE_TAKEN', status: 409, description: 'A note with this title already exists.' });
 * // in a service:
 * throw new ConflictException({ code: 'NOTE_TITLE_TAKEN', message: 'Title already used', details: { field: 'title' } });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerErrorCode(def: ErrorCodeDef): void {
  errorCodeRegistry.register(def);
}

/**
 * The default code of an HTTP status: the first registered code for it, else
 * {@link FALLBACK_ERROR_CODE}.
 *
 * @param status - an HTTP status.
 * @returns the code the envelope carries when the exception names none.
 *
 * @stability experimental
 */
export function defaultErrorCodeForStatus(status: number): string {
  for (const def of BUILTIN_ERROR_CODES) {
    if (def.status === status) return def.code;
  }
  return FALLBACK_ERROR_CODE;
}

/**
 * Whether `code` may appear in the envelope of an exception with `status`: it
 * is registered, for that status.
 *
 * @param code - a payload `code`, as thrown.
 * @param status - the exception's HTTP status.
 * @returns `true` only for a registered code of that status.
 *
 * @stability experimental
 */
export function isErrorCodeForStatus(code: unknown, status: number): code is string {
  return typeof code === 'string' && errorCodeRegistry.get(code)?.status === status;
}

/**
 * Turns an error the platform does not know (a Prisma error, an SDK error) into
 * an `HttpException`, or returns `null` to pass. Mappers run, in order, only for
 * values that are NOT already an `HttpException`; the first to return one wins.
 *
 * ⚠ Build the result's `message` and `details` yourself and keep them free of
 * the original error's text: a Prisma or SDK message can carry SQL, table names,
 * hostnames or credentials. The filter never copies a mapped error's message,
 * and logs the original server-side only.
 *
 * @param error - whatever was thrown.
 * @returns the exception to respond with, or `null` when this mapper does not handle it.
 *
 * @stability experimental
 * @example
 * ```ts
 * const uniqueViolation: ErrorMapper = (error) =>
 *   isPrismaError(error, 'P2002')
 *     ? new ConflictException({ code: 'ALREADY_EXISTS', message: 'Already exists', details: { fields: error.meta?.target } })
 *     : null;
 * ```
 */
export type ErrorMapper = (error: unknown) => HttpException | null;

for (const def of BUILTIN_ERROR_CODES) registerErrorCode(def);
