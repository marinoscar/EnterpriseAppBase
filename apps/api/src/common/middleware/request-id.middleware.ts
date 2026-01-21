import { Injectable, NestMiddleware } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { trace, context } from '@opentelemetry/api';
import { randomUUID } from 'crypto';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
    traceId?: string;
    spanId?: string;
  }
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: FastifyRequest, res: FastifyReply, next: () => void) {
    // Get or generate request ID
    const requestId =
      (req.headers['x-request-id'] as string) || randomUUID();

    // Get trace context from OpenTelemetry
    const activeSpan = trace.getSpan(context.active());
    const spanContext = activeSpan?.spanContext();

    // Attach to request
    req.requestId = requestId;
    if (spanContext) {
      req.traceId = spanContext.traceId;
      req.spanId = spanContext.spanId;
    }

    // Set response headers
    res.header('x-request-id', requestId);
    if (spanContext) {
      res.header('x-trace-id', spanContext.traceId);
    }

    next();
  }
}
