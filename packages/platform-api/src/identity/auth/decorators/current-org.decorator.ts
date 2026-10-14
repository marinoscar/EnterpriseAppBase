import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';

import { principalOf, type RequestWithPrincipal } from './current-principal.decorator';

// =============================================================================
// @CurrentOrg(): the request's active organization id (issue #725)
// =============================================================================
//
// Row-level security shows a request one organization's rows, and the
// organization is `principal.activeOrgId`: carried in the signed access token,
// validated against the user's memberships by the guard, never read from a
// header, query or body. Handlers that touch tenant data pass it on to their
// service, which scopes the database client with it (`PrismaService.forOrg`).
//
// A caller with no active organization (a worker-node credential is
// system-scoped) is refused with 403: there is no organization to scope to,
// and an unscoped client would see nothing anyway.
// =============================================================================

/**
 * The id of the request's active organization.
 *
 * @stability stable
 */
export function activeOrgIdOf(request: RequestWithPrincipal & { user?: { activeOrgId?: string | null } }): string | undefined {
  const fromPrincipal = principalOf(request)?.activeOrgId;
  if (fromPrincipal) return fromPrincipal;
  const fromUser = request.user?.activeOrgId;
  return typeof fromUser === 'string' && fromUser.length > 0 ? fromUser : undefined;
}

/**
 * Parameter decorator: the active organization's id.
 *
 * @throws ForbiddenException (403) when the credential has no active organization.
 *
 * @example
 * ```ts
 * @Get()
 * @Auth({ permissions: [PERMISSIONS.STORAGE_READ] })
 * list(@CurrentUser('id') userId: string, @CurrentOrg() orgId: string) {
 *   return this.objects.list(query, userId, orgId);
 * }
 * ```
 *
 * @stability stable
 */
export const CurrentOrg = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const orgId = activeOrgIdOf(ctx.switchToHttp().getRequest<RequestWithPrincipal>());
  if (!orgId) throw new ForbiddenException('This credential has no active organization');
  return orgId;
});
