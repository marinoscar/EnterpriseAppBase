import type { AppMetricDef } from '@marinoscar/platform-api/otel-core';

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

export const ORGANIZATIONS_APP_METRICS = [
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
] as const satisfies readonly AppMetricDef[];
