// =============================================================================
// Doctor check `nodes.credential_delivery` (issue #1083)
// =============================================================================
//
// READ-ONLY (docs/specs/doctor.md rule 3): reads the `nodes` policy, the
// purpose registry and the fleet view, and asks the delivery service for the
// system-scope state (which resolves, i.e. reads and decrypts, each purpose's
// deployment credential to hash its version; it writes nothing and returns no
// material).
//
//   - skip  when delivery is disabled (the shipped default);
//   - warn  whenever it is enabled: provider keys leave the server, which is a
//           risk posture an operator should see on every Doctor run;
//   - fail  when it is enabled and an allowlisted purpose is not registered or
//           has no deployment credential that resolves.
// =============================================================================

import { Injectable, OnModuleInit } from '@nestjs/common';

import { DoctorCheck, DoctorCheckOutcome, DoctorCheckRegistry } from '../../doctor/index';
import { nodeCredentialPurposeRegistry, type NodeCredentialDeliveryPolicy } from '../../jobs/index';
import { NodeCredentialDeliveryService } from '../node-credential-delivery.service';
import { NodesAdminService } from '../nodes-admin.service';
import { NODES_SETTINGS_PATH } from './nodes-fleet.doctor-check';

/**
 * Pure: the verdict from the policy, which allowlisted purposes are
 * registered, which have a system-scope version, and how many nodes are online.
 *
 * Note an allowlisted purpose that serves only ORGANIZATION keys has no
 * system-scope version; it is reported as a failure here because the Doctor
 * cannot see per-organization keys. Configure a deployment key or ignore the
 * line for an organization-only purpose.
 *
 * @param policy - the delivery policy.
 * @param registered - the allowlisted purposes that are registered.
 * @param resolvable - the purposes whose deployment credential resolves.
 * @param onlineNodes - nodes whose status is `online`.
 * @returns the outcome.
 *
 * @stability experimental
 */
export function decideCredentialDelivery(
  policy: NodeCredentialDeliveryPolicy,
  registered: readonly string[],
  resolvable: readonly string[],
  onlineNodes: number,
): DoctorCheckOutcome {
  const data = {
    enabled: policy.enabled,
    purposes: policy.purposes.length,
    ttlMinutes: policy.cacheTtlMinutes,
    epoch: policy.epoch,
    onlineNodes,
  };

  if (!policy.enabled) {
    return { status: 'skip', detail: 'Provider-credential delivery to worker nodes is off (the default); provider keys stay on the server', data };
  }

  const unregistered = policy.purposes.filter((id) => !registered.includes(id));
  const unresolved = registered.filter((id) => !resolvable.includes(id));

  if (unregistered.length > 0 || unresolved.length > 0) {
    const parts = [
      ...unregistered.map((id) => `${id} (not registered)`),
      ...unresolved.map((id) => `${id} (no deployment credential resolves)`),
    ];
    return {
      status: 'fail',
      detail: `Credential delivery is on, but allowlisted purpose(s) cannot be delivered: ${parts.join(', ')}`,
      remedy:
        `Configure the credential for each purpose, or remove it from nodes.credentialDelivery.purposes at ${NODES_SETTINGS_PATH}. ` +
        'Jobs needing an undeliverable purpose fail on nodes until then.',
      data,
    };
  }

  return {
    status: 'warn',
    detail:
      `Provider credentials are delivered to worker nodes for ${policy.purposes.length ? policy.purposes.join(', ') : 'no purpose yet'}; ` +
      `cached on nodes for up to ${policy.cacheTtlMinutes} min (epoch ${policy.epoch}, ${onlineNodes} node(s) online)`,
    remedy:
      'Anyone with root on a node host can read a delivered key. Enable this only for nodes you own; ' +
      `revoke every cached key from ${NODES_SETTINGS_PATH}, and rotate the key at the provider to revoke it for real.`,
    data,
  };
}

/** `nodes` / `nodes.credential_delivery` — whether provider keys leave the server. */
@Injectable()
export class NodesCredentialDeliveryDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'nodes.credential_delivery';
  readonly category = 'nodes';
  readonly label = 'Worker node credential delivery';
  readonly settingsPath = NODES_SETTINGS_PATH;
  readonly dependsOn = ['db.connection'];

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly delivery: NodeCredentialDeliveryService,
    private readonly nodesAdmin: NodesAdminService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    const policy = await this.delivery.policy();
    if (!policy.enabled) return decideCredentialDelivery(policy, [], [], 0);

    const state = await this.delivery.deliveryState();
    const registered = policy.purposes.filter((id) => nodeCredentialPurposeRegistry.get(id) !== undefined);
    const fleet = await this.nodesAdmin.listFleet();
    return decideCredentialDelivery(policy, registered, Object.keys(state.versions), fleet.filter((node) => node.status === 'online').length);
  }
}
