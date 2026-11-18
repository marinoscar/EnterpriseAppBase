// =============================================================================
// The OAuth protected-resource registry (PP-15.3, docs/specs/oauth-server.md §2.17)
// =============================================================================
//
// A protected resource is a part of the API an `oat_` token may reach: an
// audience (`APP_URL + path`), the route prefixes a token for it is admitted on
// and the scopes it accepts. Route confinement (guard step 2) is decided on
// these prefixes alone, with no I/O, so every rule here is checked when the
// resource is REGISTERED (at import time): a boot error beats a request-time
// surprise on an authentication path.
// =============================================================================

import { defineRegistry, type Registry } from '../../core/index';
import { isUnderRoutePrefix } from '../auth/route-prefix';
import { OFFLINE_ACCESS_SCOPE, oauthScopeRegistry } from './oauth-scope.registry';

/**
 * Route prefixes no resource may claim: the OAuth server's own routes, sign-in
 * and the worker-node plane.
 *
 * @stability experimental
 */
export const FORBIDDEN_OAUTH_ROUTE_PREFIXES: readonly string[] = Object.freeze(['/api/oauth', '/api/auth', '/api/nodes']);

/**
 * One registered protected resource.
 *
 * @stability experimental
 * @example
 * ```ts
 * const resource: OAuthProtectedResourceDefinition = {
 *   id: 'notes',
 *   path: '/api/notes-agent',
 *   routePrefixes: ['/api/notes-agent'],
 *   scopes: ['notes:read', 'notes:write'],
 *   name: 'Notes agent',
 * };
 * ```
 */
export interface OAuthProtectedResourceDefinition {
  /** The resource id (lower-case, 2 to 32 characters). */
  readonly id: string;
  /** The resource identifier is `APP_URL + path`. */
  readonly path: string;
  /** Where an `oat_` token for this resource is admitted. */
  readonly routePrefixes: readonly string[];
  /** Scopes this resource accepts: a subset of the scope registry (checked at bootstrap). */
  readonly scopes: readonly string[];
  /** `resource_name` in the metadata and on the consent page. */
  readonly name: string;
  /** Optional `resource_documentation`. */
  readonly documentation?: string;
}

/** The pattern a resource id matches. */
const RESOURCE_ID_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;

function validatePrefix(resourceId: string, prefix: unknown): string {
  if (typeof prefix !== 'string' || !/^\/[A-Za-z0-9._~\-/]*$/.test(prefix) || prefix.length < 2 || prefix.endsWith('/') || prefix.includes('//')) {
    throw new Error(
      `resource "${resourceId}": route prefix ${JSON.stringify(prefix)} must start with "/", have no trailing slash and no "//"`,
    );
  }
  if (prefix.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`resource "${resourceId}": route prefix ${JSON.stringify(prefix)} has a dot segment`);
  }
  for (const forbidden of FORBIDDEN_OAUTH_ROUTE_PREFIXES) {
    if (isUnderRoutePrefix(prefix, forbidden) || isUnderRoutePrefix(forbidden, prefix)) {
      throw new Error(`resource "${resourceId}": route prefix "${prefix}" overlaps "${forbidden}", which no resource may claim`);
    }
  }
  return prefix;
}

function validateResource(resource: OAuthProtectedResourceDefinition, registry: Registry<OAuthProtectedResourceDefinition>): void {
  for (const field of ['name'] as const) {
    if (typeof resource[field] !== 'string' || resource[field].trim() === '') {
      throw new Error(`resource "${resource.id}": ${field} must be a non-empty string`);
    }
  }
  if (typeof resource.path !== 'string' || !resource.path.startsWith('/') || resource.path.includes('?') || resource.path.includes('#')) {
    throw new Error(`resource "${resource.id}": path must start with "/" and carry no query or fragment`);
  }
  if (!Array.isArray(resource.routePrefixes) || resource.routePrefixes.length === 0) {
    throw new Error(`resource "${resource.id}": routePrefixes must list at least one prefix`);
  }
  const own = resource.routePrefixes.map((prefix) => validatePrefix(resource.id, prefix));
  for (const [i, a] of own.entries()) {
    for (const b of own.slice(i + 1)) {
      if (isUnderRoutePrefix(a, b) || isUnderRoutePrefix(b, a)) {
        throw new Error(`resource "${resource.id}": route prefixes "${a}" and "${b}" overlap`);
      }
    }
  }
  for (const other of registry.list()) {
    for (const prefix of own) {
      for (const otherPrefix of other.routePrefixes) {
        if (isUnderRoutePrefix(prefix, otherPrefix) || isUnderRoutePrefix(otherPrefix, prefix)) {
          throw new Error(
            `resource "${resource.id}": route prefix "${prefix}" overlaps "${otherPrefix}" of resource "${other.id}"; resources may not share or nest route prefixes`,
          );
        }
      }
    }
  }
  if (!Array.isArray(resource.scopes) || resource.scopes.length === 0) {
    throw new Error(`resource "${resource.id}": scopes must list at least one scope`);
  }
}

