import { describe, expect, it } from 'vitest';

import {
  ALERT_FILTERS_MAX,
  ALERT_GROUP_BY_MAX,
  ALERT_KIND_IDS,
  ALERT_PERMISSIONS,
  ALERT_STARTER_RULE_KEYS,
  alertIncidentListQuerySchema,
  alertRuleListQuerySchema,
  createAlertRuleSchema,
  emptyAlertConfigSchema,
  metricThresholdConfigSchema,
  nodeEventConfigSchema,
  updateAlertRuleSchema,
  verdictConfigSchema,
} from '../src/alerts/index.js';

const metric = {
  metric: 'app.nodes.host.cpu.utilization',
  aggregation: 'avg',
  windowSeconds: 300,
  comparator: 'gt',
  threshold: 90,
};

describe('alert constants', () => {
  it('pins the permission strings and the built-in kind ids', () => {
    expect(ALERT_PERMISSIONS).toEqual({ READ: 'alerts:read', WRITE: 'alerts:write' });
    expect(Object.values(ALERT_KIND_IDS)).toEqual([
      'metric_threshold',
      'node_event',
      'verdict',
      'node_offline',
      'telemetry_unavailable',
    ]);
    expect(Object.values(ALERT_STARTER_RULE_KEYS)).toContain('nodes.on_battery');
  });
});

describe('create / update rule', () => {
  const base = { name: 'Rule A', kind: 'verdict', severity: 'critical' };

  it('applies defaults: disabled, no wait, 15 minute cooldown, webhooks on', () => {
    expect(createAlertRuleSchema.parse(base)).toMatchObject({
      enabled: false,
      forSeconds: 0,
      cooldownSeconds: 900,
      notifyChannels: [],
      webhook: true,
      config: {},
    });
  });

  it('refuses bad names, severities, kinds and bounds', () => {
    expect(createAlertRuleSchema.safeParse({ ...base, name: ' ' }).success).toBe(false);
    expect(createAlertRuleSchema.safeParse({ ...base, name: 'x'.repeat(121) }).success).toBe(false);
    expect(createAlertRuleSchema.safeParse({ ...base, severity: 'fatal' }).success).toBe(false);
    expect(createAlertRuleSchema.safeParse({ ...base, kind: 'Bad Kind' }).success).toBe(false);
    expect(createAlertRuleSchema.safeParse({ ...base, forSeconds: -1 }).success).toBe(false);
    expect(createAlertRuleSchema.safeParse({ ...base, forSeconds: 86_401 }).success).toBe(false);
    expect(createAlertRuleSchema.safeParse({ ...base, notifyChannels: ['email', 'email'] }).success).toBe(false);
  });

  it('accepts an app kind id (the vocabulary is open)', () => {
    expect(createAlertRuleSchema.safeParse({ ...base, kind: 'queue_depth_custom' }).success).toBe(true);
  });

  it('update is partial, strict and non-empty, and cannot change the kind', () => {
    expect(updateAlertRuleSchema.safeParse({}).success).toBe(false);
    expect(updateAlertRuleSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(updateAlertRuleSchema.safeParse({ kind: 'verdict' }).success).toBe(false);
  });
});

describe('built-in kind configs', () => {
  it('metric_threshold: bounds the window, group-by, filters and the metric name', () => {
    expect(metricThresholdConfigSchema.safeParse(metric).success).toBe(true);
    expect(metricThresholdConfigSchema.safeParse({ ...metric, windowSeconds: 59 }).success).toBe(false);
    expect(metricThresholdConfigSchema.safeParse({ ...metric, windowSeconds: 86_401 }).success).toBe(false);
    expect(metricThresholdConfigSchema.safeParse({ ...metric, comparator: 'between' }).success).toBe(false);
    expect(metricThresholdConfigSchema.safeParse({ ...metric, threshold: Number.NaN }).success).toBe(false);
    expect(metricThresholdConfigSchema.safeParse({ ...metric, metric: 'DROP TABLE x;' }).success).toBe(false);
    expect(metricThresholdConfigSchema.safeParse({ ...metric, extra: 1 }).success).toBe(false);
    const cols = Array.from({ length: ALERT_GROUP_BY_MAX + 1 }, (_, i) => `c${i}`);
    expect(metricThresholdConfigSchema.safeParse({ ...metric, groupBy: cols }).success).toBe(false);
    expect(metricThresholdConfigSchema.safeParse({ ...metric, groupBy: ['node_id; --'] }).success).toBe(false);
    const filters = Array.from({ length: ALERT_FILTERS_MAX + 1 }, () => ({ attr: 'outcome', op: 'eq', value: 'failed' }));
    expect(metricThresholdConfigSchema.safeParse({ ...metric, filters }).success).toBe(false);
    expect(metricThresholdConfigSchema.safeParse({ ...metric, filters: filters.slice(0, 1) }).success).toBe(true);
  });

  it('node_event: defaults the auto-resolve and validates the attribute match', () => {
    const parsed = nodeEventConfigSchema.parse({ eventTypes: ['power.*'] });
    expect(parsed.resolveAfterSeconds).toBe(3600);
    expect(nodeEventConfigSchema.safeParse({ eventTypes: [] }).success).toBe(false);
    expect(
      nodeEventConfigSchema.safeParse({
        eventTypes: ['power.source_changed'],
        attrs: { to: 'battery' },
        recovery: { eventTypes: ['power.source_changed'], attrs: { to: 'ac' } },
      }).success,
    ).toBe(true);
    expect(nodeEventConfigSchema.safeParse({ eventTypes: ['x'], minSeverity: 'loud' }).success).toBe(false);
  });

  it('verdict and the empty configs', () => {
    expect(verdictConfigSchema.safeParse({ minLevel: 'critical' }).success).toBe(true);
    expect(verdictConfigSchema.safeParse({ minLevel: 'healthy' }).success).toBe(false);
    expect(emptyAlertConfigSchema.safeParse({}).success).toBe(true);
    expect(emptyAlertConfigSchema.safeParse({ a: 1 }).success).toBe(false);
  });
});

describe('list queries', () => {
  it('coerces paging and the enabled flag', () => {
    expect(alertIncidentListQuerySchema.parse({ page: '2', pageSize: '50' })).toMatchObject({ page: 2, pageSize: 50 });
    expect(alertIncidentListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(alertIncidentListQuerySchema.safeParse({ ruleId: 'nope' }).success).toBe(false);
    expect(alertRuleListQuerySchema.parse({ enabled: 'false' }).enabled).toBe(false);
  });
});
