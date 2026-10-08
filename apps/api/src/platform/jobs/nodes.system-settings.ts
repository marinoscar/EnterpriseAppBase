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
} from '../../common/schemas/settings.schema';
import { nodesSettingsPatchSchema, nodesSettingsSchema } from '../../common/schemas/system-settings-wire.schemas';
import { nodesResponseSchema } from '../../common/schemas/system-settings-response.schemas';
import type { SystemSettingsNamespace } from '@marinoscar/platform-api/settings';
import { DEFAULT_NODES_POLICY } from '@marinoscar/platform-api/jobs';

// The shipped values are the jobs slice's (`DEFAULT_NODES_POLICY`, #734): the
// numbers `NodeLifecycleService` falls back on and a fresh row's are one
// definition. The broker stays OFF by default (#349): an administrator turns it
// on deliberately, having decided the fleet is inside the trust boundary.
const NODES_SYSTEM_DEFAULTS: SystemNodesValue = { ...DEFAULT_NODES_POLICY };

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

declare module '@marinoscar/platform-api/settings' {
  interface SystemSettingsNamespaces {
    /** Worker-fleet policy (#256, epic #254). REQUIRED for the reason `jobs` gives. */
    nodes: SystemNodesValue;
  }
  interface SystemSettingsNamespaceDeclarations {
    nodes: typeof NODES_SYSTEM_SETTINGS;
  }
}
