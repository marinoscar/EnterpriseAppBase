import { ALERT_KIND_IDS, metricThresholdConfigSchema, type AlertObservation, type MetricThresholdConfig } from '@marinoscar/platform-contract/alerts';

import type { AlertRuleKind, AlertRuleView } from '../alerts.types';
import { buildMetricThresholdSql, compareValue, resolveMetricTable } from './metric-threshold.sql';

/** Most label sets one evaluation reads. */
const MAX_GROUPS = 200;

const SYMBOL: Record<MetricThresholdConfig['comparator'], string> = {
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  eq: '=',
  neq: '!=',
};

function describeConfig(config: MetricThresholdConfig): string {
  return `${config.aggregation}(${config.metric}) over ${config.windowSeconds}s ${SYMBOL[config.comparator]} ${config.threshold}`;
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * `metric_threshold`: one aggregate of one telemetry metric over a window,
 * compared to a threshold, per group. Runs ONE statement through the guarded
 * telemetry facade; an unreachable store throws `AlertStoreUnavailableError`.
 *
 * @stability experimental
 */
export const metricThresholdKind: AlertRuleKind<MetricThresholdConfig> = {
  id: ALERT_KIND_IDS.METRIC_THRESHOLD,
  label: 'Metric threshold',
  description: 'An aggregate of one telemetry metric over a time window compared to a threshold, per group.',
  configSchema: metricThresholdConfigSchema,
  async evaluate(ctx, rule: AlertRuleView<MetricThresholdConfig>): Promise<AlertObservation[]> {
    const { config } = rule;
    const telemetry = await ctx.telemetry();
    const table = resolveMetricTable(config.metric, telemetry.tables);
    if (!table) throw new Error(`The telemetry store has no table for the metric "${config.metric}" (yet).`);

    const sql = buildMetricThresholdSql(config, table, telemetry.query, ctx.now);
    const result = await telemetry.query.query(sql, { maxRows: MAX_GROUPS });
    const groupBy = config.groupBy ?? [];

    return result.rows.map((row): AlertObservation => {
      const labels: Record<string, string> = {};
      groupBy.forEach((column, index) => {
        const raw = row[index];
        labels[column] = raw === null || raw === undefined ? '' : String(raw);
      });
      const raw = row[groupBy.length];
      const value = raw === null || raw === undefined ? Number.NaN : Number(raw);
      const known = Number.isFinite(value);
      const where = Object.keys(labels).length > 0 ? ` for ${Object.entries(labels).map(([k, v]) => `${k}=${v}`).join(', ')}` : '';
      return {
        labels,
        value: known ? value : null,
        breached: known && compareValue(value, config.comparator, config.threshold),
        summary: `${rule.name}: ${config.aggregation} of ${config.metric} is ${known ? formatValue(value) : 'unknown'}${where} (${SYMBOL[config.comparator]} ${config.threshold})`.slice(0, 500),
      };
    });
  },
  describe: (rule) => describeConfig(rule.config),
};
