// =============================================================================
// PublicLinkInterceptor: the response headers of public link routes (#730)
// =============================================================================
//
//   Cache-Control: no-store       a shared cache must never keep what a link
//                                 showed: the link can be revoked a second later.
//   Referrer-Policy: no-referrer  a page opened through a link never tells the
//                                 next site where it came from.
//
// `LinkGrantGuard` sets the same headers before it decides, so a refusal (404,
// 429) carries them too: guards run before interceptors. The interceptor
// covers a public route an app guards by other means.
// =============================================================================

import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';

/**
 * The headers every public link response carries.
 *
 * @stability experimental
 */
export const PUBLIC_LINK_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
});

/** A Fastify reply (`header`) or a Node response (`setHeader`), structurally. */
interface HeaderSink {
  header?(name: string, value: string): unknown;
  setHeader?(name: string, value: string): unknown;
}

/**
 * Sets {@link PUBLIC_LINK_RESPONSE_HEADERS} on a framework response.
 *
 * @param response - the Fastify reply (or a Node response).
 *
 * @stability experimental
 */
export function setPublicLinkHeaders(response: unknown): void {
  const sink = response as HeaderSink | null;
  if (!sink) return;
  for (const [name, value] of Object.entries(PUBLIC_LINK_RESPONSE_HEADERS)) {
    if (typeof sink.header === 'function') sink.header(name, value);
    else if (typeof sink.setHeader === 'function') sink.setHeader(name, value);
  }
}

/**
 * Sets `Cache-Control: no-store` and `Referrer-Policy: no-referrer` on the
 * responses of a public link route.
 *
 * @example
 * ```ts
 * @UseGuards(LinkGrantGuard)
 * @UseInterceptors(PublicLinkInterceptor)
 * export class PublicMediaController { ... }
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
@Injectable()
export class PublicLinkInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    setPublicLinkHeaders(context.switchToHttp().getResponse());
    return next.handle();
  }
}
