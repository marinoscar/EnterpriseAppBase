import { ALERT_KIND_IDS, emptyAlertConfigSchema, type AlertObservation } from '@marinoscar/platform-contract/alerts';

import { AlertStoreUnavailableError } from '../alerts.errors';
import type { AlertRuleKind } from '../alerts.types';

/**
 * `telemetry_unavailable`: the telemetry store cannot be queried. It probes
 * with `SELECT 1`; a failure is the BREACH here rather than an evaluation
 * error. Pair it with `forSeconds` (the starter rule waits three minutes) so a
 * blip does not flap.
 *
 * @stability experimental
 */
export const telemetryUnavailableKind: AlertRuleKind<Record<string, never>> = {
  id: ALERT_KIND_IDS.TELEMETRY_UNAVAILABLE,
  label: 'Telemetry store unavailable',
  description: 'The telemetry store cannot be queried (not configured, disabled, unreachable or timing out).',
  configSchema: emptyAlertConfigSchema as unknown as AlertRuleKind<Record<string, never>>['configSchema'],
  async evaluate(ctx, rule): Promise<AlertObservation[]> {
    try {
      const telemetry = await ctx.telemetry();
      await telemetry.query.query('SELECT 1', { maxRows: 1 });
      return [{ labels: {}, value: 0, breached: false, summary: `${rule.name}: the telemetry store answers` }];
    } catch (error) {
      if (!(error instanceof AlertStoreUnavailableError) && !(error instanceof Error)) throw error;
      return [
        {
          labels: {},
          value: 1,
          breached: true,
          summary: `${rule.name}: the telemetry store cannot be queried (${error.message})`.slice(0, 500),
        },
      ];
    }
  },
  describe: () => 'The telemetry store cannot be queried',
};
