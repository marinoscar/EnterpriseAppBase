import type { AppMetricDef } from '../otel-core/index';

// =============================================================================
// Sharing metrics (issues #728 and #729)
// =============================================================================
//
// Two counters, declared for the app's metric-name registry (the reference app
// registers them in `common/otel/app-metric.manifest.ts`) and emitted through
// `MetricsHostService.add`. Exported to Prometheus as
// `app_sharing_group_mutations_total` and `app_sharing_access_decisions_total`.
//
// BOUNDED LABELS ONLY: `op` from a closed list; `resource_type` (bounded by
// the resource-type registry), `outcome` and `via` from closed lists. Never the
// organization (an org id on a metric label is unbounded cardinality and a
// tenant identifier in a shared store; it goes on the span as `org.id`), never
// a group, user or record id.
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
 * The `outcome` label of `app.sharing.access_decisions` (#729).
 *
 * @stability experimental
 */
export const SHARING_DECISION_OUTCOMES = ['allowed', 'denied'] as const;

/**
 * The `via` label of `app.sharing.access_decisions`: what decided it, or
 * `none` for a denial (#729).
 *
 * @stability experimental
 */
export const SHARING_DECISION_VIAS = ['owner', 'group_owner', 'user_grant', 'group_grant', 'org_default', 'bypass', 'none'] as const;

/**
 * The code key of the access-decision counter, for `MetricsHostService.add`.
 *
 * @stability experimental
 */
export const SHARING_ACCESS_DECISIONS_METRIC = 'sharingAccessDecisions';

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
  {
    key: SHARING_ACCESS_DECISIONS_METRIC,
    name: 'app.sharing.access_decisions',
    kind: 'counter',
    unit: '{decision}',
    description: 'AccessPolicy decisions on shareable records, by resource type, outcome and what decided them.',
    // resource_type is bounded by the resource-type registry (only registered
    // types reach a decision); never the organization or a record id.
    attributes: {
      resource_type: { kind: 'free' },
      outcome: { kind: 'enum', values: SHARING_DECISION_OUTCOMES },
      via: { kind: 'enum', values: SHARING_DECISION_VIAS },
    },
  },
];
