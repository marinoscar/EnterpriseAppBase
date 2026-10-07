import { createParamDecorator, ForbiddenException, type ExecutionContext } from '@nestjs/common';

import type { Principal } from '../../core/index';

/**
 * Builds the `@CurrentPrincipal()` parameter decorator of the group routes
 * from the module's principal resolver. A route that reached the handler
 * without a principal (never true behind the host's access decorators) is
 * refused with 403 rather than run unscoped.
 *
 * @param resolve - reads the principal from the framework request.
 * @returns the parameter decorator factory.
 *
 * @stability experimental
 */
export function createSharingPrincipalDecorator(resolve: (request: unknown) => Principal | undefined): () => ParameterDecorator {
  return createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal => {
    const principal = resolve(ctx.switchToHttp().getRequest());
    if (!principal) throw new ForbiddenException('No authenticated principal');
    return principal;
  });
}
