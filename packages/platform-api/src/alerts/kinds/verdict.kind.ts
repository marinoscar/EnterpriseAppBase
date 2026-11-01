import {
  ALERT_KIND_IDS,
  emptyAlertConfigSchema,
  verdictConfigSchema,
  type AlertObservation,
  type VerdictConfig,
} from '@marinoscar/platform-contract/alerts';

import type { AlertRuleKind } from '../alerts.types';

const RANK: Record<string, number> = { degraded: 1, critical: 2 };

/**
 * `verdict`: the telemetry dashboard verdict is at or past a level. Computed
 * in-process by the dashboard's own service, so it can never disagree with the
 * banner an administrator sees. `no_data` and `healthy` never breach.
 *
 * @stability experimental
 */
export const verdictKind: AlertRuleKind<VerdictConfig> = {
  id: ALERT_KIND_IDS.VERDICT,
  label: 'Dashboard verdict',
  description: 'The telemetry dashboard verdict is degraded or critical.',
  configSchema: verdictConfigSchema,
  async evaluate(ctx, rule): Promise<AlertObservation[]> {
    const verdict = await ctx.verdict();
    const breached = (RANK[verdict.level] ?? 0) >= RANK[rule.config.minLevel];
    const reasons = verdict.reasons.length > 0 ? `: ${verdict.reasons.join('; ')}` : '';
    return [
      {
        labels: {},
        value: RANK[verdict.level] ?? 0,
        breached,
        summary: `${rule.name}: the telemetry verdict is ${verdict.level}${reasons}`.slice(0, 500),
      },
    ];
  },
  describe: (rule) => `The telemetry dashboard verdict is ${rule.config.minLevel} or worse`,
};

/** The config schema `node_offline` and `telemetry_unavailable` share (an empty object). */
export { emptyAlertConfigSchema };
