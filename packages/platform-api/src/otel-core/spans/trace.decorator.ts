// =============================================================================
// @Trace(): one span around a method (moved from the app's
// common/decorators/trace.decorator.ts by issue #700)
// =============================================================================
//
// The tracer is resolved on the FIRST CALL, not when the decorator is applied
// or the module is loaded: the class may be defined before the app has
// decided its service name, and a tracer taken from the API's proxy provider
// before the SDK starts would still work but would read a stale name.
//
// The tracer name is the service name by default (`OTEL_SERVICE_NAME`, else
// the `tracer` option, else `DEFAULT_SERVICE_NAME`). By OpenTelemetry
// convention `getTracer()` takes the name of the instrumentation library;
// the reference app has always passed its service name instead, and the
// scope name is a dimension dashboards filter on (issue #343), so the
// conflation is kept. Pass `tracer` to name the scope explicitly.
// =============================================================================

import { SpanKind, SpanStatusCode, trace, type Tracer } from '@opentelemetry/api';

import { resolveServiceName } from '../sdk/service-name';

/**
 * Options of {@link Trace}.
 *
 * @stability experimental
 */
export interface TraceOptions {
  /**
   * The tracer (instrumentation scope) name used when `OTEL_SERVICE_NAME` is
   * unset. Default: `DEFAULT_SERVICE_NAME`.
   */
  tracer?: string;
}

/**
 * Method decorator: runs the method inside an active INTERNAL span named
 * `spanName` (default `ClassName.method`). The span is `OK` when the method
 * resolves, `ERROR` with the exception recorded when it throws or rejects;
 * the error is rethrown. The decorated method always returns a promise.
 * With no SDK installed the span is a no-op.
 *
 * @param spanName - The span name. Default: `<ClassName>.<method>`.
 * @param options - See {@link TraceOptions}.
 * @returns The method decorator.
 *
 * @example
 * ```ts
 * class ReportService {
 *   @Trace('report.build')
 *   async build(id: string): Promise<Report> { ... }
 * }
 * ```
 *
 * @stability experimental
 */
export function Trace(spanName?: string, options: TraceOptions = {}): MethodDecorator {
  let tracer: Tracer | null = null;
  const tracerFor = (): Tracer => (tracer ??= trace.getTracer(resolveServiceName(options.tracer)));

  return function (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value as (...args: unknown[]) => unknown;
    const name = spanName || `${target.constructor.name}.${String(propertyKey)}`;

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      return tracerFor().startActiveSpan(name, { kind: SpanKind.INTERNAL }, async (span) => {
        try {
          const result = await originalMethod.apply(this, args);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : 'Unknown error',
          });
          span.recordException(error as Error);
          throw error;
        } finally {
          span.end();
        }
      });
    };

    return descriptor;
  };
}
