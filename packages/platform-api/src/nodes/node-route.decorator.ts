// =============================================================================
// @NodeRoute(): an app route on the node plane
// =============================================================================
//
// WHAT IT IS. `JwtAuthGuard` is the outer fence: a `nod_` credential reaches
// `/api/nodes` and what is under it, nothing else. `@NodeRoute()` is the inner
// one an app controller mounted there opts into. It composes `@Auth()` (the
// platform node plane's permission, by default) with `NodeRouteGuard`, which
// narrows the admitted credential kinds and PROVES the caller owns the node
// named in the path before the handler runs, so no handler can forget to.
//
// It only narrows. It never widens what `JwtAuthGuard` admits, and the prefix
// allowlist stays authoritative.
// =============================================================================

import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';

import { Auth } from '../identity/index';
import { NODE_ROUTE_METADATA, resolveNodeRouteOptions, type NodeRouteOptions } from './node-route.options';
import { NodeRouteGuard } from './node-route.guard';

/**
 * Marks an app controller (or handler) as a node-plane route. Its path must be
 * under `NODE_ROUTE_PREFIX` (`/api/nodes`) and must not overlap
 * `RESERVED_NODE_SUBPATHS` (checked at bootstrap by `NodeRouteModule` and by
 * the `nodes` conformance suite). The controller's module imports
 * `NodeRouteModule`, which provides the guard.
 *
 * The decorator applies `@Auth({ permissions })` too, so a controller needs no
 * separate `@Auth()`.
 *
 * @param options - see {@link NodeRouteOptions}.
 * @returns a class and method decorator.
 *
 * @example
 * ```ts
 * @Controller('nodes/:id/reports')
 * @NodeRoute({ credentials: ['nod'] })
 * export class ReportsController {
 *   @Get('latest')
 *   latest(@CurrentNode() node: WorkerNode) {
 *     return this.reports.latestFor(node);
 *   }
 * }
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function NodeRoute(options: NodeRouteOptions = {}): ClassDecorator & MethodDecorator {
  const resolved = resolveNodeRouteOptions(options);
  return applyDecorators(
    SetMetadata(NODE_ROUTE_METADATA, resolved),
    Auth({ permissions: [...resolved.permissions] as never }),
    UseGuards(NodeRouteGuard),
  ) as ClassDecorator & MethodDecorator;
}
