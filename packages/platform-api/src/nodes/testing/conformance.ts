// =============================================================================
// The nodes slice's conformance suite (issue #1076)
// =============================================================================
//
// What it proves about the APP that consumes the package. Importing
// `@marinoscar/platform-api/nodes/testing` registers the `nodes` suite with
// `runPlatformConformance()`.
//
//   1. node-route-declared: every route an app mounts under `/api/nodes`
//      (outside the packaged control plane) carries `@NodeRoute()`. A
//      `nod_` credential reaches the whole prefix, so a route without it is
//      one a leaked worker token can call with no node-ownership check.
//   2. node-route-placement: no such route overlaps `RESERVED_NODE_SUBPATHS`,
//      and the guard is really on it.
//   3. node-route-ownership: for each declared route, the guard `@NodeRoute()`
//      applies refuses a credential kind the route did not admit, refuses
//      another user's node (403), a missing node (404), and admits the owner.
//
// Checks 1 and 2 run in the scan; 3 is asynchronous and runs in its own case.
// =============================================================================

import { ForbiddenException, NotFoundException, type DynamicModule, type ExecutionContext, type Type } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import { discoverAppControllers as discoverControllers } from './discover';
import type { WorkerNode } from '../../jobs/index';
import { conformanceSuites } from '../../testing/index';
import type { ConformanceCase, ConformanceFinding, ConformanceReport, ConformanceSuite } from '../../testing/index';
import { NODE_ROUTE_REQUEST_KEY } from '../current-node.decorator';
import { NodeRouteGuard } from '../node-route.guard';
import { NODE_ROUTE_METADATA, type ResolvedNodeRouteOptions } from '../node-route.options';
import { controllerRoutes, reservedNodeSubpathOverlap } from '../node-route.paths';
import type { NodeOwnershipService } from '../node-ownership';
import { NodesController } from '../nodes.controller';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The nodes slice's suite: its options, or `false` to opt out. Registered by importing `@marinoscar/platform-api/nodes/testing`. */
    nodes?: NodesConformanceOptions | false;
  }
}

/**
 * What an app passes as `suites.nodes` to `runPlatformConformance()`.
 *
 * @stability experimental
 */
export interface NodesConformanceOptions {
  /** The app's root module; every controller reachable from it is checked. */
  readonly rootModule: Type<unknown> | DynamicModule;
  /** Fewest packaged control-plane routes the walk must find (a vacuity guard); 1 by default. */
  readonly minPlatformRoutes?: number;
}

/**
 * One app route under `/api/nodes`, as the suite sees it.
 *
 * @stability experimental
 */
export interface NodeAppRoute {
  /** `Controller#handler`. */
  readonly id: string;
  /** The controller class. */
  readonly controller: Type<unknown>;
  /** The handler function. */
  readonly handler: (...args: never[]) => unknown;
  /** The path after `nodes`, as segments. */
  readonly nodeSegments: readonly string[];
  /** What `@NodeRoute()` recorded, or `undefined` when the route does not carry it. */
  readonly declared: ResolvedNodeRouteOptions | undefined;
  /** Whether `NodeRouteGuard` is among the route's guards. */
  readonly guarded: boolean;
}

/**
 * What {@link discoverNodeAppRoutes} found.
 *
 * @stability experimental
 */
export interface NodeAppRouteDiscovery {
  /** The app's routes under `/api/nodes`. */
  routes: NodeAppRoute[];
  /** How many packaged control-plane routes the walk saw (a vacuity guard). */
  platformRoutes: number;
}

/**
 * Every route the app mounts under `/api/nodes` outside the packaged control plane.
 *
 * @param controllers - from `discoverControllers`.
 * @returns the app routes, plus the count of packaged routes seen.
 *
 * @stability experimental
 */