/**
 * Every registered protected resource. Frozen once the application has bootstrapped.
 *
 * @stability experimental
 */
export const oauthResourceRegistry: Registry<OAuthProtectedResourceDefinition> = defineRegistry<OAuthProtectedResourceDefinition>({
  name: 'identity.oauth-resources',
  idOf: (resource) => resource.id,
  idPattern: RESOURCE_ID_PATTERN,
  validate: (resource, registry) => validateResource(resource, registry),
});

/**
 * Registers an OAuth protected resource. Call it at module load, before the
 * application is created.
 *
 * @param resource - the resource.
 * @throws RegistryError `INVALID_ENTRY` for a forbidden, shared or nested route
 *   prefix, `INVALID_ID`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```ts
 * registerOAuthProtectedResource({ id: 'notes', path: '/api/notes-agent', routePrefixes: ['/api/notes-agent'], scopes: ['notes:read'], name: 'Notes agent' });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerOAuthProtectedResource(resource: OAuthProtectedResourceDefinition): void {
  oauthResourceRegistry.register(resource);
}

/**
 * The registered resource whose route prefix `path` equals or lies under, or
 * `undefined`. Pure and I/O-free: this IS guard step 2. Prefixes cannot nest
 * across resources, so at most one matches.
 *
 * @param path - a request path without its query string.
 * @returns the matching resource.
 *
 * @stability experimental
 */
export function resourceForPath(path: string): OAuthProtectedResourceDefinition | undefined {
  for (const resource of oauthResourceRegistry.list()) {
    if (resource.routePrefixes.some((prefix) => isUnderRoutePrefix(path, prefix))) return resource;
  }
  return undefined;
}

/**
 * A registry problem found at bootstrap: it names the scope or resource.
 *
 * @stability experimental
 */
export interface OAuthRegistryProblem {
  /** `scope` or `resource`. */
  readonly kind: 'scope' | 'resource';
  /** The scope or resource id. */
  readonly id: string;
  /** What is wrong. */
  readonly message: string;
}

/**
 * The cross-registry checks that need every registration to be done: each
 * scope names only registered permissions; each resource names only registered
 * scopes (`offline_access` is accepted by every resource) and lists at least
 * one `default: true` scope.
 *
 * @param isPermission - whether a permission id is registered.
 * @returns every problem found (empty when the registries are consistent).
 *
 * @stability experimental
 */
export function findOAuthRegistryProblems(isPermission: (id: string) => boolean): OAuthRegistryProblem[] {
  const problems: OAuthRegistryProblem[] = [];
  for (const scope of oauthScopeRegistry.list()) {
    for (const permission of scope.permissions) {
      if (!isPermission(permission)) {
        problems.push({ kind: 'scope', id: scope.id, message: `OAuth scope "${scope.id}" names the unregistered permission "${permission}"` });
      }
    }
  }
  for (const resource of oauthResourceRegistry.list()) {
    for (const scopeId of resource.scopes) {
      if (scopeId !== OFFLINE_ACCESS_SCOPE && !oauthScopeRegistry.has(scopeId)) {
        problems.push({ kind: 'resource', id: resource.id, message: `OAuth resource "${resource.id}" names the unregistered scope "${scopeId}"` });
      }
    }
    if (!resource.scopes.some((scopeId) => oauthScopeRegistry.get(scopeId)?.default === true)) {
      problems.push({ kind: 'resource', id: resource.id, message: `OAuth resource "${resource.id}" lists no scope with default: true` });
    }
  }
  return problems;
}
