// The alerts headless layer (issue #1047): the client's paths and query
// strings, the metric catalog, the hooks' load state and refusals in words,
// the summary poll, and the rule editor's draft model per kind (the payloads
// it builds parse with the contract's schemas).
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAlertRuleSchema,
  metricThresholdConfigSchema,
  nodeEventConfigSchema,
  updateAlertRuleSchema,
  verdictConfigSchema,
} from '@marinoscar/platform-contract/alerts';

import { PlatformHostProvider } from '../../src/core/index.js';
import { createTestApiError, createTestPlatformHost } from '../../src/testing/index.js';
import type { TestPlatformHost } from '../../src/testing/index.js';
import {
  alertErrorMessage,
  alertFiringTotal,
  alertKindLabel,
  alertRuleDraftFromRule,
  alertTopSeverity,
  buildAlertRulePayload,
  createAlertsApi,
  emptyAlertRuleDraft,
  formatAlertLabels,
  formatAlertSeconds,
  metricCatalogFromSchema,
  useAlertIncidents,
  useAlertKinds,
  useAlertMetricCatalog,
  useAlertMutations,
  useAlertRule,
  useAlertRules,
  useAlertSummary,
} from '../../src/alerts/headless/index.js';
import { INCIDENT_ID, KINDS, RULE_ID, SCHEMA, STARTER_ID, incident, rule, starterRule } from './fixtures.js';

function wrapper(host: TestPlatformHost) {
  return ({ children }: { children: ReactNode }) => <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
}

const SUMMARY = { firing: { critical: 1, warning: 2, info: 0 }, lastEvaluatedAt: '2026-10-31T12:00:00.000Z' };

describe('createAlertsApi', () => {
  it('addresses every route under /admin/alerts with the filters as query strings', async () => {
    const host = createTestPlatformHost({
      responses: {
        'GET /admin/alerts/rules': [],
        [`GET /admin/alerts/rules/${RULE_ID}`]: rule(),
        'POST /admin/alerts/rules': rule(),
        [`PATCH /admin/alerts/rules/${RULE_ID}`]: rule(),
        [`DELETE /admin/alerts/rules/${RULE_ID}`]: null,
        [`POST /admin/alerts/rules/${RULE_ID}/test`]: { observations: [] },
        'GET /admin/alerts/kinds': KINDS,
        'GET /admin/alerts/incidents': { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
        [`GET /admin/alerts/incidents/${INCIDENT_ID}`]: incident(),
        [`POST /admin/alerts/incidents/${INCIDENT_ID}/acknowledge`]: incident(),
        'GET /admin/alerts/summary': SUMMARY,
        'GET /admin/telemetry/schema': SCHEMA,
      },
    });
    const alerts = createAlertsApi(host.api);
    await alerts.listRules({ kind: 'node_event', severity: 'critical', enabled: false });
    await alerts.getRule(RULE_ID);
    await alerts.createRule({ name: 'A', kind: 'node_offline', severity: 'critical' } as never);
    await alerts.updateRule(RULE_ID, { enabled: true });
    await alerts.deleteRule(RULE_ID);
    await alerts.testRule(RULE_ID);
    await alerts.listKinds();
    await alerts.listIncidents({ state: 'firing', severity: 'critical', page: 2, pageSize: 10 });
    await alerts.getIncident(INCIDENT_ID);
    await alerts.acknowledge(INCIDENT_ID);
    await alerts.summary();
    const metrics = await alerts.metricCatalog();

    expect(host.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /admin/alerts/rules?kind=node_event&severity=critical&enabled=false',
      `GET /admin/alerts/rules/${RULE_ID}`,
      'POST /admin/alerts/rules',
      `PATCH /admin/alerts/rules/${RULE_ID}`,
      `DELETE /admin/alerts/rules/${RULE_ID}`,
      `POST /admin/alerts/rules/${RULE_ID}/test`,
      'GET /admin/alerts/kinds',
      'GET /admin/alerts/incidents?state=firing&severity=critical&page=2&pageSize=10',
      `GET /admin/alerts/incidents/${INCIDENT_ID}`,
      `POST /admin/alerts/incidents/${INCIDENT_ID}/acknowledge`,
      'GET /admin/alerts/summary',
      'GET /admin/telemetry/schema',
    ]);
    expect(host.requests[3]?.body).toEqual({ enabled: true });
    expect(metrics).toEqual([{ name: 'app_jobs_queue_depth', attributes: ['job_type'] }]);
  });

  it('keeps only metric tables, without the value and timestamp columns, sorted', () => {
    const entries = metricCatalogFromSchema({
      tables: [
        { name: 'b_metric', rows: 1, columns: [{ name: 'host', type: 'string', semanticType: 'TAG' }] },
        { name: 'opentelemetry_logs', rows: 1, columns: [] },
        { name: 'a_metric', rows: 1, columns: [{ name: 'greptime_value', type: 'double', semanticType: 'FIELD' }] },
      ],
    });
    expect(entries).toEqual([
      { name: 'a_metric', attributes: [] },
      { name: 'b_metric', attributes: ['host'] },
    ]);
  });
});

