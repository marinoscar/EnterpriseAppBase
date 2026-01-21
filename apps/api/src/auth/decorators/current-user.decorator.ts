import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * User object attached to the request after JWT validation
 */
export interface RequestUser {
  userId: string;
  email: string;
  roles: string[];
  permissions: string[];
}

/**
 * Extended Fastify request with user property
 */
interface FastifyRequestWithUser {
  user?: RequestUser;
}

/**
 * Decorator to extract the current authenticated user from the request
 *
 * @example
 * ```typescript
 * @Get('profile')
 * getProfile(@CurrentUser() user: RequestUser) {
 *   return user;
 * }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest<FastifyRequestWithUser>();
    return request.user as RequestUser;
  },
);
