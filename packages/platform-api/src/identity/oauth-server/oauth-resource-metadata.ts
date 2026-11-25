// =============================================================================
// The protected resource metadata document (RFC 9728, PP-15.6)
// =============================================================================

import { OFFLINE_ACCESS_SCOPE } from './oauth-scope.registry';
import type { OAuthProtectedResourceDefinition } from './oauth-resource.registry';

/**
 * The document as served. `resource` is `APP_URL` + the resource's path exactly
 * (the URL a user types into a client), and `authorization_servers` has exactly
 * one entry because clients use only the first.
 *
 * @stability experimental
 */
export interface OAuthProtectedResourceMetadata {
  /** `APP_URL` + the resource's `path`, with no trailing slash. */
  resource: string;
  /** Exactly one entry: the issuer. */
  authorization_servers: [string];
  /** The resource's scopes, plus `offline_access`. */
  scopes_supported: string[];
  /** Always `header`. */
  bearer_methods_supported: ['header'];
  /** The resource's display name. */
  resource_name: string;
  /** The resource's documentation URL, when it declares one. */
  resource_documentation?: string;
}

/**
 * Builds the protected resource metadata document of `resource`.
 *
 * @param input - the issuer (`APP_URL` without a trailing slash), the resource identifier and the resource.
 * @returns the document.
 *
 * @stability experimental
 */
export function buildProtectedResourceMetadata(input: {
  issuer: string;
  identifier: string;
  resource: OAuthProtectedResourceDefinition;
  /** When given, `scopes_supported` lists only these ids (`offline_access` is always kept). Compute it with `availableScopes(resource.scopes, {})`. */
  availableScopeIds?: readonly string[];
}): OAuthProtectedResourceMetadata {
  const { resource } = input;
  const allowed = input.availableScopeIds ? new Set(input.availableScopeIds) : undefined;
  return {
    resource: input.identifier,
    authorization_servers: [input.issuer],
    scopes_supported: [...new Set([...resource.scopes, OFFLINE_ACCESS_SCOPE])].filter((id) => id === OFFLINE_ACCESS_SCOPE || !allowed || allowed.has(id)),
    bearer_methods_supported: ['header'],
    resource_name: resource.name,
    ...(resource.documentation ? { resource_documentation: resource.documentation } : {}),
  };
}