describe('alerts in words', () => {
  it('maps the refusal codes, from `code` or `details.reason`, else the message, else the fallback', () => {
    expect(alertErrorMessage(createTestApiError(409, 'Conflict', 'ALERT_STARTER_RULE_PROTECTED'), 'x')).toMatch(/Built-in rules cannot be deleted/);
    expect(alertErrorMessage(createTestApiError(400, 'Bad', 'VALIDATION', { reason: 'ALERT_INVALID_CONFIG' }), 'x')).toMatch(/not valid for its kind/);
    expect(alertErrorMessage(createTestApiError(500, 'Upstream down'), 'x')).toBe('Upstream down');
    expect(alertErrorMessage(new Error('boom'), 'fallback')).toBe('fallback');
  });

  it('totals the summary and names its top severity', () => {
    expect(alertFiringTotal(SUMMARY)).toBe(3);
    expect(alertTopSeverity(SUMMARY)).toBe('critical');
    expect(alertTopSeverity({ firing: { critical: 0, warning: 0, info: 4 } })).toBe('info');
    expect(alertTopSeverity({ firing: { critical: 0, warning: 0, info: 0 } })).toBeNull();
    expect(alertFiringTotal(null)).toBe(0);
  });

  it('formats labels, durations and kinds', () => {
    expect(formatAlertLabels({ 'node.name': 'Node P1', 'node.id': 'n1' })).toBe('node.id=n1, node.name=Node P1');
    expect(formatAlertSeconds(90)).toBe('1 min 30 s');
    expect(formatAlertSeconds(3600)).toBe('1 h');
    expect(formatAlertSeconds(0)).toBe('0 s');
    expect(alertKindLabel('node_event')).toBe('Node event');
    expect(alertKindLabel('app_custom', [{ id: 'app_custom', label: 'Custom check' }])).toBe('Custom check');
    expect(alertKindLabel('unknown_kind')).toBe('unknown_kind');
  });
});

