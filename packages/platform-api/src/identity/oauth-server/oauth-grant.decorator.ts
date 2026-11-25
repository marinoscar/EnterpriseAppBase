import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { OAuthPrincipalInfo, Principal } from '../../core/index';

/**
 * The OAuth metadata of a request's principal: its client, grant, resource and
 * scopes, or `null` when the request is not authenticated with an `oat_` token.
 *
 * @param request - the request.
 * @returns `principal.oauth`, or `null`.
 *
 * @stability experimental
 */
export function oauthGrantOf(request: { principal?: Principal } | undefined): OAuthPrincipalInfo | null {
  const principal = request?.principal;
  return principal && principal.kind === 'user' ? (principal.oauth ?? null) : null;
}

/**
 * Parameter decorator: `@OAuthGrant() grant: OAuthPrincipalInfo | null`.
 *
 * @example
 * ```ts
 * @Get('whoami')
 * @Auth()
 * whoami(@OAuthGrant() grant: OAuthPrincipalInfo | null) {
 *   return { client: grant?.clientId ?? null };
 * }
 * ```
 *
 * @stability experimental
 */
export const OAuthGrant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OAuthPrincipalInfo | null =>
    oauthGrantOf(ctx.switchToHttp().getRequest<{ principal?: Principal }>()),
);
