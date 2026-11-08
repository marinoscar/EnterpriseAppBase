import { NODES_PERMISSIONS } from './nodes.permissions';

/**
 * The credential kinds a node route can admit: `nod` (a worker-node
 * credential), `pat` (a personal access token) and `jwt` (a session token).
 *
 * @stability stable
 */
export type NodeRouteCredential = 'nod' | 'pat' | 'jwt';

/**
 * Options of {@link NodeRoute}.
 *
 * @stability stable
 */
export interface NodeRouteOptions {
  /**
   * Credential kinds admitted. Default `['nod', 'pat', 'jwt']`, as on the
   * platform's own node routes. `['nod']` makes the route node-only: a human's
   * PAT or session is refused with 403.
   */
  credentials?: ReadonlyArray<NodeRouteCredential>;
  /**
   * The route parameter holding the node id; node ownership is enforced before
   * the handler runs. Default `'id'`. `false` for a route that names no node
   * (it then has no `CurrentNode()`).
   */
  nodeParam?: string | false;
  /** Permissions required, as `@Auth({ permissions })`. Default `['nodes:write']`, the platform node plane's. */
  permissions?: string[];
}

/** The defaults, resolved. */
export interface ResolvedNodeRouteOptions {
  readonly credentials: ReadonlyArray<NodeRouteCredential>;
  readonly nodeParam: string | false;
  readonly permissions: readonly string[];
}

/** Metadata key under which {@link NodeRoute} records its resolved options. */
export const NODE_ROUTE_METADATA = 'platform:node-route';

/** The default admitted credential kinds. */
export const DEFAULT_NODE_ROUTE_CREDENTIALS: ReadonlyArray<NodeRouteCredential> = Object.freeze(['nod', 'pat', 'jwt']);

/**
 * Resolves the options a route declared against the defaults.
 *
 * @param options - what was passed to {@link NodeRoute}.
 * @returns the effective options.
 *
 * @stability experimental
 */
export function resolveNodeRouteOptions(options: NodeRouteOptions = {}): ResolvedNodeRouteOptions {
  return {
    credentials: options.credentials && options.credentials.length > 0 ? [...options.credentials] : DEFAULT_NODE_ROUTE_CREDENTIALS,
    nodeParam: options.nodeParam === undefined ? 'id' : options.nodeParam,
    permissions: options.permissions ?? [NODES_PERMISSIONS.NODES_WRITE.id],
  };
}

