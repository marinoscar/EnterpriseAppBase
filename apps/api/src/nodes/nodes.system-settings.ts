// =============================================================================
// System settings namespace `nodes` (issue #677; namespace #256, epic #254)
// =============================================================================
//
// A declaration file: pure data, imports only leaf modules. Registered by
// `settings/registry/system-settings.manifest.ts`. Recipe:
// `settings/registry/README.md`.
// =============================================================================

import type { z } from 'zod';
import {
  systemNodesPatchSchema,
  systemNodesSchema,
  type SystemNodesValue,
} from '../common/schemas/settings.schema';
import { nodesSettingsPatchSchema, nodesSettingsSchema } from '../settings/dto/system-settings-wire.schemas';
import { nodesResponseSchema } from '../settings/dto/system-settings-response.schemas';
import type { SystemSettingsNamespace } from '../settings/registry/system-settings-namespace';

const NODES_SYSTEM_DEFAULTS: SystemNodesValue = {
  staleHeartbeatSeconds: 90,
  offlineStaleMultiplier: 4,
  offlineRetentionDays: 30,
  // ⚠ OFF, AND THE DEFAULT IS THE POINT (#349, epic #345). A fresh
  // deployment does not hand its worker fleet credentials to its own
  // database because somebody registered a node; an administrator turns
  // this on deliberately, having decided that those machines are inside the
  // trust boundary. Fail-closed also means a settings row that cannot be
  // read degrades to "no credentials for anyone", which is the safe
  // direction — unlike the fleet's other three values, where degrading to
  // the shipped policy is the safe direction.
  jobSecretBrokerEnabled: false,
};

export const NODES_SYSTEM_SETTINGS = {
  key: 'nodes',
  description: 'Worker-fleet policy: when a node counts as stale or offline, how long offline nodes are kept, and whether nodes may be brokered job credentials.',
  storedSchema: systemNodesSchema,
  patchSchema: systemNodesPatchSchema,
  putSchema: nodesSettingsSchema,
  wirePatchSchema: nodesSettingsPatchSchema,
  responseSchema: nodesResponseSchema,
  defaults: NODES_SYSTEM_DEFAULTS,
  requiredOnPut: false,
  merge(current, patch) {
    return {
      staleHeartbeatSeconds: patch?.staleHeartbeatSeconds ?? current.staleHeartbeatSeconds,
      offlineStaleMultiplier: patch?.offlineStaleMultiplier ?? current.offlineStaleMultiplier,
      offlineRetentionDays: patch?.offlineRetentionDays ?? current.offlineRetentionDays,
      jobSecretBrokerEnabled: patch?.jobSecretBrokerEnabled ?? current.jobSecretBrokerEnabled,
    };
  },
} satisfies SystemSettingsNamespace<'nodes', SystemNodesValue, z.infer<typeof nodesSettingsPatchSchema>>;

declare module '../settings/registry/system-settings-namespace' {
  interface SystemSettingsNamespaces {
    /** Worker-fleet policy (#256, epic #254). REQUIRED for the reason `jobs` gives. */
    nodes: SystemNodesValue;
  }
  interface SystemSettingsNamespaceDeclarations {
    nodes: typeof NODES_SYSTEM_SETTINGS;
  }
}
