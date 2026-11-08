import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  AuthenticatedUser,
  RequestUser,
  toRequestUser,
} from '../interfaces/authenticated-user.interface';

/**
 * The request fields `@CurrentUser()` reads: `requestUser` (the simplified
 * user `PermissionsGuard`/`RolesGuard` set) and `user` (the full graph the
 * credential strategy loaded).
 */
interface FastifyRequestWithUser {
  user?: AuthenticatedUser;
  requestUser?: RequestUser;
}

/**
 * The caller as a {@link RequestUser}, whatever guards ran (issue #1103).
 *
 * `request.requestUser` is set only by a guard that checks roles or
 * permissions, so on a bare `@Auth()` route it is absent and `request.user`
 * is the raw user graph. This converts that graph with `toRequestUser` (and
 * remembers the result on the request) instead of leaking it.
 *
 * @param request - the Fastify request, or anything shaped like one.
 * @returns the request user, or `undefined` on a public route.
 *
 * @stability stable
 */
export function requestUserOf(request: FastifyRequestWithUser | undefined): RequestUser | undefined {
  if (!request) return undefined;
  if (request.requestUser) return request.requestUser;
  if (!request.user) return undefined;
  request.requestUser = toRequestUser(request.user);
  return request.requestUser;
}

/**
 * Decorator to extract the current authenticated user from the request.
 *
 * It always yields a {@link RequestUser} (`id`, `email`, `roles`,
 * `permissions`, `isActive`, `activeOrgId`), never the raw user graph, on
 * every `@Auth()` route including one with no permission list.
 *
 * @example
 * ```typescript
 * // Get the request user
 * @Get('profile')
 * getProfile(@CurrentUser() user: RequestUser) {
 *   return user;
 * }
 *
 * // Get specific property
 * @Get('email')
 * getEmail(@CurrentUser('email') email: string) {
 *   return { email };
 * }
 * ```
 *
 * @stability stable
 */
export const CurrentUser = createParamDecorator(
  (data: keyof RequestUser | undefined, ctx: ExecutionContext) => {
    const user = requestUserOf(ctx.switchToHttp().getRequest<FastifyRequestWithUser>());

    return data ? user?.[data] : user;
  },
);
