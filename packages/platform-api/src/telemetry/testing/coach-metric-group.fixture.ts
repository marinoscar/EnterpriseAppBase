// A coach-shaped app metric group (issue #703): what EvoPath registers for its
// AI Coach, over the `app_*` tables of `APP_SAMPLE_METRIC_TAGS`, expressed with
// the platform's own family kinds, filters and units. Used by the registry
// tests and the app's extension-points integration test.

import type { MetricGroupDef, MetricGroup } from '../metrics/metric-group.registry';
import { APP_FILTERS } from '../metrics/metric-catalog.helpers';

/**
 * The id of {@link COACH_METRIC_GROUP}.
 *
 * @stability experimental
 */
export const COACH_METRIC_GROUP_ID = 'coach' as MetricGroup;

/**
 * A sample app metric group: nudges sent (a counter) and the health-summary
 * p95 (a histogram), both filtered by service and instance.
 *
 * @stability experimental
 */
export const COACH_METRIC_GROUP: MetricGroupDef = {
  id: COACH_METRIC_GROUP_ID,
  label: 'Coach',
  title: 'AI Coach',
  order: 70,
  description: 'AI Coach nudges sent and health-summary latency',
  families: [
    {
      key: 'coachNudgesSent',
      group: COACH_METRIC_GROUP_ID,
      label: 'Nudges sent',
      table: 'app_coach_nudge_sent_total',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      groupBy: 'channel',
      requiredColumns: ['channel'],
      filters: APP_FILTERS,
    },
    {
      key: 'healthSummaryP95',
      group: COACH_METRIC_GROUP_ID,
      label: 'Health summary p95',
      table: 'app_health_summary_duration_seconds_bucket',
      kind: 'histogram',
      unit: 'ms',
      quantile: 0.95,
      scale: 1000,
      requiredColumns: ['le'],
      filters: APP_FILTERS,
    },
  ],
};
