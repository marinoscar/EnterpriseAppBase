// =============================================================================
// Step-up versus forbidden (#1194, docs/specs/oauth-server.md §4.5)
// =============================================================================
//
// An app's protected resource (an MCP endpoint) must tell "the user holds the
// permission but the token's scopes do not grant it" (re-consent fixes it:
// `403 insufficient_scope`) from "the user lacks it" (re-consent cannot help: a
// plain `403`). Both answers need the permissions the user holds BEFORE the
// `oat_` token's scope narrowing; this file is the one stable way to read them.
// =============================================================================

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { permissionsWithoutOAuthNarrowing } from '../auth/principal.factory';
import { oauthGrantOf } from './oauth-grant.decorator';
import { oauthResourceRegistry } from './oauth-resource.registry';
import { oauthScopeRegistry } from './oauth-scope.registry';

/** The shape of a request this file reads. */
interface AccessRequest {
  principal?: unknown;
  user?: unknown;
}

/**
 * The permissions the request's user holds BEFORE any OAuth scope narrowing:
 * what re-consent could add to an `oat_` token. For a session, personal access
 * token or any other credential it equals the principal's permissions; for an
 * `oat_` token it is the user's own set, wider than the token's. Read-only and
 * pure. Empty when the request carries no loaded user.
 *
 * @param request - the Fastify request (or any object with the `user` the auth guard attached).
 * @returns the user's own effective permissions.
 *
 * @example
 * ```ts
 * if (!userPermissionsOf(request).has('notes:write')) throw new ForbiddenException();
 * // the user holds it: a token without the scope is a step-up, not a refusal
 * throw new InsufficientScopeException({ resourceId: 'notes', requiredScopes: ['notes:write'] });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function userPermissionsOf(request: unknown): ReadonlySet<string> {
  const user = (request as AccessRequest | null | undefined)?.user as AuthenticatedUser | undefined | null;
  if (!user || typeof user !== 'object' || !Array.isArray((user as { userRoles?: unknown }).userRoles)) return new Set();
  return new Set(permissionsWithoutOAuthNarrowing(user));
}

/**
 * The scope of the token's resource that grants `permission` and the token
 * lacks, when the user holds the permission; `undefined` when re-consent cannot fix it.
 *
 * @internal
 */
export function reconsentScopeFor(request: AccessRequest, permission: string, held: ReadonlySet<string> = userPermissionsOf(request)): string | undefined {
  const grant = oauthGrantOf(request as Parameters<typeof oauthGrantOf>[0]);
  if (!grant || !held.has(permission)) return undefined;
  const resource = oauthResourceRegistry.get(grant.resourceId);
  if (!resource) return undefined;
  return resource.scopes.find((id) => !grant.scopes.includes(id) && oauthScopeRegistry.get(id)?.permissions.includes(permission));
}

/**
 * Whether the request may use `permission`, and when it may not, whether
 * re-consent would fix it: `granted` (the principal holds it), `step_up` (an
 * `oat_` token whose user holds it and a registered scope of its resource
 * grants it: answer `403 insufficient_scope`) or `forbidden` (the user lacks
 * it, or no scope could grant it: a plain `403`).
 *
 * @param request - the Fastify request.
 * @param permission - the permission the operation needs.
 * @returns the decision.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function oauthAccessDecision(request: unknown, permission: string): 'granted' | 'step_up' | 'forbidden' {
  const req = (request ?? {}) as AccessRequest;
  const principal = req.principal as { permissions?: readonly string[] } | undefined;
  if (principal?.permissions?.includes(permission)) return 'granted';
  const held = userPermissionsOf(req);
  if (!principal?.permissions) {
    // No principal on the request: fall back to the unnarrowed set only for a non-OAuth caller.
    return held.has(permission) && !oauthGrantOf(req as Parameters<typeof oauthGrantOf>[0]) ? 'granted' : 'forbidden';
  }
  return reconsentScopeFor(req, permission, held) ? 'step_up' : 'forbidden';
}
