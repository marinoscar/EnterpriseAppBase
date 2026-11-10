import { Injectable, NestMiddleware } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ServerResponse } from 'node:http';
import { trace, context } from '@opentelemetry/api';
import { randomUUID } from 'node:crypto';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
    traceId?: string;
    spanId?: string;
  }
}

/**
 * Assigns each request an id (the incoming `x-request-id`, or a random UUID),
 * attaches it and the active trace and span ids to the raw request, and echoes
 * `x-request-id` and `x-trace-id` on the response. Applied to every route by
 * `PlatformHostCoreModule.forRoot()` (packaged by #867).
 *
 * @stability experimental
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  /**
   * NestJS middleware with Fastify receives raw Node.js objects.
   *
   * @param req - the raw request.
   * @param res - the raw response.
   * @param next - continues the chain.
   */
  use(req: FastifyRequest['raw'] & { requestId?: string; traceId?: string; spanId?: string }, res: ServerResponse, next: () => void) {
    // Get or generate request ID
    const requestId =
      (req.headers['x-request-id'] as string) || randomUUID();

    // Get trace context from OpenTelemetry
    const activeSpan = trace.getSpan(context.active());
    const spanContext = activeSpan?.spanContext();

    // Attach to request (cast to any to add custom properties)
    (req as any).requestId = requestId;
    if (spanContext) {
      (req as any).traceId = spanContext.traceId;
      (req as any).spanId = spanContext.spanId;
    }

    // Set response headers using Node.js API
    res.setHeader('x-request-id', requestId);
    if (spanContext) {
      res.setHeader('x-trace-id', spanContext.traceId);
    }

    next();
  }
}
