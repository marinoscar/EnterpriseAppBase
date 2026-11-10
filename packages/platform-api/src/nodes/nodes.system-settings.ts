// =============================================================================
// System settings namespace `nodes` (issue #865; namespace #256, epic #254)
// =============================================================================
//
// A declaration file: pure data, imports only leaf modules (the schemas are
// `@marinoscar/platform-contract/nodes`'s). `NodesModule.forRoot()` registers
// it when the app has not (`ensureSystemSettingsNamespaces`); an app that pins
// the stored key order lists it in its own manifest instead. Moved from the
// reference app's `platform/jobs/nodes.system-settings.ts`.
// =============================================================================

import {
  nodesResponseSchema,
  nodesSettingsPatchSchema,
  nodesSettingsSchema,
  systemNodesPatchSchema,
  systemNodesSchema,
  type NodesSettingsPatchInput,
  type SystemNodesValue,
} from '@marinoscar/platform-contract/nodes';
import { DEFAULT_NODE_CREDENTIAL_DELIVERY, DEFAULT_NODES_POLICY } from '../jobs/index';
import type { SystemSettingsNamespace } from '../settings/index';

// The shipped values are `DEFAULT_NODES_POLICY` (the jobs slice's), so what
// `NodeLifecycleService` falls back on and what a fresh row is written with
// are one definition. The broker stays OFF (#349): an administrator turns it
// on deliberately, having decided the fleet is inside the trust boundary.
// Provider-credential delivery (#1083) is OFF for the same reason.
const NODES_SYSTEM_DEFAULTS: SystemNodesValue = {
  ...DEFAULT_NODES_POLICY,
  credentialDelivery: { ...DEFAULT_NODE_CREDENTIAL_DELIVERY, purposes: [] },
};

/**
 * The `nodes` PATCH merge, field by field: a field the patch names replaces
 * the stored one, an absent field is kept.
 *
 * @param current - the stored value.
 * @param patch - the PATCH body's `nodes` branch, when present.
 * @returns the merged value.
 *
 * @stability experimental
 */
export function mergeNodesSettings(current: SystemNodesValue, patch?: NodesSettingsPatchInput): SystemNodesValue {
  const merged: SystemNodesValue = {
    staleHeartbeatSeconds: patch?.staleHeartbeatSeconds ?? current.staleHeartbeatSeconds,
    offlineStaleMultiplier: patch?.offlineStaleMultiplier ?? current.offlineStaleMultiplier,
    offlineRetentionDays: patch?.offlineRetentionDays ?? current.offlineRetentionDays,
    jobSecretBrokerEnabled: patch?.jobSecretBrokerEnabled ?? current.jobSecretBrokerEnabled,
  };
  const delivery = mergeCredentialDelivery(current.credentialDelivery, patch?.credentialDelivery);
  if (delivery !== undefined) merged.credentialDelivery = delivery;
  return merged;
}

/**
 * The `credentialDelivery` branch's merge (#1083), field by field.
 *
 * ⚠ `epoch` IS SERVER-WRITTEN. The HTTP PATCH body cannot carry it (the wire
 * schema strips it); only server code calling `patchSettings` directly —
 * `POST /api/admin/nodes/credential-delivery/revoke-all` — passes one, and it
 * is accepted only when it ADVANCES the stored epoch, so a stale or replayed
 * write can never move it backwards.
 */
function mergeCredentialDelivery(
  current: SystemNodesValue['credentialDelivery'],
  patch: (NonNullable<NodesSettingsPatchInput['credentialDelivery']> & { epoch?: number }) | undefined,
): SystemNodesValue['credentialDelivery'] {
  if (current === undefined && patch === undefined) return undefined;
  const base = current ?? { ...DEFAULT_NODE_CREDENTIAL_DELIVERY, purposes: [] };
  const currentEpoch = base.epoch ?? 1;
  const epoch =
    typeof patch?.epoch === 'number' && Number.isInteger(patch.epoch) && patch.epoch > currentEpoch ? patch.epoch : currentEpoch;
  return {
    enabled: patch?.enabled ?? base.enabled,
    cacheTtlMinutes: patch?.cacheTtlMinutes ?? base.cacheTtlMinutes,
    purposes: [...(patch?.purposes ?? base.purposes)],
    epoch,
  };
}

/**
 * The `nodes` system-settings namespace (#256, epic #254): when a node counts
 * as stale or offline, how long offline nodes are kept, and whether nodes may
 * be brokered job credentials. Its defaults are `DEFAULT_NODES_POLICY`.
 * `NodesModule.forRoot()` registers it unless the app already did.
 *
 * @stability experimental
 */
export const NODES_SYSTEM_SETTINGS = {
  /** The namespace key (permanent). */
  key: 'nodes',
  /** What it holds. */
  description: 'Worker-fleet policy: when a node counts as stale or offline, how long offline nodes are kept, and whether nodes may be brokered job credentials.',
  /** The stored shape. */
  storedSchema: systemNodesSchema,
  /** The stored partial. */
  patchSchema: systemNodesPatchSchema,
  /** The PUT body's branch. */
  putSchema: nodesSettingsSchema,
  /** The PATCH body's branch. */
  wirePatchSchema: nodesSettingsPatchSchema,
  /** The GET response's branch. */
  responseSchema: nodesResponseSchema,
  /** `DEFAULT_NODES_POLICY`: the broker is off. */
  defaults: NODES_SYSTEM_DEFAULTS,
  /** Optional in a PUT body. */
  requiredOnPut: false,
  /** The PATCH merge (`mergeNodesSettings`). */
  merge: mergeNodesSettings,
} satisfies SystemSettingsNamespace<'nodes', SystemNodesValue, NodesSettingsPatchInput>;

declare module '../settings/index' {
  interface SystemSettingsNamespaces {
    /** Worker-fleet policy (#256, epic #254). REQUIRED for the reason `jobs` gives. */
    nodes: SystemNodesValue;
  }
  interface SystemSettingsNamespaceDeclarations {
    /** The `nodes` declaration. */
    nodes: typeof NODES_SYSTEM_SETTINGS;
  }
}
