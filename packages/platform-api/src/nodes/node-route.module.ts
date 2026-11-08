// =============================================================================
// NodeRouteModule: what a feature module imports to use @NodeRoute()
// =============================================================================
//
// `NodesModule` does not export `NodesService` (a feature module that could
// inject it could claim and settle jobs). This module is the narrow door: it
// provides `NodeRouteGuard` (the guard `@NodeRoute()` applies is instantiated
// in the module of the controller that uses it) and `NodeOwnershipService`
// (the ownership rule alone), and it fails the application at bootstrap when a
// `@NodeRoute()` controller sits outside `/api/nodes` or overlaps a reserved
// sub-path. Import it in each module that declares a node route controller.
// =============================================================================

import { Injectable, Module, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';

import { NODE_ROUTE_PREFIX } from '../identity/index';
import { NODE_ROUTE_METADATA } from './node-route.options';
import { controllerRoutes, reservedNodeSubpathOverlap } from './node-route.paths';
import { NodeOwnershipService } from './node-ownership';
import { NodeRouteGuard } from './node-route.guard';
import type { Type } from '@nestjs/common';

/**
 * The problems with the `@NodeRoute()` controllers given, one message each.
 *
 * @param controllers - controller classes.
 * @returns the violations; empty when every node route is placed correctly.
 *
 * @stability experimental
 */
export function findNodeRoutePlacementProblems(controllers: ReadonlyArray<Type<unknown>>): string[] {
  const problems: string[] = [];
  for (const controller of controllers) {
    const classDeclared = Reflect.getMetadata(NODE_ROUTE_METADATA, controller) !== undefined;
    for (const route of controllerRoutes(controller)) {
      const handler = (controller.prototype as Record<string, unknown>)[route.handler] as object;
      if (!classDeclared && Reflect.getMetadata(NODE_ROUTE_METADATA, handler) === undefined) continue;
      if (route.nodeSegments === null) {
        problems.push(`${route.id} is a @NodeRoute() but its path "/${route.path}" is not under ${NODE_ROUTE_PREFIX}.`);
        continue;
      }
      const reserved = reservedNodeSubpathOverlap(route.nodeSegments);
      if (reserved !== null) {
        problems.push(`${route.id} (${NODE_ROUTE_PREFIX}/${route.nodeSegments.join('/')}) overlaps the platform-reserved sub-path "${reserved}".`);
      }
    }
  }
  return problems;
}

@Injectable()
class NodeRoutePlacementCheck implements OnApplicationBootstrap {
  constructor(private readonly discovery: DiscoveryService) {}

  onApplicationBootstrap(): void {
    const controllers = this.discovery
      .getControllers()
      .map((wrapper) => wrapper.metatype as Type<unknown> | null)
      .filter((type): type is Type<unknown> => typeof type === 'function');
    const problems = findNodeRoutePlacementProblems(controllers);
    if (problems.length > 0) {
      throw new Error(`Invalid @NodeRoute() placement:\n- ${problems.join('\n- ')}`);
    }
  }
}

/**
 * Provides and exports `NodeRouteGuard` and `NodeOwnershipService`, and runs the
 * placement check at bootstrap. Import it where a `@NodeRoute()` controller is
 * declared.
 *
 * @extensionPoint composition
 * @stability experimental
 */
@Module({
  imports: [DiscoveryModule],
  providers: [NodeOwnershipService, NodeRouteGuard, NodeRoutePlacementCheck],
  exports: [NodeOwnershipService, NodeRouteGuard],
})
export class NodeRouteModule {}
