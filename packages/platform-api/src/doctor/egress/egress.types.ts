// =============================================================================
// Outbound dependencies: the egress inventory's contract (issue #773, PP-13.2)
// =============================================================================
//
// Every capability that talks to a host outside the deployment (Google
// sign-in, an AI provider, a push service, an SMTP relay, an object store,
// GreptimeDB, the API docs CDN) describes that dependency here, through an
// `EgressContributor` its OWNING module registers with `EgressRegistry`. The
// `network.egress` doctor check reads the whole inventory and, when the
// deployment declares `DEPLOYMENT_NETWORK=air-gapped`, grades it.
//
// THE DOCTOR'S READ-ONLY RULE BINDS EVERY CONTRIBUTOR (doctor-check.interface.ts,
// rules 3 and 4): `describe()` reads settings and configuration only. No test
// service, no write, no job, no model call, no network I/O (no DNS lookup, no
// connect). It returns HOSTNAMES ONLY: never a URL, a path, a query, userinfo,
// a key, a region-scoped credential or a fingerprint.
// =============================================================================

/**
 * Where a host lives, as far as configuration can tell without a DNS lookup.
 *
 * - `public`: reachable only over the internet (`api.openai.com`).
 * - `private`: on the deployment's own network (`localhost`, `minio`,
 *   `10.0.0.5`, `smtp.corp.internal`).
 * - `unknown`: no host, or one that could not be parsed. Graded as `public`
 *   for an air-gapped deployment (fail closed).
 *
 * @stability experimental
 */
export type EgressScope = 'public' | 'private' | 'unknown';

/**
 * Which side opens the connection: the API process, the user's browser
 * (a CDN bundle, a provider's realtime endpoint), or both (presigned object
 * storage URLs).
 *
 * @stability experimental
 */
export type EgressDirection = 'server' | 'browser' | 'both';

/**
 * Every value `DEPLOYMENT_NETWORK` accepts, in documentation order.
 *
 * @stability experimental
 */
export const DEPLOYMENT_NETWORKS = ['online', 'air-gapped'] as const;

/**
 * Whether the deployment has internet egress: `online` (the default) or
 * `air-gapped`. A deployment-level fact the app reads from `DEPLOYMENT_NETWORK`.
 *
 * @stability experimental
 */
export type DeploymentNetwork = (typeof DEPLOYMENT_NETWORKS)[number];

/**
 * The most hosts one dependency reports; the rest are dropped (a push service
 * fleet can be long, and the report is a summary, not a firewall rule set).
 *
 * @stability experimental
 */
export const EGRESS_MAX_HOSTS = 20;

/**
 * One outbound dependency of the running deployment: what an
 * {@link EgressContributor} returns. Build it with `egressDependency()`, which
 * reduces hosts to hostnames and computes `scope`.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export interface EgressDependency {
  /** Stable, dotted, unique in the inventory: `auth.google`, `ai.provider.openai`, `storage.s3`. */
  id: string;
  /** Human label: "Google sign-in", "AI provider: OpenAI". */
  capability: string;
  /** Which side opens the connection. */
  direction: EgressDirection;
  /** Configured AND switched on right now. A disabled dependency is listed but never graded. */
  enabled: boolean;
  /** Hostnames only (no scheme, userinfo, port, path or query); de-duplicated, at most {@link EGRESS_MAX_HOSTS}. */
  hosts: string[];
  /** The worst scope over `hosts` (`public`, then `unknown`, then `private`); `unknown` when there is no host. */
  scope: EgressScope;
  /** The deployment cannot do its core job without it (the only sign-in provider). */
  required: boolean;
  /** One line: what stops working without egress. */
  degradation: string;
  /** The web route that configures it, e.g. `/admin/settings/ai`. */
  settingsPath?: string;
  /** A count behind the dependency (push subscriptions, say). Counts only, never values. */
  count?: number;
}

/**
 * What a contributor passes to {@link egressDependency}: an
 * {@link EgressDependency} without `scope`, whose `hosts` may still be URLs or
 * `host:port` strings. The helper reduces them to hostnames and computes the scope.
 *
 * @stability experimental
 */
export type EgressDependencyInput = Omit<EgressDependency, 'scope' | 'hosts'> & {
  /** URLs, `host:port` strings or bare hostnames; empty and unparsable entries are dropped. */
  hosts: readonly (string | null | undefined)[];
};

/**
 * A module's description of its outbound dependencies. An `@Injectable()` in
 * the module that owns the capability, which injects `EgressRegistry` and calls
 * `register(this)` from its `onModuleInit`.
 *
 * `describe()` is READ-ONLY (the doctor's rule 3): settings and configuration
 * reads only, no network I/O, no write, no job, no model call. It returns no
 * secret material: hostnames only (rule 4). It may throw; the `network.egress`
 * check turns a throw into one `unknown` entry under the contributor's id.
 *
 * @example
 * ```ts
 * @Injectable()
 * export class DocsEgressContributor implements EgressContributor, OnModuleInit {
 *   readonly id = 'docs';
 *   constructor(private readonly egress: EgressRegistry) {}
 *   onModuleInit(): void { this.egress.register(this); }
 *   async describe(): Promise<EgressDependency[]> {
 *     return [egressDependency({ id: 'docs.scalar-cdn', capability: 'API reference (Scalar CDN)',
 *       direction: 'browser', enabled: true, required: false, hosts: ['https://cdn.jsdelivr.net'],
 *       degradation: '/api/docs renders without its bundle' })];
 *   }
 * }
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export interface EgressContributor {
  /** Unique across the application: `auth`, `ai.providers`, `docs`. */
  readonly id: string;
  /** Read-only, no network I/O, hostnames only. */
  describe(): Promise<EgressDependency[]>;
}

/**
 * Where the `network.egress` check reads `DEPLOYMENT_NETWORK` from: anything
 * with a `network` property. The app binds it to its own parsed value under
 * {@link DEPLOYMENT_NETWORK_SOURCE}; unbound, the check assumes `online`.
 *
 * @stability experimental
 */
export interface DeploymentNetworkSource {
  /** The parsed `DEPLOYMENT_NETWORK`. */
  readonly network: DeploymentNetwork;
}

/**
 * The injection token of the app's {@link DeploymentNetworkSource}. Bind it
 * once, globally (`{ provide: DEPLOYMENT_NETWORK_SOURCE, useExisting: <the app's service> }`).
 *
 * @extensionPoint token
 * @stability experimental
 */
export const DEPLOYMENT_NETWORK_SOURCE: unique symbol = Symbol('DEPLOYMENT_NETWORK_SOURCE');
