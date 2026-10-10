import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { SSE_METADATA } from '@nestjs/common/constants';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

// =============================================================================
// The `{ data }` response envelope (packaged in the host slice by #867)
// =============================================================================
//
// Registered as a global `APP_INTERCEPTOR` by `PlatformHostCoreModule.forRoot()`.
// Every successful JSON body is wrapped as `{ data, meta: { timestamp } }`,
// except a body that already carries a `data` key and an `@Sse()` stream.
// `applyDataEnvelope` (../openapi/data-envelope.ts) documents the same rule in
// the OpenAPI document, so the two cannot drift.
// =============================================================================

/**
 * The envelope every successful JSON response is wrapped in.
 *
 * @typeParam T - the handler's return type.
 * @stability experimental
 */
export interface ApiEnvelope<T> {
  /** The handler's return value. */
  data: T;
  /** Server facts about the response. */
  meta?: {
    /** When the response was built (ISO 8601). */
    timestamp: string;
    [key: string]: unknown;
  };
}

/**
 * Wraps every successful JSON body in the `{ data, meta }` envelope.
 *
 * @typeParam T - the handler's return type.
 * @stability experimental
 */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiEnvelope<T>>
{
  /**
   * Wraps the handler's value, or passes an SSE stream through untouched.
   *
   * @param context - the Nest execution context.
   * @param next - the handler.
   * @returns the enveloped stream.
   */
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiEnvelope<T>> {
    // -------------------------------------------------------------------------
    // SSE HANDLERS ARE NOT ENVELOPED (issue #127, epic #109)
    // -------------------------------------------------------------------------
    //
    // An `@Sse()` handler returns an Observable of `MessageEvent`s, and this
    // interceptor sits between it and the framework's `SseStream` — so without
    // this guard the map below runs once PER EVENT, not once per response.
    //
    // The damage is not hypothetical and it is not cosmetic. A heartbeat is a
    // COMMENT-ONLY message, `{ comment: 'heartbeat' }`, which has no `data`
    // key — so the passthrough test below misses it and it gets wrapped into
    // `{ data: { comment: 'heartbeat' }, meta: … }`. `SseStream` then writes
    // that as a real `data:` frame, and every client's `onmessage` fires for
    // what was supposed to be an invisible keep-alive. The heartbeat stops
    // being a heartbeat and becomes a notification-shaped object arriving
    // every 25 seconds.
    //
    // Data-carrying frames survive by luck rather than design (a `MessageEvent`
    // happens to have a `data` key, so the passthrough returns it untouched),
    // and relying on that coincidence for a security-relevant transport is not
    // acceptable. The envelope is a REQUEST/RESPONSE convention — one body,
    // one `meta.timestamp` — and an SSE stream is neither.
    //
    // Keyed on Nest's OWN `@Sse()` metadata rather than a route allowlist, so
    // any SSE endpoint added later is correct without anybody remembering this
    // file exists.
    const isSse = Reflect.getMetadata(SSE_METADATA, context.getHandler());
    if (isSse) {
      return next.handle() as Observable<ApiEnvelope<T>>;
    }

    return next.handle().pipe(
      map((data) => {
        // If already wrapped, return as-is
        if (data && typeof data === 'object' && 'data' in data) {
          return data;
        }

        return {
          data,
          meta: {
            timestamp: new Date().toISOString(),
          },
        };
      }),
    );
  }
}
