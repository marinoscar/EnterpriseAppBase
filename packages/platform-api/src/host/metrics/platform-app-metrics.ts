import type { AppMetricAttribute, AppMetricDef } from '../../otel-core/index';
import { DB_BACKUP_APP_METRICS } from '../../db-backup/index';
import { NODES_APP_METRICS } from '../../nodes/index';

// =============================================================================
// The platform's `app.*` metrics (issue #680)
// =============================================================================
//
// Pure data, registered by `registerPlatformHostAppMetrics()` (./register.ts;
// moved from the reference app by #867). Exactly the names, units,
// descriptions and bucket boundaries the API exported before the registry
// (pinned by `app-metrics.service.spec.ts` and
// `nodes/node-fleet-metrics.service.spec.ts`): a name or unit is the GreptimeDB
// table name, so changing one orphans every dashboard query that reads it.
//
// The declared `attributes` are the label keys each typed method of
// `AppMetricsService` emits (and what the generic `add`/`record` would admit
// for the metric). Gauges declare theirs for documentation: their callbacks
// bound their own labels.
// =============================================================================

// ---- Histogram buckets, in the instrument's unit -----------------------------

export const JOB_DURATION_BUCKETS_S = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600, 1800, 3600] as const;
export const AI_DURATION_BUCKETS_S = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300] as const;

// ---- Enumerated attribute values (the typed methods check against these) ----

export const JOB_EXECUTOR_VALUES = ['server', 'node'] as const;
/** `JobSettleOutcome` values, mirrored so this file does not import the queue. */
export const JOB_SETTLE_OUTCOME_VALUES = [
  'succeeded',
  'failed',
  'retry-scheduled',
  'rate-limit-deferred',
  'claim-lost',
  'write-failed',
] as const;
export const JOB_REAP_OUTCOME_VALUES = ['requeued', 'failed'] as const;
/** The queue statuses the depth gauge reports (terminal rows are history, not depth). */
export const JOB_DEPTH_STATUS_VALUES = ['pending', 'running'] as const;
export const BACKUP_OUTCOME_VALUES = ['completed', 'failed'] as const;
// `no_organization` (PP-6.2, #722): a multi-org sign-in refused for having no
// active membership. Never an org id: org goes on spans and logs, not labels.
export const AUTH_LOGIN_OUTCOME_VALUES = ['success', 'allowlist_rejected', 'disabled', 'no_organization'] as const;
export const AUTH_REFRESH_OUTCOME_VALUES = [
  'success',
  'invalid',
  'reuse_detected',
  'expired',
  'user_inactive',
  'device_revoked',
  // PP-6.4 (#724): the refresh token's organization membership is no longer
  // active (removed or suspended). Never the org id itself.
  'no_organization',
] as const;
export const AI_STATUS_VALUES = ['succeeded', 'failed', 'cancelled'] as const;
export const NOTIFICATION_OUTCOME_VALUES = ['sent', 'failed', 'rate_limited', 'error'] as const;

const free: AppMetricAttribute = { kind: 'free' };
const oneOf = (...values: string[]): AppMetricAttribute => ({ kind: 'enum', values });

const JOB_SETTLED_ATTRIBUTES = {
  job_type: free,
  outcome: oneOf(...JOB_SETTLE_OUTCOME_VALUES),
  // `unknown` when the executor is not recorded.
  executor: oneOf(...JOB_EXECUTOR_VALUES, 'unknown'),
};
const AI_REQUEST_ATTRIBUTES = {
  provider: free,
  model: free,
  operation: free,
  status: oneOf(...AI_STATUS_VALUES),
  key_source: free,
  // #739: the registered AI feature (`registerAiFeature`), bounded by that
  // registry; `none` for a call that named no feature.
  feature: free,
};

/**
 * The platform's `app.*` metrics: the queue, backups, sign-in, AI,
 * notifications and the node fleet, in declaration order. Registered (with the
 * event bus's three) by {@link registerPlatformHostAppMetrics}.
 *
 * @stability experimental
 */
