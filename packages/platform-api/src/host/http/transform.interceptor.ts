import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { SSE_METADATA } from '@nestjs/common/constants';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { isReportableKey } from '../internal/bounded';
import { responseMetaContributorRegistry } from './response-meta.registry';

// =============================================================================
// The `{ data }` response envelope (packaged in the host slice by #867)
// =============================================================================
//
// Registered as a global `APP_INTERCEPTOR` by `PlatformHostCoreModule.forRoot()`.
// Every successful JSON body is wrapped as `{ data, meta: { timestamp } }`,
// except a body that already carries a `data` key and an `@Sse()` stream.
// `applyDataEnvelope` (../openapi/data-envelope.ts) documents the same rule in
// the OpenAPI document, so the two cannot drift.
//
// `meta` may carry more than the timestamp: an app registers a contributor
// (`registerResponseMetaContributor`) and its entries are merged in, bounded
// and secret-filtered (`buildResponseMeta`).
// =============================================================================

/** The most keys one contributor may add to `meta`. */
export const RESPONSE_META_MAX_KEYS_PER_CONTRIBUTOR = 8;

/** The most keys contributors may add to `meta` in total. */
export const RESPONSE_META_MAX_KEYS = 16;

/** The longest a contributed value may be once serialised as JSON. */
export const RESPONSE_META_MAX_VALUE_LENGTH = 512;

/**
 * The `meta` of one enveloped response.
 *
 * @stability experimental
 */
export interface ResponseMeta {
  /** When the response was built (ISO 8601). */
  timestamp: string;
  /** What the registered contributors added. */
  [key: string]: unknown;
}

/**
 * Builds `meta` for one response: the timestamp, then the entries the
 * registered contributors returned. A contributor that throws is skipped. The
 * platform's `timestamp` cannot be overridden; a key beyond the limits, a
 * credential-looking key, and a value that is not JSON or serialises to more
 * than {@link RESPONSE_META_MAX_VALUE_LENGTH} characters are dropped.
 *
 * @param request - the incoming request, passed to each contributor.
 * @returns the `meta` object.
 *
 * @stability experimental
 */
export function buildResponseMeta(request: unknown): ResponseMeta {
  const meta: ResponseMeta = { timestamp: new Date().toISOString() };
  const contributors = responseMetaContributorRegistry.list();
  if (contributors.length === 0) return meta;

  const view = (request ?? {}) as Readonly<Record<string, unknown>>;
  let total = 0;
  for (const contributor of contributors) {
    let contributed: unknown;
    try {
      contributed = contributor.contribute(view);
    } catch {
      continue;
    }
    if (contributed === null || typeof contributed !== 'object' || Array.isArray(contributed)) continue;
    let own = 0;
    for (const [key, value] of Object.entries(contributed as Record<string, unknown>)) {
      if (own >= RESPONSE_META_MAX_KEYS_PER_CONTRIBUTOR || total >= RESPONSE_META_MAX_KEYS) break;
      if (key === 'timestamp' || key in meta || !isReportableKey(key)) continue;
      let serialised: string | undefined;
      try {
        serialised = JSON.stringify(value);
      } catch {
        serialised = undefined;
      }
      if (serialised === undefined || serialised.length > RESPONSE_META_MAX_VALUE_LENGTH) continue;
      meta[key] = JSON.parse(serialised) as unknown;
      own += 1;
      total += 1;
    }
  }
  return meta;
}

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

    const request = context.switchToHttp().getRequest();

    return next.handle().pipe(
      map((data) => {
        // If already wrapped, return as-is
        if (data && typeof data === 'object' && 'data' in data) {
          return data;
        }

        return {
          data,
          meta: buildResponseMeta(request),
        };
      }),
    );
  }
}
