// =============================================================================
// The OAuth scope registry (PP-15.3, docs/specs/oauth-server.md §2.17)
// =============================================================================
//
// A scope is a NAME for a bundle of the platform's own permissions. A token
// carries scopes; the guard narrows the token's user to the union of the
// permissions of those scopes (intersected with what the user holds), so a
// scope can never grant more than the user already has.
//
// Open vocabulary (docs/EXTENDING.md, "open an id vocabulary"): the platform
// registers only `offline_access`; an app registers its own with
// `registerOAuthScope` at import time. Frozen at bootstrap (`RegistryFreezeService`).
// A scope naming a permission nobody registered is a BOOT ERROR naming the
// scope (`validateOAuthRegistries`, run by the OAuth server module on init).
// =============================================================================

import { defineRegistry, type Registry } from '../../core/index';

/**
 * The pattern a scope id matches: `name` or `name:action`, lower-case, at most
 * {@link OAUTH_SCOPE_ID_MAX_LENGTH} characters.
 *
 * @stability experimental
 */
export const OAUTH_SCOPE_ID_PATTERN = /^[a-z][a-z0-9_]*(:[a-z][a-z0-9_]*)?$/;

/**
 * The longest scope id.
 *
 * @stability experimental
 */
export const OAUTH_SCOPE_ID_MAX_LENGTH = 64;

/**
 * The built-in scope that lets a client hold a refresh token. It names no
 * permission and is accepted by every protected resource.
 *
 * @stability experimental
 */
export const OFFLINE_ACCESS_SCOPE = 'offline_access';

/**
 * How the consent page groups and warns about a scope.
 *
 * @stability experimental
 */
export type OAuthScopeRisk = 'low' | 'elevated' | 'high';

/**
 * One registered OAuth scope.
 *
 * @stability experimental
 * @example
 * ```ts
 * const scope: OAuthScopeDefinition = {
 *   id: 'notes:read',
 *   title: 'Read your notes',
 *   description: 'See the notes you can see in the app.',
 *   permissions: ['notes:read'],
 *   risk: 'low',
 *   default: true,
 * };
 * ```
 */
export interface OAuthScopeDefinition {
  /** The scope id. See {@link OAUTH_SCOPE_ID_PATTERN}. */
  readonly id: string;
  /** Shown on the consent page. */
  readonly title: string;
  /** One sentence for the consent page. */
  readonly description: string;
  /** Permission ids the scope grants; each must be registered (checked at bootstrap). */
  readonly permissions: readonly string[];
  /** The consent page groups and warns by it. */
  readonly risk: OAuthScopeRisk;
  /** Requested when the client asks for no scope. */
  readonly default?: boolean;
}

const RISKS: readonly string[] = ['low', 'elevated', 'high'];

function validateScope(scope: OAuthScopeDefinition): void {
  if (scope.id.length > OAUTH_SCOPE_ID_MAX_LENGTH) {
    throw new Error(`scope id "${scope.id}" is longer than ${OAUTH_SCOPE_ID_MAX_LENGTH} characters`);
  }
  for (const field of ['title', 'description'] as const) {
    if (typeof scope[field] !== 'string' || scope[field].trim() === '') {
      throw new Error(`scope "${scope.id}": ${field} must be a non-empty string`);
    }
  }
  if (!RISKS.includes(scope.risk)) {
    throw new Error(`scope "${scope.id}": risk must be one of ${RISKS.join(', ')}`);
  }
  if (!Array.isArray(scope.permissions) || scope.permissions.some((p) => typeof p !== 'string' || p === '')) {
    throw new Error(`scope "${scope.id}": permissions must be an array of permission ids`);
  }
  if (new Set(scope.permissions).size !== scope.permissions.length) {
    throw new Error(`scope "${scope.id}": permissions lists an id twice`);
  }
}

/**
 * Every registered scope: `offline_access`, then the app's. Frozen once the
 * application has bootstrapped.
 *
 * @stability experimental
 */
export const oauthScopeRegistry: Registry<OAuthScopeDefinition> = defineRegistry<OAuthScopeDefinition>({
  name: 'identity.oauth-scopes',
  idOf: (scope) => scope.id,
  idPattern: OAUTH_SCOPE_ID_PATTERN,
  validate: validateScope,
});

/**
 * Registers an OAuth scope. Call it at module load, before the application is
 * created; a duplicate id throws.
 *
 * @param scope - the scope.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```ts
 * registerOAuthScope({ id: 'notes:read', title: 'Read your notes', description: 'See the notes you can see.', permissions: ['notes:read'], risk: 'low', default: true });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerOAuthScope(scope: OAuthScopeDefinition): void {
  oauthScopeRegistry.register(scope);
}

/**
 * The union of the permissions of `scopeIds`, deduplicated. An unregistered
 * scope id contributes nothing (a token never gains a permission from a scope
 * that no longer exists).
 *
 * @param scopeIds - scope ids, for example a token's.
 * @returns permission ids.
 *
 * @stability experimental
 */
export function permissionsOfScopes(scopeIds: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of scopeIds) {
    for (const permission of oauthScopeRegistry.get(id)?.permissions ?? []) out.add(permission);
  }
  return [...out];
}

if (!oauthScopeRegistry.has(OFFLINE_ACCESS_SCOPE)) {
  oauthScopeRegistry.register({
    id: OFFLINE_ACCESS_SCOPE,
    title: 'Stay connected',
    description: 'Stay connected without asking again (allows a refresh token).',
    permissions: [],
    risk: 'low',
  });
}
