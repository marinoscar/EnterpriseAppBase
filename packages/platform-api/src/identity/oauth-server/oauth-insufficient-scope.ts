// =============================================================================
// Step-up: `403 insufficient_scope` (PP-15.6, docs/specs/oauth-server.md §2.7 and §2.16)
// =============================================================================
//
// A narrowed principal lacks what an operation needs. The answer is a REAL HTTP
// 403 whose `WWW-Authenticate` lists the scopes the token already holds TOGETHER
// WITH the missing ones (hosted clients do not reliably carry earlier scopes into
// a step-up) and the metadata URL. A `200` carrying an error result would show
// the text to the model instead of starting a re-consent, so a resource must
// refuse with an HTTP status (vendors' documentation, spec §2.24).
//
// For a caller that is not an `oauth` credential it is an ordinary 403: the
// header is added only when the failed request's principal came from an `oat_`
// token.
// =============================================================================

import { ForbiddenException } from '@nestjs/common';

import { withResponseHeaders, type Principal } from '../../core/index';
import { buildBearerChallenge } from './oauth-challenge';
import { oauthGrantOf } from './oauth-grant.decorator';
import { oauthResourceRegistry } from './oauth-resource.registry';

/**
 * Thrown where an operation needs OAuth scopes the token lacks. Answers `403`
 * with `WWW-Authenticate: Bearer error="insufficient_scope", scope="<granted ∪ required>", resource_metadata="..."`
 * when the caller authenticated with an `oat_` token, and a plain `403` for
 * every other credential.
 *
 * @extensionPoint hook
 * @stability experimental
 * @example
 * ```ts
 * throw new InsufficientScopeException({ resourceId: 'notes', requiredScopes: ['notes:write'] });
 * ```
 */
export class InsufficientScopeException extends ForbiddenException {
  /** The protected resource id. */
  readonly resourceId: string;
  /** The scopes the operation needs and the token lacks. */
  readonly requiredScopes: readonly string[];

  /**
   * @param input - the resource id and the scopes that must be added.
   */
  constructor(input: { resourceId: string; requiredScopes: readonly string[] }) {
    super(`Insufficient scope: this operation needs ${input.requiredScopes.join(' ')}`);
    this.resourceId = input.resourceId;
    this.requiredScopes = Object.freeze([...input.requiredScopes]);
    withResponseHeaders(this, (request) => {
      const grant = oauthGrantOf(request as { principal?: Principal });
      if (!grant) return undefined;
      const granted = grant.scopes;
      const scope = [...new Set([...granted, ...this.requiredScopes])];
      return { 'WWW-Authenticate': buildBearerChallenge({ resourceId: this.resourceId, error: 'insufficient_scope', scope }) };
    });
  }
}

/**
 * A resource's body-level gate: call it where a decision depends on the
 * request body (an MCP server routing `tools/call`) and the operation needs
 * scopes. Throws {@link InsufficientScopeException} for an `oauth` principal
 * that lacks one of `scopes` (or whose grant is for another resource). Does
 * nothing for a session or PAT principal: those carry the user's whole
 * authority and are governed by permissions.
 *
 * The refusal MUST stay an HTTP `403`: never answer `200` with an error result.
 *
 * @param principal - the request's principal (`@CurrentPrincipal()`).
 * @param resourceId - the protected resource id.
 * @param scopes - the scopes the operation needs.
 * @throws InsufficientScopeException when the token lacks a scope.
 *
 * @extensionPoint hook
 * @stability experimental
 * @example
 * ```ts
 * assertOAuthScopes(principal, 'mcp', ['runs:write']);
 * ```
 */
export function assertOAuthScopes(principal: Principal | undefined, resourceId: string, scopes: readonly string[]): void {
  const grant = oauthGrantOf(principal ? { principal } : undefined);
  if (!grant) return;
  if (!oauthResourceRegistry.has(resourceId)) throw new Error(`assertOAuthScopes: unknown protected resource "${resourceId}"`);
  const missing = grant.resourceId === resourceId ? scopes.filter((scope) => !grant.scopes.includes(scope)) : [...scopes];
  if (missing.length > 0) throw new InsufficientScopeException({ resourceId, requiredScopes: missing });
}
