// =============================================================================
// How the host slice's controllers authenticate (PP-14.13)
// =============================================================================
//
// The host controllers (health, maintenance, about) take their access
// decorators from the app's `PlatformHost` (`definePlatformHost`, the same
// object every other packaged slice receives) so a packaged route is guarded
// exactly as the app's own routes are. An app that passes no `host` keeps the
// behaviour the host slice always had: the identity slice's `@Auth()` and
// `@Public()`, which is what the reference app's host binds anyway.
// =============================================================================

import { definePlatformHost, type PlatformHost } from '../../core/index';
import { Auth, Public, type PermissionName } from '../../identity/index';

/**
 * The two decorators the host controllers need.
 *
 * @stability experimental
 */
export interface HostAccess {
  /** Authenticates the caller and requires every listed permission. */
  requirePermissions(permissions: readonly string[]): MethodDecorator & ClassDecorator;
  /** Marks a route as deliberately public (the health probes). */
  allowPublic(): MethodDecorator & ClassDecorator;
}

/**
 * Resolves the access decorators for the host controllers.
 *
 * @param host - the app's `definePlatformHost(...)`, when it passed one.
 * @returns the host's decorators, or the identity slice's when there is no host.
 * @throws Error when `host` is not a valid platform host (see `definePlatformHost`).
 *
 * @stability experimental
 */
export function resolveHostAccess(host?: PlatformHost): HostAccess {
  if (!host) {
    return {
      requirePermissions: (permissions) => Auth({ permissions: [...permissions] as PermissionName[] }),
      allowPublic: () => Public(),
    };
  }
  const defined = definePlatformHost(host);
  return {
    requirePermissions: (permissions) => defined.access.requirePermissions(permissions),
    // `allowPublic` is optional on the port. The probes are public with or
    // without the marker (a route is public unless it declares `@Auth()`), so
    // an app that binds none keeps the identity marker rather than losing it.
    allowPublic: () => defined.access.allowPublic?.() ?? Public(),
  };
}
