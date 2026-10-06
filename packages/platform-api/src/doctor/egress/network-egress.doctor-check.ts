// =============================================================================
// `network` / `network.egress`: outbound dependencies, air-gap readiness (#773)
// =============================================================================
//
// Every other check validates one capability. This one answers the
// deployment-level question: "what does this install need from the internet,
// and will it work where it is going?" It reads the inventory every module
// contributes to `EgressRegistry` and:
//
//   - online (the default): reports it, always `pass`. An internet-connected
//     deployment SHOULD reach Google and its AI provider; a permanent warning
//     there would only train operators to ignore the Doctor.
//   - air-gapped (`DEPLOYMENT_NETWORK=air-gapped`): grades it. Every ENABLED
//     dependency whose scope is not `private` will not work. A required one is
//     `fail`, optional ones are `warn`. `unknown` counts as public (fail closed).
//
// CONFIGURATION ONLY: it never probes reachability (a DNS lookup or a connect
// from an air-gapped network simply times out, and the doctor must be cheap).
// It never throws and never skips: an inventory is always computable, and a
// contributor that throws becomes one `unknown` entry under its own id.
// =============================================================================

import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';

import type { DoctorCheck, DoctorCheckOutcome, DoctorDataValue } from '../doctor-check.interface';
import { DoctorCheckRegistry } from '../doctor-check.registry';
import { EgressRegistry } from './egress.registry';
import { DEPLOYMENT_NETWORK_SOURCE } from './egress.types';
import type { DeploymentNetwork, DeploymentNetworkSource, EgressDependency } from './egress.types';

/**
 * The runbook every `warn`/`fail` remedy of `network.egress` names: one section
 * per dependency id, with what breaks offline and how to make it internal.
 *
 * @stability experimental
 */
export const AIR_GAPPED_RUNBOOK = 'docs/runbooks/air-gapped.md';

/**
 * The id of the check: `network.egress`.
 *
 * @stability experimental
 */
export const NETWORK_EGRESS_CHECK_ID = 'network.egress';

/** The longest `public_ids` value in the check's `data`. */
const PUBLIC_IDS_MAX = 500;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs every contributor of `registry` in parallel and concatenates their
 * dependencies, in registration order. A contributor that throws (or returns
 * something that is not an array) becomes ONE entry under its own id, scope
 * `unknown`, enabled, so an air-gapped grading fails closed. Never throws.
 *
 * @param registry - the app's egress registry.
 * @param onError - told the contributor id and message of each throw (for a log line).
 * @returns the whole inventory.
 *
 * @stability experimental
 */
