// =============================================================================
// The exception filter of the OAuth protocol endpoints (PP-15.4)
// =============================================================================
//
// `/api/oauth/token`, `/revoke` and the metadata documents are parsed by
// third-party clients, so their errors are RFC 6749 JSON (`{ error,
// error_description }`), never the platform's error body. Applied with
// `@UseFilters(OAuthProtocolExceptionFilter)` on the protocol controller only;
// every other route keeps the global `HttpExceptionFilter`.
//
//   - an `OAuthProtocolError` is written as its body, status and headers;
//   - any other `HttpException` (a plain `404` while the server is disabled, a
//     framework `413`) is handed to the platform filter, so the "disabled means
//     404" rule keeps the platform shape;
//   - anything else is a `server_error`: logged WITH its stack, answered
//     without it.
// =============================================================================

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { HttpExceptionFilter } from '../../core/index';
import { OAuthProtocolError } from './oauth-protocol.error';

/**
 * Answers protocol errors in RFC 6749 form.
 *
 * @stability experimental
 */
@Catch()
export class OAuthProtocolExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(OAuthProtocolExceptionFilter.name);
  private readonly fallback = new HttpExceptionFilter();

  /**
   * @param thrown - whatever the handler threw.
   * @param host - the arguments host.
   */
  catch(thrown: unknown, host: ArgumentsHost): void {
    if (thrown instanceof HttpException && !(thrown instanceof OAuthProtocolError)) {
      this.fallback.catch(thrown, host);
      return;
    }
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();

    if (thrown instanceof OAuthProtocolError) {
      // The protocol endpoints take no cookie, so the wildcard is safe (spec §3).
      void reply.header('access-control-allow-origin', '*');
      for (const [name, value] of Object.entries(thrown.headers)) void reply.header(name, value);
      this.logger.warn(`${request.method} ${request.url.split('?')[0]} - ${thrown.getStatus()}: ${thrown.code}`);
      void reply.header('cache-control', 'no-store').header('pragma', 'no-cache').code(thrown.getStatus()).send(thrown.getResponse());
      return;
    }

    this.logger.error(`${request.method} ${request.url.split('?')[0]} - 500`, thrown instanceof Error ? thrown.stack : String(thrown));
    void reply.header('access-control-allow-origin', '*').header('cache-control', 'no-store').code(500).send({ error: 'server_error', error_description: 'The authorization server hit an internal error.' });
  }
}
