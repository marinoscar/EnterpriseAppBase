// =============================================================================
// The queue's and the fleet's runtime policies, as the slices read them
// (issue #734)
// =============================================================================
//
// Both live in the deployment-wide settings document, in the `jobs` and
// `nodes` namespaces, and are read through the settings slice's narrow
// accessors (`SystemSettingsService.getJobsPolicy()` / `getNodesPolicy()`),
// which never create the row. The namespaces themselves (schemas, merge,
// defaults) are the slices' own declarations since #865
// (`JOBS_SYSTEM_SETTINGS` in ./jobs.system-settings.ts, `NODES_SYSTEM_SETTINGS`
// in ../nodes/nodes.system-settings.ts), registered by `JobsModule.forRoot()`
// and `NodesModule.forRoot()` unless the app's manifest already did; their
// defaults are the two constants below, so the shipped numbers live in
// exactly one place.
//
// The accessors return whatever the stored row holds; every reader below
// validates field by field and falls back on these defaults.
// =============================================================================

/**
 * The `jobs` settings namespace: job history retention and the stuck
 * threshold.
 *
 * @stability stable
 */
export interface JobsPolicy {
  /** Finished-job history. */
  history: {
    /** Days a finished job is kept before the purge removes it. */
    retentionDays: number;
    /** Whether the nightly purge runs at all. */
    purgeEnabled: boolean;
  };
  /** Minutes a claimed job may go without progress before the reaper treats it as abandoned. */
  stuckThresholdMinutes: number;
}

/**
 * The `nodes` settings namespace: the fleet's health windows and the
 * credential-broker switch.
 *
 * @stability stable
 */
export interface NodesPolicy {
  /** Seconds without a heartbeat before a node counts as stale. */
  staleHeartbeatSeconds: number;
  /** Stale intervals before a node is declared offline. */
  offlineStaleMultiplier: number;
  /** Days an offline node's record is kept. */
  offlineRetentionDays: number;
  /** Whether a node may be handed a short-lived credential for its job. Fail-closed: only `true` enables it. */
  jobSecretBrokerEnabled: boolean;
}

/**
 * The shipped `jobs` policy.
 *
 * @stability stable
 */
export const DEFAULT_JOBS_POLICY: Readonly<JobsPolicy> = Object.freeze({
  history: Object.freeze({ retentionDays: 30, purgeEnabled: true }),
  stuckThresholdMinutes: 30,
});

/**
 * The shipped `nodes` policy. The broker is OFF: an administrator turns it on
 * deliberately, having decided the fleet is inside the trust boundary.
 *
 * @stability stable
 */
export const DEFAULT_NODES_POLICY: Readonly<NodesPolicy> = Object.freeze({
  staleHeartbeatSeconds: 90,
  offlineStaleMultiplier: 4,
  offlineRetentionDays: 30,
  jobSecretBrokerEnabled: false,
});
