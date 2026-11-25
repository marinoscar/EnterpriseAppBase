import { ALERT_KIND_IDS, ALERT_STARTER_RULE_KEYS, type CreateAlertRule } from '@marinoscar/platform-contract/alerts';

/**
 * One starter rule: a stable key and the rule it seeds.
 *
 * @stability experimental
 */
export interface StarterAlertRule {
  /** The stable key (`alert_rules.key`). PERMANENT. */
  readonly key: string;
  /** The rule's definition. Always seeded disabled. */
  readonly rule: Omit<CreateAlertRule, 'enabled'>;
}

const base = { notifyChannels: [] as string[], webhook: true, cooldownSeconds: 900 };

/**
 * The starter rules, seeded disabled and never overwritten: an administrator's
 * edit to one survives every restart.
 * Starter rules cannot be deleted, only edited and disabled.
 *
 * @stability experimental
 */
export const STARTER_ALERT_RULES: readonly StarterAlertRule[] = [
  {
    key: ALERT_STARTER_RULE_KEYS.NODES_ON_BATTERY,
    rule: {
      ...base,
      name: 'Worker node on battery',
      description: 'A worker node switched from AC power to battery. Clears when AC returns.',
      kind: ALERT_KIND_IDS.NODE_EVENT,
      severity: 'warning',
      forSeconds: 0,
      config: {
        eventTypes: ['power.source_changed'],
        attrs: { to: 'battery' },
        recovery: { eventTypes: ['power.source_changed'], attrs: { to: 'ac' } },
        resolveAfterSeconds: 86_400,
      },
    },
  },
  {
    key: ALERT_STARTER_RULE_KEYS.NODES_BATTERY_LOW,
    rule: {
      ...base,
      name: 'Worker node battery low',
      description: 'A worker node reported a low or critical battery. Clears when the battery recovers.',
      kind: ALERT_KIND_IDS.NODE_EVENT,
      severity: 'warning',
      forSeconds: 0,
      config: {
        eventTypes: ['power.battery_low', 'power.battery_critical'],
        recovery: { eventTypes: ['power.battery_recovered'] },
        resolveAfterSeconds: 21_600,
      },
    },
  },
  {
    key: ALERT_STARTER_RULE_KEYS.NODES_HOST_CPU_HIGH,
    rule: {
      ...base,
      name: 'Worker host CPU high',
      description: 'A worker host averaged more than 90% CPU over five minutes.',
      kind: ALERT_KIND_IDS.METRIC_THRESHOLD,
      severity: 'warning',
      forSeconds: 300,
      config: {
        metric: 'app.nodes.host.cpu.utilization',
        aggregation: 'avg',
        windowSeconds: 300,
        comparator: 'gt',
        threshold: 90,
        groupBy: ['node_id'],
      },
    },
  },
  {
    key: ALERT_STARTER_RULE_KEYS.NODES_HOST_MEMORY_LOW,
    rule: {
      ...base,
      name: 'Worker host memory low',
      description: 'A worker host has less than 512 MiB of memory available.',
      kind: ALERT_KIND_IDS.METRIC_THRESHOLD,
      severity: 'warning',
      forSeconds: 300,
      config: {
        metric: 'app.nodes.host.memory.available',
        aggregation: 'last',
        windowSeconds: 300,
        comparator: 'lt',
        threshold: 536_870_912,
        groupBy: ['node_id'],
      },
    },
  },
  {
    key: ALERT_STARTER_RULE_KEYS.NODES_OFFLINE,
    rule: {
      ...base,
      name: 'Worker node offline',
      description: 'A worker node stopped heartbeating or was marked offline.',
      kind: ALERT_KIND_IDS.NODE_OFFLINE,
      severity: 'critical',
      forSeconds: 60,
      config: {},
    },
  },
  {
    key: ALERT_STARTER_RULE_KEYS.JOBS_FAILURE_SPIKE,
    rule: {
      ...base,
      name: 'Job failure spike',
      description: 'More than one job per minute failed, on average, over five minutes.',
      kind: ALERT_KIND_IDS.METRIC_THRESHOLD,
      severity: 'warning',
      forSeconds: 0,
      config: {
        metric: 'app.jobs.settled',
        aggregation: 'rate',
        windowSeconds: 300,
        comparator: 'gt',
        threshold: 1,
        filters: [{ attr: 'outcome', op: 'eq', value: 'failed' }],
      },
    },
  },
  {
    key: ALERT_STARTER_RULE_KEYS.TELEMETRY_VERDICT_CRITICAL,
    rule: {
      ...base,
      name: 'Telemetry verdict critical',
      description: 'The telemetry dashboard verdict is critical.',
      kind: ALERT_KIND_IDS.VERDICT,
      severity: 'critical',
      forSeconds: 120,
      config: { minLevel: 'critical' },
    },
  },
  {
    key: ALERT_STARTER_RULE_KEYS.TELEMETRY_UNAVAILABLE,
    rule: {
      ...base,
      name: 'Telemetry store unavailable',
      description: 'The telemetry store could not be queried for three minutes. Metric rules cannot be evaluated meanwhile.',
      kind: ALERT_KIND_IDS.TELEMETRY_UNAVAILABLE,
      severity: 'warning',
      forSeconds: 180,
      config: {},
    },
  },
];
