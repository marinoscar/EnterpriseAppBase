// =============================================================================
// Where an app node route may live: the reserved sub-paths of `/api/nodes`
// =============================================================================
//
// `JwtAuthGuard` admits a `nod_` credential on `/api/nodes` and anything under
// it (by raw URL). The platform's own control plane occupies part of that
// space; an app route that landed on top of it would be shadowed by, or would
// shadow, a platform route depending on module order. These helpers state the
// reserved part once, and compute a controller's routes so that the bootstrap
// check (`NodeRouteModule`) and the `nodes` conformance suite apply the very
// same rule.
// =============================================================================

import type { Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { NODE_ROUTE_PREFIX } from '../identity/index';

/**
 * The sub-paths of `/api/nodes` the platform owns, relative to the collection,
 * with `:param` for a path parameter. `''` is the collection itself; a trailing
 * `/*` reserves everything beneath. A `@NodeRoute()` route that overlaps one
 * (a parameter overlaps a literal, the HTTP method is ignored) fails at
 * bootstrap and in the `nodes` conformance suite. Mount an app feature on a
 * sub-path NOT listed here, for example `nodes/:id/<feature>/...`.
 *
 * @stability stable
 */
export const RESERVED_NODE_SUBPATHS: readonly string[] = Object.freeze([
  '',
  'register',
  'job-types',
  ':id',
  ':id/events',
  ':id/deregister',
  ':id/heartbeat',
  ':id/claim',
  ':id/telemetry',
  ':id/jobs/*',
  'models/*',
]);

/**
 * One route of a controller, as the node-route checks see it.
 *
 * @stability experimental
 */
export interface NodeControllerRoute {
  /** `Controller#handler`. */
  readonly id: string;
  /** The handler's method name. */
  readonly handler: string;
  /** The full path without the global prefix, for example `nodes/:id/backup/changes`. */
  readonly path: string;
  /** The segments of `path` after the `nodes` collection, for example `[':id', 'backup', 'changes']`; `null` when the route is not under `/api/nodes`. */
  readonly nodeSegments: readonly string[] | null;
}

function pathsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return [value];
  return [''];
}

function segmentsOf(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

/** The collection name, `nodes`, from {@link NODE_ROUTE_PREFIX}. */
const NODES_SEGMENT = NODE_ROUTE_PREFIX.split('/').filter(Boolean).pop() as string;

/**
 * Every route of `controller` with its full path. A leading `api` segment (the
 * global prefix) is dropped, so `api/nodes/x` and `nodes/x` read the same.
 *
 * @param controller - a controller class.
 * @returns one entry per handler per declared path.
 *
 * @stability experimental
 */
export function controllerRoutes(controller: Type<unknown>): NodeControllerRoute[] {
  const out: NodeControllerRoute[] = [];
  const prototype = controller.prototype as Record<string, unknown>;
  const names = new Set<string>();
  for (let proto: object | null = prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
  }
  for (const handler of names) {
    const fn = prototype[handler];
    if (handler === 'constructor' || typeof fn !== 'function') continue;
    if (Reflect.getMetadata(METHOD_METADATA, fn) === undefined || Reflect.getMetadata(PATH_METADATA, fn) === undefined) continue;
    for (const base of pathsOf(Reflect.getMetadata(PATH_METADATA, controller))) {
      for (const leaf of pathsOf(Reflect.getMetadata(PATH_METADATA, fn))) {
        let segments = [...segmentsOf(base), ...segmentsOf(leaf)];
        if (segments[0] === 'api') segments = segments.slice(1);
        out.push({
          id: `${controller.name}#${handler}`,
          handler,
          path: segments.join('/'),
          nodeSegments: segments[0] === NODES_SEGMENT ? segments.slice(1) : null,
        });
      }
    }
  }
  return out;
}

function isParam(segment: string): boolean {
  return segment.startsWith(':');
}

/**
 * Whether the route's leading segments can match `pattern`. `routeParamMatches`
 * lets a route's own `:param` match a reserved literal: right for an exact
 * entry (a route `nodes/:x` swallows `nodes/register`), wrong for a `/*` prefix
 * (a route `nodes/:id/reports` is not `nodes/models/...`: a node id is a uuid).
 */
function segmentsOverlap(route: readonly string[], pattern: readonly string[], routeParamMatches: boolean): boolean {
  return pattern.every((segment, index) => {
    const other = route[index] as string;
    return segment === other || isParam(segment) || (routeParamMatches && isParam(other));
  });
}

/**
 * The reserved sub-path a route overlaps, or `null`.
 *
 * @param nodeSegments - the route's segments after `nodes`.
 * @returns the entry of {@link RESERVED_NODE_SUBPATHS} it collides with.
 *
 * @stability stable
 */
export function reservedNodeSubpathOverlap(nodeSegments: readonly string[]): string | null {
  for (const reserved of RESERVED_NODE_SUBPATHS) {
    const wildcard = reserved.endsWith('/*');
    const pattern = segmentsOf(wildcard ? reserved.slice(0, -2) : reserved);
    const overlaps = wildcard
      ? nodeSegments.length >= pattern.length && segmentsOverlap(nodeSegments, pattern, false)
      : nodeSegments.length === pattern.length && segmentsOverlap(nodeSegments, pattern, true);
    if (overlaps) return reserved;
  }
  return null;
}