export const PLATFORM_APP_METRICS = [
  // ---- Jobs ----
  {
    key: 'jobsEnqueued',
    name: 'app.jobs.enqueued',
    kind: 'counter',
    unit: '{job}',
    description: 'Jobs inserted into the queue (dedup hits excluded).',
    attributes: { job_type: free },
  },
  {
    key: 'jobsClaimed',
    name: 'app.jobs.claimed',
    kind: 'counter',
    unit: '{job}',
    description: 'Jobs claimed by an executor.',
    attributes: { job_type: free, executor: oneOf(...JOB_EXECUTOR_VALUES) },
  },
  {
    key: 'jobsSettled',
    name: 'app.jobs.settled',
    kind: 'counter',
    unit: '{job}',
    description: 'Executor reports settled by the terminal state machine, by outcome.',
    attributes: JOB_SETTLED_ATTRIBUTES,
  },
  {
    key: 'jobsDuration',
    name: 'app.jobs.duration',
    kind: 'histogram',
    unit: 's',
    description: 'Run time of one job attempt, from claim to settlement.',
    buckets: JOB_DURATION_BUCKETS_S,
    attributes: JOB_SETTLED_ATTRIBUTES,
  },
  {
    key: 'jobsReaped',
    name: 'app.jobs.reaped',
    kind: 'counter',
    unit: '{job}',
    description: 'Abandoned running jobs recovered by the lease reaper.',
    attributes: { outcome: oneOf(...JOB_REAP_OUTCOME_VALUES), job_type: free },
  },
  {
    key: 'jobsQueueDepth',
    name: 'app.jobs.queue.depth',
    kind: 'gauge',
    unit: '{job}',
    description: 'Jobs currently pending or running, by type and status.',
    attributes: { job_type: free, status: oneOf(...JOB_DEPTH_STATUS_VALUES) },
  },
  {
    key: 'jobsOldestPendingAge',
    name: 'app.jobs.oldest_pending.age',
    kind: 'gauge',
    unit: 's',
    description: 'Age of the oldest runnable pending job, by type.',
    attributes: { job_type: free },
  },

  // ---- Database backup (declared by the db-backup slice since #740) ----
  ...DB_BACKUP_APP_METRICS,

  // ---- Auth ----
  {
    key: 'authLogins',
    name: 'app.auth.logins',
    kind: 'counter',
    unit: '{login}',
    description: 'Interactive sign-in attempts, by provider and outcome.',
    attributes: { provider: free, outcome: oneOf(...AUTH_LOGIN_OUTCOME_VALUES) },
  },
  {
    key: 'authRefreshes',
    name: 'app.auth.refreshes',
    kind: 'counter',
    unit: '{refresh}',
    description: 'Refresh-token rotations, by outcome.',
    attributes: { outcome: oneOf(...AUTH_REFRESH_OUTCOME_VALUES) },
  },

  // ---- AI ----
  {
    key: 'aiRequests',
    name: 'app.ai.requests',
    kind: 'counter',
    unit: '{request}',
    description: 'AI provider round-trips, by provider, model, operation and status.',
    attributes: AI_REQUEST_ATTRIBUTES,
  },
  {
    key: 'aiTokens',
    name: 'app.ai.tokens',
    kind: 'counter',
    unit: '{token}',
    description: 'AI tokens reported by the provider, by token_type (input|output).',
    attributes: { provider: free, model: free, operation: free, token_type: oneOf('input', 'output') },
  },
  {
    key: 'aiDuration',
    name: 'app.ai.request.duration',
    kind: 'histogram',
    unit: 's',
    description: 'Latency of one AI provider round-trip.',
    buckets: AI_DURATION_BUCKETS_S,
    attributes: AI_REQUEST_ATTRIBUTES,
  },

  // ---- Notifications ----
  {
    key: 'notificationDeliveries',
    name: 'app.notifications.deliveries',
    kind: 'counter',
    unit: '{delivery}',
    description: 'Notification delivery attempts, by channel, event and outcome.',
    attributes: { channel: free, event: free, outcome: oneOf(...NOTIFICATION_OUTCOME_VALUES) },
  },

  // ---- Worker-node fleet gauges (#606) ----
  // Declared by the nodes slice (`@marinoscar/platform-api/nodes`, #734),
  // which creates them (`NodeFleetMetrics`); spread here so the order and
  // the `PlatformAppMetricKey` union are unchanged.
  ...NODES_APP_METRICS,
] as const satisfies readonly AppMetricDef[];

/**
 * A platform metric's code key.
 *
 * @stability experimental
 */
export type PlatformAppMetricKey = (typeof PLATFORM_APP_METRICS)[number]['key'];
