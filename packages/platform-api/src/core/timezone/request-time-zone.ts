// =============================================================================
// The request time zone: which zone a request-scoped date operation uses
// =============================================================================
//
// Order: the user's stored `profile.timezone`, then a valid `X-Time-Zone`
// request header (the device zone a client sends for a user on "Automatic"),
// then `UTC`. Background work has no request, so it uses profile then UTC.
//
// `core` holds only the pure pieces and the port. The lookup of the stored
// zone needs the settings slice, which implements the port
// (`SettingsResolver.resolveRequestTimeZone`) and provides it globally; a slice
// below settings (identity, exports) injects it `@Optional()` and falls back to
// header-then-UTC when no settings slice is mounted.
// =============================================================================

import { isValidTimeZone } from '@marinoscar/platform-contract/settings';
import { DEFAULT_SERVER_TIME_ZONE, TIME_ZONE_HEADER } from '@marinoscar/platform-contract/timezone';

/**
 * The minimal request shape the header reader needs (a Fastify request fits).
 *
 * @stability experimental
 */
export interface RequestWithHeaders {
  /** The request headers, lower-cased names as Node and Fastify deliver them. */
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/**
 * Injection token of the request time zone resolver. Provided globally by
 * `SettingsModule`; inject it `@Optional()` from a slice that cannot import settings.
 *
 * @stability experimental
 */
export const REQUEST_TIME_ZONE_RESOLVER = Symbol('REQUEST_TIME_ZONE_RESOLVER');

/**
 * Resolves the zone for a request: profile, then header, then UTC.
 *
 * @stability experimental
 */
export interface RequestTimeZoneResolver {
  /**
   * @param request - the incoming request (its `X-Time-Zone` header is the second choice).
   * @param userId - the requester, when signed in.
   * @returns a valid IANA zone id; never throws.
   */
  resolveRequestTimeZone(request: RequestWithHeaders | undefined, userId?: string | null): Promise<string>;
}

/**
 * The valid `X-Time-Zone` header of a request, or `null` when absent or not an IANA zone.
 *
 * @param request - the request, or `undefined`.
 * @returns the zone id, or `null`.
 *
 * @stability experimental
 */
export function readRequestTimeZoneHeader(request: RequestWithHeaders | undefined): string | null {
  const raw = request?.headers?.[TIME_ZONE_HEADER];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value && isValidTimeZone(value) ? value : null;
}

/**
 * The pure ordering: stored profile zone, then header zone, then `UTC`.
 *
 * @param profileZone - the stored `profile.timezone`, if any.
 * @param headerZone - the validated `X-Time-Zone`, if any.
 * @returns the zone to use.
 *
 * @stability experimental
 */
export function chooseTimeZone(profileZone: string | null | undefined, headerZone: string | null | undefined): string {
  return profileZone ?? headerZone ?? DEFAULT_SERVER_TIME_ZONE;
}

/**
 * Resolves a request's zone through an optional resolver. With no resolver
 * (no settings slice mounted) the header and then `UTC` decide.
 *
 * @param resolver - the injected {@link RequestTimeZoneResolver}, if any.
 * @param request - the incoming request.
 * @param userId - the requester.
 * @returns a valid IANA zone id.
 *
 * @stability experimental
 */
export async function resolveRequestTimeZoneWith(
  resolver: RequestTimeZoneResolver | undefined | null,
  request: RequestWithHeaders | undefined,
  userId?: string | null,
): Promise<string> {
  if (resolver) return resolver.resolveRequestTimeZone(request, userId);
  return chooseTimeZone(null, readRequestTimeZoneHeader(request));
}