export async function describeEgress(
  registry: Pick<EgressRegistry, 'list'>,
  onError?: (contributorId: string, message: string) => void,
): Promise<EgressDependency[]> {
  const contributors = registry.list();
  const results = await Promise.all(
    contributors.map(async (contributor) => {
      try {
        const deps = await contributor.describe();
        if (!Array.isArray(deps)) throw new Error('describe() did not return an array');
        return deps;
      } catch (error) {
        onError?.(contributor.id, describeError(error));
        const failed: EgressDependency = {
          id: contributor.id,
          capability: contributor.id,
          direction: 'server',
          enabled: true,
          hosts: [],
          scope: 'unknown',
          required: false,
          degradation: 'Could not be described (the contributor failed); treated as needing the internet',
        };
        return [failed];
      }
    }),
  );
  return results.flat();
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function hostsOf(dep: EgressDependency): string {
  return dep.hosts.length > 0 ? dep.hosts.join(', ') : 'an unknown host';
}

function joinIds(deps: readonly EgressDependency[]): string {
  const joined = deps.map((dep) => dep.id).join(',');
  return joined.length <= PUBLIC_IDS_MAX ? joined : `${joined.slice(0, PUBLIC_IDS_MAX - 3)}...`;
}

/**
 * Pure: grades an inventory for a deployment network. Only ENABLED
 * dependencies count; `unknown` counts as public.
 *
 * | network | finding | status |
 * |---|---|---|
 * | `online` | anything | `pass` (an inventory) |
 * | `air-gapped` | every enabled dependency private | `pass` |
 * | `air-gapped` | only optional dependencies public | `warn` |
 * | `air-gapped` | a required dependency public | `fail` |
 *
 * `data` holds scalars only: `network`, `enabled`, `public`, `private`,
 * `unknown`, `required_public` and `public_ids` (comma-joined, at most 500 characters).
 *
 * @param deps - the inventory ({@link describeEgress}).
 * @param network - the deployment's declared network.
 * @returns the check's outcome.
 *
 * @stability experimental
 */
export function gradeEgress(deps: readonly EgressDependency[], network: DeploymentNetwork): DoctorCheckOutcome {
  const enabled = deps.filter((dep) => dep.enabled);
  const publicDeps = enabled.filter((dep) => dep.scope === 'public');
  const privateDeps = enabled.filter((dep) => dep.scope === 'private');
  const unknownDeps = enabled.filter((dep) => dep.scope === 'unknown');
  const offline = enabled.filter((dep) => dep.scope !== 'private');
  const requiredOffline = offline.filter((dep) => dep.required);

  const data: Record<string, DoctorDataValue> = {
    network,
    enabled: enabled.length,
    public: publicDeps.length,
    private: privateDeps.length,
    unknown: unknownDeps.length,
    required_public: requiredOffline.length,
    public_ids: joinIds(offline),
  };

  if (network === 'online') {
    if (enabled.length === 0) return { status: 'pass', detail: 'No outbound dependency is enabled', data };
    const scopes = [`${publicDeps.length} public`, `${privateDeps.length} private`];
    if (unknownDeps.length > 0) scopes.push(`${unknownDeps.length} unknown`);
    return {
      status: 'pass',
      detail:
        `${plural(enabled.length, 'outbound dependency', 'outbound dependencies')} enabled (${scopes.join(', ')}): ` +
        enabled.map((dep) => dep.capability).join(', '),
      data,
    };
  }

  if (offline.length === 0) {
    return { status: 'pass', detail: 'Air-gap ready: every enabled dependency is on a private network', data };
  }

  if (requiredOffline.length > 0) {
    const optional = offline.length - requiredOffline.length;
    const needs = requiredOffline.map((dep) => `${dep.capability} needs ${hostsOf(dep)}`).join('; ');
    return {
      status: 'fail',
      detail:
        `${needs}, which an air-gapped network cannot reach` +
        (optional > 0 ? `; ${plural(optional, 'other public dependency', 'other public dependencies')} will not work offline` : ''),
      remedy:
        `Make ${requiredOffline.map((dep) => dep.id).join(', ')} internal or replace it before going offline; ` +
        `see ${AIR_GAPPED_RUNBOOK}, section ${requiredOffline.map((dep) => `"${dep.id}"`).join(', ')}.`,
      data,
    };
  }

  return {
    status: 'warn',
    detail:
      `${plural(offline.length, 'public dependency', 'public dependencies')} will not work offline: ` +
      offline.map((dep) => `${dep.capability} (${hostsOf(dep)})`).join(', '),
    remedy: `Point them at internal hosts or switch them off; see ${AIR_GAPPED_RUNBOOK}.`,
    data,
  };
}

/**
 * `network` / `network.egress`: the deployment's outbound dependencies, graded
 * for air-gap readiness when the app's {@link DeploymentNetworkSource} says
 * `air-gapped` (`online` when none is bound). Provided by `DoctorModule.forRoot()`;
 * the inventory comes from the app's `EgressContributor`s.
 *
 * @stability experimental
 */
@Injectable()
export class NetworkEgressDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = NETWORK_EGRESS_CHECK_ID;
  readonly category = 'network';
  readonly label = 'Outbound dependencies (air-gap readiness)';
  readonly timeoutMs = 5_000;

  private readonly logger = new Logger(NetworkEgressDoctorCheck.name);

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly egress: EgressRegistry,
    @Optional() @Inject(DEPLOYMENT_NETWORK_SOURCE) private readonly source?: DeploymentNetworkSource,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /** The declared network: the bound source's, or `online`. */
  get network(): DeploymentNetwork {
    return this.source?.network === 'air-gapped' ? 'air-gapped' : 'online';
  }

  /** Read-only: every contributor's `describe()`, then {@link gradeEgress}. Never throws. */
  async run(): Promise<DoctorCheckOutcome> {
    const deps = await describeEgress(this.egress, (id, message) =>
      this.logger.warn(`Egress contributor "${id}" threw: ${message}`),
    );
    return gradeEgress(deps, this.network);
  }
}
