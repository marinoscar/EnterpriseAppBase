import type { AppMetricDef } from '../otel-core/index';

// =============================================================================
// Sharing metrics (issue #728, PP-7.1)
// =============================================================================
//
// One counter, declared for the app's metric-name registry (the reference app
// registers it in `common/otel/app-metric.manifest.ts`) and emitted through
// `MetricsHostService.add`. Exported to Prometheus as
// `app_sharing_group_mutations_total`.
//
// ONE LABEL, `op`, from a closed list. Never the organization (an org id on a
// metric label is unbounded cardinality and a tenant identifier in a shared
// store; it goes on the span as `org.id`), never a group or user id.
// =============================================================================

/**
 * Every value of the `op` label of `app.sharing.group_mutations`.
 *
 * @stability experimental
 */
export const SHARING_MUTATION_OPS = [
  'group_create',
  'group_update',
  'group_delete',
  'member_add',
  'member_remove',
  'member_role_change',
  'invite_create',
  'invite_revoke',
  'invite_accept',
  'invite_decline',
] as const;

/**
 * One of {@link SHARING_MUTATION_OPS}.
 *
 * @stability experimental
 */
export type SharingMutationOp = (typeof SHARING_MUTATION_OPS)[number];

/**
 * The code key of the counter, for `MetricsHostService.add`.
 *
 * @stability experimental
 */
export const SHARING_GROUP_MUTATIONS_METRIC = 'sharingGroupMutations';

/**
 * The slice's metric declarations. Register them with the app's metric-name
 * registry before the metrics host creates instruments.
 *
 * @example
 * ```ts
 * registerAppMetrics(SHARING_APP_METRICS);
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const SHARING_APP_METRICS: readonly AppMetricDef[] = [
  {
    key: SHARING_GROUP_MUTATIONS_METRIC,
    name: 'app.sharing.group_mutations',
    kind: 'counter',
    unit: '{mutation}',
    description: 'Committed changes to groups, their members and their invites, by operation.',
    attributes: { op: { kind: 'enum', values: SHARING_MUTATION_OPS } },
  },
];
