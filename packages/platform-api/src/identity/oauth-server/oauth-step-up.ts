// =============================================================================
// Permission denial to step-up (PP-15.6, docs/specs/oauth-server.md §2.16 "Guard denial")
// =============================================================================
//
// `PermissionsGuard` refuses a narrowed `oauth` principal because its token's
// scopes do not carry a permission the route declares. When re-consent could fix
// that, the right answer is `403 insufficient_scope` (the client then sends the
// user through `/authorize` with the wider set); when it cannot, a plain 403 is
// the honest answer. "Can re-consent fix it" is: the user HOLDS the permission
// AND some registered scope of the token's resource grants it.
// =============================================================================

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { permissionsWithoutOAuthNarrowing } from '../auth/principal.factory';
import { InsufficientScopeException } from './oauth-insufficient-scope';
import { oauthGrantOf } from './oauth-grant.decorator';
import { oauthResourceRegistry } from './oauth-resource.registry';
import { oauthScopeRegistry } from './oauth-scope.registry';

/**
 * The `insufficient_scope` exception for a permission denial, or `null` when
 * the request is not an `oauth` credential or re-consent cannot fix it.
 *
 * @param request - the request (`principal`, `user`).
 * @param missing - permissions all of which are required and absent. Pass the
 *   alternatives of `anyPermissions` with `anyOf: true`: ONE fixable alternative suffices.
 * @param anyOf - whether `missing` are alternatives rather than all required.
 * @returns the exception to throw, or `null` for a plain 403.
 *
 * @internal
 */
export function stepUpForDeniedPermissions(
  request: { principal?: unknown; user?: unknown },
  missing: readonly string[],
  anyOf = false,
): InsufficientScopeException | null {
  const grant = oauthGrantOf(request as Parameters<typeof oauthGrantOf>[0]);
  if (!grant || !request.user) return null;
  const resource = oauthResourceRegistry.get(grant.resourceId);
  if (!resource) return null;

  const held = new Set(permissionsWithoutOAuthNarrowing(request.user as AuthenticatedUser));
  const scopeFor = (permission: string): string | undefined => {
    if (!held.has(permission)) return undefined;
    return resource.scopes.find((id) => !grant.scopes.includes(id) && oauthScopeRegistry.get(id)?.permissions.includes(permission));
  };

  const required = new Set<string>();
  if (anyOf) {
    for (const permission of missing) {
      const scope = scopeFor(permission);
      if (scope) {
        required.add(scope);
        break;
      }
    }
  } else {
    for (const permission of missing) {
      const scope = scopeFor(permission);
      if (!scope) return null;
      required.add(scope);
    }
  }
  return required.size === 0 ? null : new InsufficientScopeException({ resourceId: resource.id, requiredScopes: [...required] });
}
