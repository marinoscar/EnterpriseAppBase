// =============================================================================
// Nodes: the `nodes` system-settings namespace's schemas (issue #865)
// =============================================================================
//
// The five schemas the namespace declaration of `@marinoscar/platform-api/nodes`
// (`NODES_SYSTEM_SETTINGS`) is built from: the stored value and its partial,
// the PUT and PATCH wire branches, and the GET response branch. Moved verbatim
// from the reference app's `common/schemas/settings.schema.ts`,
// `system-settings-wire.schemas.ts` and `system-settings-response.schemas.ts`,
// which re-export them. Every bound is unchanged, so the OpenAPI document of
// `/api/system-settings` is too. No `.default()` anywhere: the defaults are
// `DEFAULT_NODES_POLICY` of the jobs slice.
// =============================================================================

import { z } from 'zod';

/**
 * Worker-fleet policy (`nodes`), as stored.
 *
 * `staleHeartbeatSeconds` is when a node stops counting as healthy;
 * `offlineStaleMultiplier` how many stale intervals before it is declared
 * offline (a multiplier, not a second duration, so the two cannot contradict
 * each other); `offlineRetentionDays` how long an offline node's record is
 * kept. `jobSecretBrokerEnabled` is the trust-boundary switch: may a node be
 * handed a short-lived credential for the job it runs? Default false, and a
 * system setting rather than an environment variable, so the decision is made
 * where the fleet is managed.
 *
 * @stability stable
 */
export const systemNodesSchema = z.object({
  /** Seconds without a heartbeat before a node counts as stale. */
  staleHeartbeatSeconds: z.number().int().min(5).max(86400),
  /** Stale intervals before a node is declared offline. */
  offlineStaleMultiplier: z.number().int().min(1).max(100),
  /** Days an offline node's record is kept. */
  offlineRetentionDays: z.number().int().min(1).max(3650),
  /** Whether a node may be brokered a short-lived credential for its job. */
  jobSecretBrokerEnabled: z.boolean(),
});

/**
 * The stored `nodes` value.
 *
 * @stability stable
 */
export type SystemNodesValue = z.infer<typeof systemNodesSchema>;

/**
 * The stored partial of `nodes`: every field optional, every bound the stored
 * schema's.
 *
 * @stability stable
 */
export const systemNodesPatchSchema = z.object({
  /** Seconds before a node counts as stale. */
  staleHeartbeatSeconds: z.number().int().min(5).max(86400).optional(),
  /** Stale intervals before a node is offline. */
  offlineStaleMultiplier: z.number().int().min(1).max(100).optional(),
  /** Days an offline node's record is kept. */
  offlineRetentionDays: z.number().int().min(1).max(3650).optional(),
  /** Whether nodes may be brokered job credentials. */
  jobSecretBrokerEnabled: z.boolean().optional(),
});

/**
 * The `nodes` branch of the `PUT /api/system-settings` body. Optional in the
 * body: a PUT that omits it keeps the stored value.
 *
 * @stability stable
 */
export const nodesSettingsSchema = z.object({
  /** Seconds before a node counts as stale. */
  staleHeartbeatSeconds: z.number().int().min(5).max(86400),
  /** Stale intervals before a node is offline. */
  offlineStaleMultiplier: z.number().int().min(1).max(100),
  /** Days an offline node's record is kept. */
  offlineRetentionDays: z.number().int().min(1).max(3650),
  /** Whether nodes may be brokered job credentials. */
  jobSecretBrokerEnabled: z.boolean(),
});

/**
 * The `nodes` branch of the `PATCH /api/system-settings` body: optional at the
 * namespace level and field by field inside.
 *
 * @stability stable
 */
export const nodesSettingsPatchSchema = z.object({
  /** Seconds before a node counts as stale. */
  staleHeartbeatSeconds: z.number().int().min(5).max(86400).optional(),
  /** Stale intervals before a node is offline. */
  offlineStaleMultiplier: z.number().int().min(1).max(100).optional(),
  /** Days an offline node's record is kept. */
  offlineRetentionDays: z.number().int().min(1).max(3650).optional(),
  /** Whether nodes may be brokered job credentials. */
  jobSecretBrokerEnabled: z.boolean().optional(),
});

/**
 * The parsed `nodes` branch of a PATCH body, as the namespace's merge receives it.
 *
 * @stability stable
 */
export type NodesSettingsPatchInput = z.infer<typeof nodesSettingsPatchSchema>;

/**
 * The `nodes` branch of the `GET /api/system-settings` response (the OpenAPI
 * contract).
 *
 * @stability stable
 */
export const nodesResponseSchema = z.object({
  /** Seconds before a node counts as stale. */
  staleHeartbeatSeconds: z.number(),
  /** Stale intervals before a node is offline. */
  offlineStaleMultiplier: z.number(),
  /** Days an offline node's record is kept. */
  offlineRetentionDays: z.number(),
  /** Whether nodes may be brokered job credentials. */
  jobSecretBrokerEnabled: z.boolean(),
});