export function discoverNodeAppRoutes(controllers: ReadonlyArray<Type<unknown>>): NodeAppRouteDiscovery {
  const routes: NodeAppRoute[] = [];
  let platformRoutes = 0;
  for (const controller of controllers) {
    for (const route of controllerRoutes(controller)) {
      if (route.nodeSegments === null) continue;
      if (controller === NodesController) {
        platformRoutes += 1;
        continue;
      }
      const handler = (controller.prototype as Record<string, unknown>)[route.handler] as NodeAppRoute['handler'];
      const guards = [
        ...((Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[]),
        ...((Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[]),
      ];
      routes.push({
        id: route.id,
        controller,
        handler,
        nodeSegments: route.nodeSegments,
        declared: (Reflect.getMetadata(NODE_ROUTE_METADATA, handler) ?? Reflect.getMetadata(NODE_ROUTE_METADATA, controller)) as ResolvedNodeRouteOptions | undefined,
        guarded: guards.includes(NodeRouteGuard),
      });
    }
  }
  return { routes, platformRoutes };
}

/**
 * Checks 1 and 2: declared, placed, guarded.
 *
 * @param routes - from {@link discoverNodeAppRoutes}.
 * @returns the violations.
 *
 * @stability experimental
 */
export function checkNodeAppRoutes(routes: readonly NodeAppRoute[]): ConformanceFinding[] {
  const out: ConformanceFinding[] = [];
  for (const route of routes) {
    const where = `/api/nodes/${route.nodeSegments.join('/')}`;
    if (!route.declared) {
      out.push({
        file: route.id,
        message: `is mounted at ${where}, which a nod_ worker credential can reach, but carries no @NodeRoute(). Add @NodeRoute() (it enforces node ownership before the handler runs) or move the route off /api/nodes.`,
      });
      continue;
    }
    if (!route.guarded) {
      out.push({ file: route.id, message: `carries @NodeRoute() metadata but NodeRouteGuard is not among its guards, so ownership is not enforced.` });
    }
    const reserved = reservedNodeSubpathOverlap(route.nodeSegments);
    if (reserved !== null) {
      out.push({ file: route.id, message: `${where} overlaps the platform-reserved sub-path "${reserved}" (RESERVED_NODE_SUBPATHS).` });
    }
    const param = route.declared.nodeParam;
    if (param !== false && !route.nodeSegments.includes(`:${param}`)) {
      out.push({ file: route.id, message: `declares nodeParam "${param}" but ${where} has no :${param} segment, so no node is ever resolved.` });
    }
  }
  return out;
}

const OWNER = 'user-owner';
const STRANGER = 'user-stranger';
const OWN_NODE = '11111111-1111-4111-8111-111111111111';
const OTHER_NODE = '22222222-2222-4222-8222-222222222222';
const MISSING_NODE = '33333333-3333-4333-8333-333333333333';
type Kind = 'node' | 'pat' | 'jwt';
const KINDS: ReadonlyArray<{ kind: Kind; name: 'nod' | 'pat' | 'jwt' }> = [
  { kind: 'node', name: 'nod' },
  { kind: 'pat', name: 'pat' },
  { kind: 'jwt', name: 'jwt' },
];

const stubOwnership = {
  async assertOwnership(userId: string, nodeId: string): Promise<WorkerNode> {
    if (nodeId === MISSING_NODE) throw new NotFoundException();
    if (nodeId === OTHER_NODE || userId !== OWNER) throw new ForbiddenException();
    return { id: nodeId, createdById: userId } as WorkerNode;
  },
} as unknown as NodeOwnershipService;

async function outcome(route: NodeAppRoute, kind: Kind, userId: string, nodeId: string | undefined): Promise<'admitted' | 'forbidden' | 'not-found' | 'other'> {
  const guard = new NodeRouteGuard(new Reflector(), stubOwnership);
  const request: Record<string, unknown> = {
    user: { id: userId },
    authCredential: kind === 'pat' ? { kind, tokenId: 'pat-1' } : { kind },
    params: route.declared && route.declared.nodeParam !== false && nodeId ? { [route.declared.nodeParam]: nodeId } : {},
  };
  const context = {
    getHandler: () => route.handler,
    getClass: () => route.controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  try {
    const admitted = await guard.canActivate(context);
    if (admitted && request[NODE_ROUTE_REQUEST_KEY] === undefined && route.declared?.nodeParam !== false) return 'other';
    return admitted ? 'admitted' : 'other';
  } catch (error) {
    if (error instanceof ForbiddenException) return 'forbidden';
    if (error instanceof NotFoundException) return 'not-found';
    return 'other';
  }
}

/**
 * Check 3: the guard on each declared route enforces credential kind and node ownership.
 *
 * @param routes - from {@link discoverNodeAppRoutes}.
 * @returns the violations.
 *
 * @stability experimental
 */
export async function checkNodeRouteOwnership(routes: readonly NodeAppRoute[]): Promise<ConformanceFinding[]> {
  const out: ConformanceFinding[] = [];
  for (const route of routes) {
    const declared = route.declared;
    if (!declared) continue;
    for (const { kind, name } of KINDS) {
      const expected = declared.credentials.includes(name) ? 'admitted' : 'forbidden';
      const actual = await outcome(route, kind, OWNER, OWN_NODE);
      if (actual !== expected) out.push({ file: route.id, message: `a ${name} credential should be ${expected} (it ${declared.credentials.includes(name) ? 'is' : 'is not'} listed), got ${actual}.` });
    }
    if (declared.nodeParam === false) continue;
    const foreign = await outcome(route, 'node', OWNER, OTHER_NODE);
    if (foreign !== 'forbidden') out.push({ file: route.id, message: `another user's node should be refused with 403, got ${foreign}.` });
    const stranger = await outcome(route, 'node', STRANGER, OWN_NODE);
    if (stranger !== 'forbidden') out.push({ file: route.id, message: `a caller who does not own the node should be refused with 403, got ${stranger}.` });
    const missing = await outcome(route, 'node', OWNER, MISSING_NODE);
    if (missing !== 'not-found') out.push({ file: route.id, message: `a missing node should answer 404, got ${missing}.` });
  }
  return out;
}

/**
 * The `nodes` conformance suite. Registered when
 * `@marinoscar/platform-api/nodes/testing` is imported.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const nodesConformanceSuite: ConformanceSuite<NodesConformanceOptions> = {
  id: 'nodes',
  title: 'app routes on the node plane enforce node ownership',
  description:
    'Every app route under /api/nodes carries @NodeRoute(), stays off the platform-reserved sub-paths, and its guard refuses an unlisted credential kind, another user\'s node and a missing node.',
  check(_context, options): ConformanceReport {
    const controllers = discoverControllers(options.rootModule);
    const { routes, platformRoutes } = discoverNodeAppRoutes(controllers);
    const findings = checkNodeAppRoutes(routes);
    const minimum = options.minPlatformRoutes ?? 1;
    if (platformRoutes < minimum) {
      findings.push({ file: 'routes', message: `the walk found ${platformRoutes} packaged node route(s), fewer than ${minimum}: is rootModule the app's root module?` });
    }
    return {
      scanned: { appNodeRoutes: routes.length, platformNodeRoutes: platformRoutes },
      scannedFiles: { appNodeRoutes: routes.map((route) => route.id) },
      findings,
    };
  },
  cases(options): ConformanceCase[] {
    return [
      {
        name: 'node-route-declared: every app route under /api/nodes carries @NodeRoute() and stays off the reserved sub-paths',
        run: (report, expect) => {
          expect(report.findings).toEqual([]);
        },
      },
      {
        name: 'node-route-ownership: the guard refuses an unlisted credential, another user\'s node and a missing node',
        run: async (_report, expect) => {
          const { routes } = discoverNodeAppRoutes(discoverControllers(options.rootModule));
          expect(await checkNodeRouteOwnership(routes)).toEqual([]);
        },
      },
    ];
  },
};

if (!conformanceSuites.has(nodesConformanceSuite.id)) conformanceSuites.register(nodesConformanceSuite);
