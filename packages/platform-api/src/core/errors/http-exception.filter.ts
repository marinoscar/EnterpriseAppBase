import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Optional,
} from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import {
  defaultErrorCodeForStatus,
  isErrorCodeForStatus,
  type ErrorMapper,
} from './error-codes';
import { hasVerbatimErrorBody } from './verbatim-error-body.exception';

/**
 * Injection token of {@link HttpExceptionFilterOptions}. `PlatformHostCoreModule.forRoot({ errorMappers })`
 * binds it; a filter built without it (`new HttpExceptionFilter()`) maps nothing.
 *
 * @stability experimental
 */
export const HTTP_EXCEPTION_FILTER_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/core/HTTP_EXCEPTION_FILTER_OPTIONS');

/**
 * Options of {@link HttpExceptionFilter}.
 *
 * @stability experimental
 */
export interface HttpExceptionFilterOptions {
  /**
   * Mappers for foreign errors, tried in order. Each sees only a value that is
   * not already an `HttpException`; the first non-`null` result is rendered as
   * if it had been thrown. A mapper that throws is logged and skipped.
   */
  readonly mappers?: readonly ErrorMapper[];
}

interface ErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  timestamp: string;
  path: string;
}

/**
 * The application-wide exception filter: turns every thrown value into the one
 * error envelope (`{ statusCode, code, message, details?, timestamp, path }`,
 * documented by {@link ErrorDto}) on a Fastify reply, and logs one line per
 * failure (`warn` below 500, `error` with the stack from 500 up).
 *
 * `code` is derived from the HTTP status, unless the thrown payload carries a
 * `code` that is registered (`registerErrorCode`) for that same status; any other
 * payload `code` is ignored. `details` is the only place endpoint-specific data
 * survives. An exception branded with {@link withVerbatimErrorBody} skips the
 * envelope and is sent exactly as thrown. A 429 whose `details.retryAfterMs`
 * is a positive number also gets a `Retry-After` header (whole seconds,
 * rounded up). A `ZodValidationException` without explicit details answers
 * `details.issues` (`[{ path, message }]`), never the submitted value. A
 * non-`HttpException` error is first offered to the configured
 * {@link ErrorMapper}s (a mapped error is rendered as the exception the mapper
 * returned, never with the original message); an unmapped one is a 500 whose
 * `details` carries the stack unless `NODE_ENV` is `production`.
 *
 * Register it once, as an `APP_FILTER` provider of the root module
 * (`PlatformHostCoreModule` does). Mappers come from `{ errorMappers }` of
 * `PlatformHostCoreModule.forRoot`, or from the constructor.
 *
 * @stability stable
 * @extensionPoint component
 * @example
 * ```ts
 * import { APP_FILTER } from '@nestjs/core';
 * import { HttpExceptionFilter } from '@marinoscar/platform-api/core';
 *
 * @Module({ providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }] })
 * export class AppModule {}
 * ```
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);
  private readonly mappers: readonly ErrorMapper[];

  /**
   * @param options - mappers for foreign errors. Optional: Nest injects
   *   {@link HTTP_EXCEPTION_FILTER_OPTIONS} when bound, and a bare
   *   `new HttpExceptionFilter()` maps nothing.
   */
  constructor(@Optional() @Inject(HTTP_EXCEPTION_FILTER_OPTIONS) options?: HttpExceptionFilterOptions) {
    this.mappers = Object.freeze([...(options?.mappers ?? [])]);
  }

  /**
   * Nest's `ExceptionFilter` hook: write the error response for `thrown`
   * on the HTTP reply of `host`. Called by Nest, not by application code.
   *
   * @param thrown - Whatever was thrown.
   * @param host - The Nest arguments host of the failed request (HTTP only).
   */
  catch(thrown: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: unknown;

    // A foreign error (not an HttpException) is offered to the mappers first. A
    // mapped one is rendered as the HttpException the mapper built; the original
    // is kept for the server-side log line only.
    const mapped = thrown instanceof HttpException ? null : this.map(thrown);
    const exception: unknown = mapped ?? thrown;
    const logged: unknown = thrown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // ---------------------------------------------------------------------
      // Verbatim bodies (#153) — checked FIRST, and returns immediately.
      // ---------------------------------------------------------------------
      // A branded exception carries a body dictated by an external spec, not by
      // us: today that is `POST /auth/device/token`, whose RFC 8628 §3.5 body is
      // `{ error, error_description }`. Sending it through the envelope below
      // destroys it — the envelope reads only `message`, `code` and `details`,
      // so all four RFC outcomes used to arrive as the same generic 400 and a
      // polling client could not tell them apart. See
      // `./verbatim-error-body.exception.ts` for why the opt-out
      // is an explicit brand rather than the filter sniffing for an `error` key.
      //
      // Nothing is merged in — not `statusCode`, not `timestamp`, not `path`.
      // Extra keys would not upset a tolerant parser, but they would put fields
      // the RFC never defines into a protocol response, and a body that is
      // "mostly the spec" is exactly the kind of thing a strict client rejects
      // and a reader stops trusting. The status line still carries the code.
      //
      // The object guard matters: a string payload has nothing to send
      // verbatim, so such an exception falls through to the envelope rather than
      // putting a bare JSON string on the wire.
      if (
        hasVerbatimErrorBody(exception) &&
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        this.logOutcome(
          request,
          status,
          this.summarize(exceptionResponse as Record<string, unknown>),
          logged,
        );

        response.code(status).send(exceptionResponse);
        return;
      }

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const resp = exceptionResponse as Record<string, unknown>;
        message = (resp.message as string) || message;
        details = resp.details;
      }

      // A body/query that failed the global `ZodValidationPipe` names the
      // failing fields under `details.issues` (`{ path, message }` each). Only
      // the path and Zod's (or the schema's own) message are published — never
      // the submitted value, which may be personal data or free text.
      if (exception instanceof ZodValidationException && details === undefined) {
        details = zodIssueDetails(exception.getZodError());
      }

      // `code` defaults to the one derived from the status. A `code` on the thrown
      // payload is honoured ONLY when it is registered (`registerErrorCode`) for
      // THIS status: an unregistered, misspelt or mismatched code can never reach
      // the wire, so the published list (`ErrorDto`'s examples) is exactly the
      // registry. Nothing registered by default differs from the status-derived
      // code, so every built-in response is unchanged, including
      // `DatabaseSeedException`, whose `DATABASE_SEED_REQUIRED` stays ignored
      // (its identifying data is in `details`).
      //
      // Endpoint-specific machine-readable data still belongs under `details`; an
      // externally-specified body belongs behind the verbatim brand above.
      const payloadCode =
        typeof exceptionResponse === 'object' && exceptionResponse !== null
          ? (exceptionResponse as Record<string, unknown>).code
          : undefined;
      code = isErrorCodeForStatus(payloadCode, status) ? payloadCode : defaultErrorCodeForStatus(status);
    } else if (exception instanceof Error) {
      message = exception.message;
      // Don't expose stack traces in production
      if (process.env.NODE_ENV !== 'production') {
        details = exception.stack;
      }
    }

    const errorResponse: ErrorResponse = {
      statusCode: status,
      code,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (details) {
      errorResponse.details = details;
    }

    this.logOutcome(request, status, message, logged);

    // A 429 that says when to come back (`details.retryAfterMs` — every
    // `AiError('AI_RATE_LIMITED')` that knows, including the AI rate limits of
    // #450) also says so in the standard header, in whole seconds rounded UP
    // so a client that honours it never retries early.
    const retryAfterSeconds = status === 429 ? retryAfterSecondsOf(details) : undefined;

    if (retryAfterSeconds !== undefined) {
      response.header('Retry-After', String(retryAfterSeconds));
    }

    // Fastify response - use code() and send()
    response.code(status).send(errorResponse);
  }

  /**
   * One log line per handled failure, identical for enveloped and verbatim
   * responses. Extracted so the verbatim early-return above cannot silently
   * skip logging — a device-flow `slow_down` storm has to be visible in the
   * logs like any other 4xx.
   */
  private logOutcome(
    request: { method: string; url: string },
    status: number,
    summary: string,
    exception: unknown,
  ): void {
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} - ${status}`,
        exception instanceof Error ? exception.stack : exception,
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} - ${status}: ${summary}`,
      );
    }
  }

  /**
   * A short log-only description of a verbatim body.
   *
   * Reading `error` here is for the LOG LINE ONLY and shapes nothing — an RFC
   * body's `error` is the single most useful thing to see in operations
   * (`slow_down` and `access_denied` mean very different things at 3am), and
   * without it every device-flow failure logs as an indistinguishable 400. The
   * body itself is never stringified into the log: a verbatim payload is
   * whatever the spec says it is, and this filter should not assume the rest of
   * it is safe to print.
   */
  private summarize(body: Record<string, unknown>): string {
    const label = body.error ?? body.message;
    return typeof label === 'string' ? label : 'verbatim error body';
  }

  /**
   * The first mapper's result for a foreign error. A mapper that throws, or
   * returns anything but an `HttpException`, is skipped (a broken mapper must
   * not turn one failure into two).
   */
  private map(error: unknown): HttpException | null {
    for (const mapper of this.mappers) {
      try {
        const result = mapper(error);
        if (result instanceof HttpException) return result;
        if (result !== null && result !== undefined) {
          this.logger.warn('An error mapper returned something other than an HttpException or null; ignored.');
        }
      } catch (failure) {
        this.logger.error(
          'An error mapper threw; skipped.',
          failure instanceof Error ? failure.stack : String(failure),
        );
      }
    }
    return null;
  }
}

/** `details.retryAfterMs` as a `Retry-After` delta-seconds value (at least 1), or `undefined`. */
function retryAfterSecondsOf(details: unknown): number | undefined {
  if (details === null || typeof details !== 'object') return undefined;

  const ms = (details as { retryAfterMs?: unknown }).retryAfterMs;

  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? Math.max(1, Math.ceil(ms / 1000)) : undefined;
}

/** `{ issues: [{ path: 'readings.0.unit', message }] }`, or undefined. */
function zodIssueDetails(error: unknown): { issues: Array<{ path: string; message: string }> } | undefined {
  const issues = (error as { issues?: unknown } | null)?.issues;

  if (!Array.isArray(issues) || issues.length === 0) {
    return undefined;
  }

  return {
    issues: issues.map((issue: { path?: unknown; message?: unknown }) => ({
      path: Array.isArray(issue.path) ? issue.path.map(String).join('.') : '',
      message: typeof issue.message === 'string' ? issue.message : 'Invalid value',
    })),
  };
}
