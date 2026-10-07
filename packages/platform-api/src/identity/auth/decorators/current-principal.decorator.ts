import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Principal } from '../../../core/index';

import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { toPrincipal } from '../principal.factory';

// =============================================================================
// @CurrentPrincipal(): the request's Principal (ADR 0001, issue #724)
// =============================================================================
//
// `JwtAuthGuard` sets `request.principal` for every credential it admits
// (session or device JWT, PAT, node), next to the legacy `request.user` that
// the ~120 `@CurrentUser()` call sites read. New code reads the principal:
// it carries the active org (`activeOrgId`, absent for a system-scoped node),
// every membership, the effective roles and permissions, and the credential
// kind. Call sites migrate module by module (ADR 0001, "Consequences").
//
// A request that reached a handler WITHOUT the guard having set it (a unit
// test that sets `request.user` by hand) gets one built from `request.user`
// the same way the guard builds it. A public route has neither: `undefined`.
// =============================================================================

/** The request properties the decorator reads. */
export interface RequestWithPrincipal {
  principal?: Principal;
  user?: AuthenticatedUser;
}

/** The request's principal, or `undefined` on a public route. */
export function principalOf(request: RequestWithPrincipal | undefined): Principal | undefined {
  if (!request) return undefined;
  if (request.principal) return request.principal;
  const user = request.user;
  if (!user || !Array.isArray(user.userRoles)) return undefined;
  return toPrincipal(user, user.tokenKind ?? 'session');
}

/**
 * Parameter decorator: the authenticated caller as a `Principal`.
 *
 * @example
 * ```ts
 * @Get('mine')
 * @Auth()
 * list(@CurrentPrincipal() principal: Principal) {
 *   return this.items.list({ userId: principal.userId, orgId: principal.activeOrgId });
 * }
 * ```
 */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal | undefined =>
    principalOf(ctx.switchToHttp().getRequest<RequestWithPrincipal>()),
);