describe('the rule draft builds valid payloads per kind', () => {
  it('metric_threshold: parses the threshold and drops empty group-by and filters', () => {
    const draft = emptyAlertRuleDraft('metric_threshold');
    draft.name = '  CPU high on Org Alpha hosts ';
    draft.metric = { ...draft.metric, metric: 'app.nodes.host.cpu.utilization', threshold: '90', groupBy: ['node_id'] };
    draft.metric.filters = [
      { attr: 'host', op: 'neq', value: 'host-x' },
      { attr: ' ', op: 'eq', value: 'ignored' },
    ];
    const result = buildAlertRulePayload(draft, 'create');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      name: 'CPU high on Org Alpha hosts',
      kind: 'metric_threshold',
      config: {
        metric: 'app.nodes.host.cpu.utilization',
        aggregation: 'avg',
        windowSeconds: 300,
        comparator: 'gt',
        threshold: 90,
        groupBy: ['node_id'],
        filters: [{ attr: 'host', op: 'neq', value: 'host-x' }],
      },
    });
    expect(createAlertRuleSchema.safeParse(result.value).success).toBe(true);
    expect(metricThresholdConfigSchema.safeParse(result.value.config).success).toBe(true);
  });

  it('metric_threshold: refuses a missing metric, a non-number threshold and a short window', () => {
    const draft = emptyAlertRuleDraft('metric_threshold');
    draft.name = 'Broken';
    draft.metric = { ...draft.metric, threshold: 'many', windowSeconds: 10 };
    const result = buildAlertRulePayload(draft, 'create');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors['metric']).toBe('Choose a metric.');
    expect(result.errors['threshold']).toBe('Enter a number.');
    expect(result.errors['windowSeconds']).toBeDefined();
  });

  it('node_event: event types, attributes and recovery', () => {
    const draft = emptyAlertRuleDraft('node_event');
    draft.name = 'On battery';
    draft.nodeEvent = {
      ...draft.nodeEvent,
      eventTypes: ['power.source_changed'],
      minSeverity: 'warning',
      attrs: [{ key: 'to', value: 'battery' }],
      recoveryEventTypes: ['power.source_changed'],
      recoveryAttrs: [{ key: 'to', value: 'ac' }],
    };
    const result = buildAlertRulePayload(draft, 'create');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.config).toEqual({
      eventTypes: ['power.source_changed'],
      minSeverity: 'warning',
      attrs: { to: 'battery' },
      recovery: { eventTypes: ['power.source_changed'], attrs: { to: 'ac' } },
      resolveAfterSeconds: 3600,
    });
    expect(nodeEventConfigSchema.safeParse(result.value.config).success).toBe(true);
  });

  it('node_event: needs at least one event type', () => {
    const draft = emptyAlertRuleDraft('node_event');
    draft.name = 'Nothing';
    const result = buildAlertRulePayload(draft, 'create');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors['eventTypes']).toBe('Choose at least one event type.');
  });

  it('verdict, node_offline and telemetry_unavailable', () => {
    const verdict = { ...emptyAlertRuleDraft('verdict'), name: 'Verdict', verdict: { minLevel: 'degraded' as const } };
    const v = buildAlertRulePayload(verdict, 'create');
    expect(v.ok && v.value.config).toEqual({ minLevel: 'degraded' });
    if (v.ok) expect(verdictConfigSchema.safeParse(v.value.config).success).toBe(true);
    for (const kind of ['node_offline', 'telemetry_unavailable']) {
      const r = buildAlertRulePayload({ ...emptyAlertRuleDraft(kind), name: kind }, 'create');
      expect(r.ok && r.value.config).toEqual({});
    }
  });

  it('an app kind takes its config as JSON and refuses what is not an object', () => {
    const draft = { ...emptyAlertRuleDraft('app_custom'), name: 'Custom', rawConfig: '{"limit": 3}' };
    const ok = buildAlertRulePayload(draft, 'create');
    expect(ok.ok && ok.value.config).toEqual({ limit: 3 });
    const bad = buildAlertRulePayload({ ...draft, rawConfig: '[1]' }, 'create');
    expect(bad.ok).toBe(false);
    const broken = buildAlertRulePayload({ ...draft, rawConfig: '{' }, 'create');
    expect(!broken.ok && broken.errors['config']).toMatch(/not valid JSON/);
  });

  it('update omits the kind and round-trips a rule; a name is required', () => {
    const draft = alertRuleDraftFromRule(rule());
    expect(draft.metric.threshold).toBe('100');
    const result = buildAlertRulePayload(draft, 'update');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('kind' in result.value).toBe(false);
      expect(updateAlertRuleSchema.safeParse(result.value).success).toBe(true);
      expect(result.value.config).toEqual(rule().config);
    }
    const starter = alertRuleDraftFromRule(starterRule());
    expect(buildAlertRulePayload({ ...starter, name: ' ' }, 'update')).toEqual({ ok: false, errors: { name: 'Enter a name.' } });
  });

  it('reads a node_event rule back into the form', () => {
    const draft = alertRuleDraftFromRule(
      rule({
        kind: 'node_event',
        config: { eventTypes: ['power.*'], attrs: { to: 'battery' }, recovery: { eventTypes: ['power.battery_recovered'] }, resolveAfterSeconds: 600 },
      }),
    );
    expect(draft.nodeEvent).toMatchObject({
      eventTypes: ['power.*'],
      attrs: [{ key: 'to', value: 'battery' }],
      recoveryEventTypes: ['power.battery_recovered'],
      resolveAfterSeconds: 600,
    });
  });
});

