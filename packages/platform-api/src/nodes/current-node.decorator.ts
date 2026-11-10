import { createParamDecorator, ExecutionContext, InternalServerErrorException } from '@nestjs/common';

import type { WorkerNode } from '../jobs/index';

/** The request property `NodeRouteGuard` writes the verified node to. */
export const NODE_ROUTE_REQUEST_KEY = 'nodeRouteNode';

/**
 * Parameter decorator: the node `@NodeRoute()` resolved and proved the caller
 * owns, loaded once by the guard.
 *
 * @throws InternalServerErrorException when the route is not a `@NodeRoute()`
 *   with a `nodeParam` (a programming error, never a client error).
 *
 * @example
 * ```ts
 * changes(@CurrentNode() node: WorkerNode) {}
 * ```
 *
 * @stability experimental
 */
export const CurrentNode = createParamDecorator((_data: unknown, ctx: ExecutionContext): WorkerNode => {
    const node = (ctx.switchToHttp().getRequest() as Record<string, WorkerNode | undefined>)[NODE_ROUTE_REQUEST_KEY];
    if (!node) {
      throw new InternalServerErrorException('CurrentNode() needs a @NodeRoute() route with a nodeParam.');
    }
    return node;
});
