import type { AppMetricDef } from '../../otel-core/index';

// =============================================================================
// Organization administration metrics (issue #726, PP-6.7)
// =============================================================================
//
// Two counters, declared in the app-metric registry like every other `app.*`
// instrument (registered by `common/otel/app-metric.manifest.ts`) and emitted
// through `AppMetricsService.add`. Exported to Prometheus as
// `app_org_invites_created_total` and `app_org_members_removed_total`.
//
// NO ATTRIBUTES, DELIBERATELY. An org id on a metric label is unbounded
// cardinality and a tenant identifier in a shared metrics store (ADR 0001:
// the org goes on the SPAN, `org.id`, never on a metric label). The role is
// not a label either: these count administrative actions, not a breakdown.
// =============================================================================

/**
 * An app-metric declaration with its literal key.
 *
 * @typeParam Key - the metric's code key.
 *
 * @stability stable
 */
export interface IdentityAppMetricDef<Key extends string> extends AppMetricDef {
  /** The metric's code key. */
  readonly key: Key;
}

/**
 * The two organization-administration counters, as app-metric declarations the
 * app registers with its metric registry (`registerAppMetrics`). No attributes:
 * an org id on a metric label is unbounded cardinality and a tenant identifier.
 *
 * @stability stable
 */
export const ORGANIZATIONS_APP_METRICS: readonly [
  IdentityAppMetricDef<'orgInvitesCreated'>,
  IdentityAppMetricDef<'orgMembersRemoved'>,
] = [
  {
    key: 'orgInvitesCreated',
    name: 'app.org.invites_created',
    kind: 'counter',
    unit: '{invite}',
    description: 'Organization invitations created or renewed (an organization creation\'s first-admin invitation included).',
  },
  {
    key: 'orgMembersRemoved',
    name: 'app.org.members_removed',
    kind: 'counter',
    unit: '{member}',
    description: 'Members removed from an organization by an organization administrator.',
  },
];