describe('the hooks', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('load rules, one rule, kinds, incidents and the metric catalog', async () => {
    const host = createTestPlatformHost({
      responses: {
        'GET /admin/alerts/rules': [rule(), starterRule()],
        [`GET /admin/alerts/rules/${RULE_ID}`]: rule(),
        'GET /admin/alerts/kinds': KINDS,
        'GET /admin/alerts/incidents': { items: [incident()], total: 1, page: 1, pageSize: 20, totalPages: 1 },
        'GET /admin/telemetry/schema': SCHEMA,
      },
    });
    const { result } = renderHook(
      () => ({
        rules: useAlertRules(),
        one: useAlertRule(RULE_ID),
        none: useAlertRule(null),
        kinds: useAlertKinds(),
        incidents: useAlertIncidents({ state: 'firing', page: 1 }),
        metrics: useAlertMetricCatalog(),
      }),
      { wrapper: wrapper(host) },
    );
    await waitFor(() => expect(result.current.rules.rules).toHaveLength(2));
    await waitFor(() => expect(result.current.metrics.metrics).toHaveLength(1));
    expect(result.current.one.rule?.id).toBe(RULE_ID);
    expect(result.current.none.rule).toBeNull();
    expect(result.current.kinds.kinds).toHaveLength(5);
    expect(result.current.incidents.incidents[0]?.id).toBe(INCIDENT_ID);
    expect(result.current.incidents.total).toBe(1);
    expect(host.requests.some((r) => r.path === '/admin/alerts/incidents?state=firing&page=1')).toBe(true);
  });

  it('report a load failure in words and skip disabled requests', async () => {
    const host = createTestPlatformHost({ responses: {} });
    const { result } = renderHook(() => ({ rules: useAlertRules(), metrics: useAlertMetricCatalog({ enabled: false }) }), {
      wrapper: wrapper(host),
    });
    await waitFor(() => expect(result.current.rules.error).toMatch(/No test response/));
    expect(result.current.metrics.isLoading).toBe(false);
    expect(host.requests.some((r) => r.path.startsWith('/admin/telemetry'))).toBe(false);
  });

  it('poll the summary every 30 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const host = createTestPlatformHost({ responses: { 'GET /admin/alerts/summary': SUMMARY } });
    const { result } = renderHook(() => useAlertSummary(), { wrapper: wrapper(host) });
    await waitFor(() => expect(result.current.summary).toEqual(SUMMARY));
    const before = host.requests.length;
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    await waitFor(() => expect(host.requests.length).toBe(before + 1));
  });

  it('do not ask for the summary when disabled', async () => {
    const host = createTestPlatformHost({ responses: { 'GET /admin/alerts/summary': SUMMARY } });
    const { result } = renderHook(() => useAlertSummary({ enabled: false }), { wrapper: wrapper(host) });
    expect(result.current.summary).toBeNull();
    expect(host.requests).toHaveLength(0);
  });

  it('write, and turn a refusal into words without throwing', async () => {
    const host = createTestPlatformHost({
      responses: {
        'POST /admin/alerts/rules': rule(),
        [`PATCH /admin/alerts/rules/${RULE_ID}`]: (request: { body?: unknown }) => rule({ ...(request.body as object) }),
        [`DELETE /admin/alerts/rules/${RULE_ID}`]: null,
        [`DELETE /admin/alerts/rules/${STARTER_ID}`]: () => {
          throw createTestApiError(409, 'Protected', 'ALERT_STARTER_RULE_PROTECTED');
        },
        [`POST /admin/alerts/rules/${RULE_ID}/test`]: { ruleId: RULE_ID, observations: [] },
        [`POST /admin/alerts/incidents/${INCIDENT_ID}/acknowledge`]: incident({ acknowledgedAt: '2026-10-31T12:05:00.000Z' }),
      },
    });
    const { result } = renderHook(() => useAlertMutations(), { wrapper: wrapper(host) });
    let toggled: unknown;
    await act(async () => {
      toggled = await result.current.toggle(RULE_ID, false);
    });
    expect((toggled as { enabled: boolean }).enabled).toBe(false);
    await act(async () => {
      expect(await result.current.remove(RULE_ID)).toBe(true);
      expect(await result.current.test(RULE_ID)).toMatchObject({ ruleId: RULE_ID });
      expect((await result.current.acknowledge(INCIDENT_ID))?.acknowledgedAt).not.toBeNull();
    });
    await act(async () => {
      expect(await result.current.remove(STARTER_ID)).toBe(false);
    });
    expect(result.current.error).toMatch(/Built-in rules cannot be deleted/);
    act(() => result.current.reset());
    expect(result.current.error).toBeNull();
  });
});
