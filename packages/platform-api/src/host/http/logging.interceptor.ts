import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { SSE_METADATA } from '@nestjs/common/constants';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { FastifyRequest } from 'fastify';

/**
 * Logs one `METHOD url - Nms` line per request (logger context `HTTP`); an SSE
 * stream is logged once, when it opens. Registered globally by
 * `PlatformHostCoreModule.forRoot()` (packaged by #867).
 *
 * @stability experimental
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  /**
   * Times the handler and logs the line.
   *
   * @param context - the Nest execution context.
   * @param next - the handler.
   * @returns the handler's stream, unchanged.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const { method, url } = request;
    const now = Date.now();

    // SSE streams are logged ONCE, at open (issue #127, epic #109).
    //
    // The `tap` below fires on every emission, and an SSE handler emits for the
    // lifetime of the connection — so a stream would log a line per
    // notification AND per 25-second heartbeat, each reporting an
    // ever-increasing "response time" measured from when the connection was
    // established. That is not a slow request; it is a long-lived one, and
    // reporting it as latency would make every dashboard built on these lines
    // wrong about the p99 of an API that is behaving perfectly.
    if (Reflect.getMetadata(SSE_METADATA, context.getHandler())) {
      this.logger.log(`${method} ${url} - SSE stream opened`);
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        const responseTime = Date.now() - now;
        this.logger.log(`${method} ${url} - ${responseTime}ms`);
      }),
    );
  }
}
