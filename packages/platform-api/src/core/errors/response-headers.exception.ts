import type { HttpException } from '@nestjs/common';

const RESPONSE_HEADERS = Symbol.for('@marinoscar/platform/core/RESPONSE_HEADERS');

/**
 * Response headers an exception asks the error filter to send: a fixed map, or a
 * function of the failed request (for a header whose value depends on who asked).
 *
 * @stability experimental
 */
export type ExceptionResponseHeaders =
  | Readonly<Record<string, string>>
  | ((request: unknown) => Readonly<Record<string, string>> | undefined);

/**
 * Attaches response headers to an exception. `HttpExceptionFilter` writes them
 * before the body, whatever the body shape (enveloped or verbatim). The brand is
 * non-enumerable, so it never reaches a log serializer or a snapshot. Used by
 * the OAuth server for `WWW-Authenticate` (RFC 6750 §3).
 *
 * Header values are written as given: a value built from caller input must
 * already be free of CR and LF.
 *
 * @param exception - the exception to brand; returned as is.
 * @param headers - a header map, or a function of the request.
 * @returns the same exception instance.
 *
 * @stability experimental
 * @example
 * ```ts
 * throw withResponseHeaders(new UnauthorizedException(), { 'WWW-Authenticate': 'Bearer' });
 * ```
 */
export function withResponseHeaders<T extends HttpException>(exception: T, headers: ExceptionResponseHeaders): T {
  Object.defineProperty(exception, RESPONSE_HEADERS, { value: headers, enumerable: false, writable: false, configurable: true });
  return exception;
}

/**
 * The headers an exception asked for, resolved against `request`. A function
 * that throws yields no headers (a header must never turn one failure into two).
 *
 * @param exception - anything thrown.
 * @param request - the failed request.
 * @returns the header map (empty when none).
 *
 * @stability experimental
 */
export function responseHeadersOf(exception: unknown, request: unknown): Readonly<Record<string, string>> {
  if (exception === null || typeof exception !== 'object') return {};
  const brand = (exception as Record<symbol, unknown>)[RESPONSE_HEADERS] as ExceptionResponseHeaders | undefined;
  if (brand === undefined) return {};
  try {
    return (typeof brand === 'function' ? brand(request) : brand) ?? {};
  } catch {
    return {};
  }
}
