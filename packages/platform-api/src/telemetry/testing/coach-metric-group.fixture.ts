// A coach-shaped app metric group (issue #703, PP-4.6): what EvoPath registers
// for its AI Coach, over the `app_*` tables of `APP_SAMPLE_METRIC_TAGS`, with the
// table names of EvoPath's `APP_METRIC_NAMES`, expressed with the platform's own
// family kinds, filters and units. It is the evidence behind the adoption
// claim "EvoPath's coach group is a new extension, not a platform change": the
// readiness test (`../metrics/coach-readiness.spec.ts`) runs it through the
// conformance checks and the renderer with no platform edit. Also used by the
// registry tests and the reference app's extension-points integration test.

import type { MetricGroupDef, MetricGroup } from '../metrics/metric-group.registry';
import { APP_FILTERS } from '../metrics/metric-catalog.helpers';

/**
 * The id of {@link COACH_METRIC_GROUP}.
 *
 * @stability experimental
 */
export const COACH_METRIC_GROUP_ID = 'coach' as MetricGroup;

/**
 * A sample app metric group shaped like EvoPath's AI Coach: nudges sent,
 * suppressed and opened and audio generated and failed (counters), the
 * health-summary p95 (a histogram), and two ratios, all filtered by service
 * and instance.
 *
 * @stability experimental
 */
export const COACH_METRIC_GROUP: MetricGroupDef = {
  id: COACH_METRIC_GROUP_ID,
  label: 'Coach',
  title: 'AI Coach',
  order: 70,
  description: 'AI Coach nudges, audio and health-summary latency',
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
      key: 'coachNudgesSuppressed',
      group: COACH_METRIC_GROUP_ID,
      label: 'Nudges suppressed',
      table: 'app_coach_nudge_suppressed_total',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      groupBy: 'reason',
      requiredColumns: ['reason'],
      filters: APP_FILTERS,
    },
    {
      key: 'coachNudgesOpened',
      group: COACH_METRIC_GROUP_ID,
      label: 'Nudges opened',
      table: 'app_coach_nudge_opened_total',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      groupBy: 'channel',
      requiredColumns: ['channel'],
      filters: APP_FILTERS,
    },
    {
      key: 'coachAudioGenerated',
      group: COACH_METRIC_GROUP_ID,
      label: 'Audio generated',
      table: 'app_coach_audio_generated_total',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      requiredColumns: [],
      filters: APP_FILTERS,
    },
    {
      key: 'coachAudioFailed',
      group: COACH_METRIC_GROUP_ID,
      label: 'Audio failed',
      table: 'app_coach_audio_failed_total',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      groupBy: 'reason',
      requiredColumns: ['reason'],
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
  ratios: [
    {
      key: 'coachNudgeOpenRate',
      group: COACH_METRIC_GROUP_ID,
      label: 'Nudge open rate',
      unit: '%',
      numerator: [{ family: 'coachNudgesOpened' }],
      denominator: [{ family: 'coachNudgesSent' }],
      scale: 100,
    },
    {
      key: 'coachAudioFailureRatio',
      group: COACH_METRIC_GROUP_ID,
      label: 'Audio failure ratio',
      unit: '%',
      numerator: [{ family: 'coachAudioFailed' }],
      denominator: [{ family: 'coachAudioGenerated' }],
      addNumerator: true,
      scale: 100,
    },
  ],
};
