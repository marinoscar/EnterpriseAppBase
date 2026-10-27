// The user-data slice's metrics (issue #743, PP-9.1). Counters by scope and
// outcome only: a user id or an organization id is NEVER a label (it would be
// an unbounded series and personal data); the job span carries the org id.

import type { AppMetricDef } from '../otel-core/index';

/**
 * The `outcome` label of the three counters.
 *
 * @stability experimental
 */
export const USER_DATA_METRIC_OUTCOMES = ['succeeded', 'failed'] as const;

/**
 * The code key of `app.user_data.purges`.
 *
 * @stability experimental
 */
export const USER_DATA_PURGES_METRIC = 'userDataPurges';

/**
 * The code key of `app.factory_reset.runs`.
 *
 * @stability experimental
 */
export const FACTORY_RESET_RUNS_METRIC = 'factoryResetRuns';

/**
 * The code key of `app.org.offboardings`.
 *
 * @stability experimental
 */
export const ORG_OFFBOARDINGS_METRIC = 'orgOffboardings';

/**
 * The slice's metric declarations. Register them with the app's metric-name
 * registry before the metrics host creates instruments.
 *
 * @stability experimental
 * @example
 * ```ts
 * registerAppMetrics(USER_DATA_APP_METRICS);
 * ```
 */
export const USER_DATA_APP_METRICS: readonly AppMetricDef[] = [
  {
    key: USER_DATA_PURGES_METRIC,
    name: 'app.user_data.purges',
    kind: 'counter',
    unit: '{purge}',
    description: 'Finished per-user data deletions, by scope and outcome.',
    attributes: { scope: { kind: 'free' }, outcome: { kind: 'enum', values: USER_DATA_METRIC_OUTCOMES } },
  },
  {
    key: FACTORY_RESET_RUNS_METRIC,
    name: 'app.factory_reset.runs',
    kind: 'counter',
    unit: '{run}',
    description: 'Finished factory resets, by outcome.',
    attributes: { outcome: { kind: 'enum', values: USER_DATA_METRIC_OUTCOMES } },
  },
  {
    key: ORG_OFFBOARDINGS_METRIC,
    name: 'app.org.offboardings',
    kind: 'counter',
    unit: '{offboarding}',
    description: 'Finished organization offboardings, by outcome and user disposition.',
    attributes: {
      outcome: { kind: 'enum', values: USER_DATA_METRIC_OUTCOMES },
      user_disposition: { kind: 'enum', values: ['keep', 'purge'] },
    },
  },
];

/**
 * The audit actions the slice records. Events carry ids and counts, never
 * row contents.
 *
 * @stability experimental
 */
export const USER_DATA_AUDIT_ACTIONS: {
  /** A user asked for a deletion (API). */
  readonly PURGE_REQUESTED: 'user_data.purge.requested';
  /** The deletion job finished (job). */
  readonly PURGE_COMPLETED: 'user_data.purge.completed';
  /** An administrator asked for a factory reset (API). */
  readonly FACTORY_RESET_REQUESTED: 'admin.factory_reset.requested';
  /** The factory reset finished (job). */
  readonly FACTORY_RESET_COMPLETED: 'admin.factory_reset.completed';
  /** An administrator asked to offboard an organization (API). */
  readonly OFFBOARD_REQUESTED: 'org.offboard.requested';
  /** The offboarding finished (job). */
  readonly OFFBOARD_COMPLETED: 'org.offboard.completed';
} = {
  PURGE_REQUESTED: 'user_data.purge.requested',
  PURGE_COMPLETED: 'user_data.purge.completed',
  FACTORY_RESET_REQUESTED: 'admin.factory_reset.requested',
  FACTORY_RESET_COMPLETED: 'admin.factory_reset.completed',
  OFFBOARD_REQUESTED: 'org.offboard.requested',
  OFFBOARD_COMPLETED: 'org.offboard.completed',
};
