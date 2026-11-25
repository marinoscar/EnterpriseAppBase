import { ALERT_KIND_IDS, type MetricThresholdConfig } from '@marinoscar/platform-contract/alerts';

import { AlertStoreUnavailableError } from '../../src/alerts/alerts.errors';
import { buildMetricThresholdSql, compareValue, resolveMetricTable } from '../../src/alerts/kinds/metric-threshold.sql';
import { metricThresholdKind } from '../../src/alerts/kinds/metric-threshold.kind';
import { classifyNodeEvent, eventTypeMatches, nodeEventKind } from '../../src/alerts/kinds/node-event.kind';
import { nodeOfflineKind } from '../../src/alerts/kinds/node-offline.kind';
import { telemetryUnavailableKind } from '../../src/alerts/kinds/telemetry-unavailable.kind';
import { verdictKind } from '../../src/alerts/kinds/verdict.kind';
import { createFakeContext, createInMemoryAlertsPrisma } from '../../src/alerts/testing/index';
import { GREPTIME_SQL_DIALECT } from '../../src/telemetry/stores/greptime/greptime.dialect';
import { ident, literal, timestampLiteral, between } from '../../src/telemetry/dashboard/sql-literals';

const NOW = new Date('2026-01-01T00:10:00Z');
const table = { name: 'app_nodes_host_cpu_utilization', columns: new Set(['greptime_timestamp', 'greptime_value', 'node_id', 'outcome']), tags: ['node_id', 'outcome'] };
const tables = new Map([[table.name, table], ['app_jobs_settled_total', { ...table, name: 'app_jobs_settled_total' }]]);
const config: MetricThresholdConfig = { metric: 'app.nodes.host.cpu.utilization', aggregation: 'avg', windowSeconds: 300, comparator: 'gt', threshold: 90, groupBy: ['node_id'] };

function facade(rows: unknown[][], statements: string[] = []) {
  return {
    sql: { ident, literal, timestamp: timestampLiteral, between },
    dialect: GREPTIME_SQL_DIALECT,
    query: async (sql: string) => {
      statements.push(sql);
      return { columns: [], rows, rowCount: rows.length, truncated: false };
    },
  };
}

const rule = (kind: string, cfg: any) => ({ id: 'r1', key: null, name: 'Rule A', severity: 'warning' as const, kind, config: cfg });

describe('metric_threshold SQL', () => {
  it('resolves a dotted name to the store table, with or without a unit suffix', () => {
    expect(resolveMetricTable('app.nodes.host.cpu.utilization', tables)?.name).toBe(table.name);
    expect(resolveMetricTable('app.jobs.settled', tables)?.name).toBe('app_jobs_settled_total');
    expect(resolveMetricTable('app.nope', tables)).toBeNull();
  });

  it('builds one SELECT from the builders only: a hostile filter value stays inside a quoted literal', () => {
    const hostile = "x'; DROP TABLE t; --";
    const sql = buildMetricThresholdSql({ ...config, filters: [{ attr: 'outcome', op: 'eq', value: hostile }] }, table, facade([]), NOW);
    expect(sql).toContain(`"outcome" = '${hostile.replace(/'/g, "''")}'`);
    expect(sql).toContain('FROM "app_nodes_host_cpu_utilization"');
    expect(sql).toContain('GROUP BY "node_id"');
    expect(sql).toContain(`"greptime_timestamp" >= '2026-01-01T00:05:00.000Z'`);
    expect(sql.replace(`'${hostile.replace(/'/g, "''")}'`, '')).not.toContain(';'); // the hostile text stays inside its literal
  });

  it('refuses a column the table does not have', () => {
    expect(() => buildMetricThresholdSql({ ...config, groupBy: ['nope'] }, table, facade([]), NOW)).toThrow(/no column "nope"/);
    expect(() => buildMetricThresholdSql({ ...config, filters: [{ attr: 'a"b', op: 'eq', value: 'x' }] }, table, facade([]), NOW)).toThrow(/no column/);
  });

  it('spells every aggregation, rate as a per-series increase per minute', () => {
    for (const aggregation of ['avg', 'max', 'min', 'sum', 'last'] as const) {
      expect(buildMetricThresholdSql({ ...config, aggregation }, table, facade([]), NOW)).toContain('AS "value"');
    }
    const rate = buildMetricThresholdSql({ ...config, aggregation: 'rate', groupBy: undefined }, table, facade([]), NOW);
    expect(rate).toContain('MAX("greptime_value") - MIN("greptime_value") AS "inc"');
    expect(rate).toContain('SUM("inc") / 5');
  });

  it('compares with every comparator', () => {
    expect([compareValue(2, 'gt', 1), compareValue(1, 'gte', 1), compareValue(0, 'lt', 1), compareValue(1, 'lte', 1), compareValue(1, 'eq', 1), compareValue(1, 'neq', 1)]).toEqual([true, true, true, true, true, false]);
  });
});

describe('metric_threshold kind', () => {
  it('returns one observation per group with its labels and the breach verdict', async () => {
    const statements: string[] = [];
    const ctx = createFakeContext(createInMemoryAlertsPrisma(), { now: NOW, telemetry: { query: facade([['n1', '95.5'], ['n2', 10]], statements), tables } });
    const out = await metricThresholdKind.evaluate(ctx, rule(ALERT_KIND_IDS.METRIC_THRESHOLD, config));
    expect(out.map((o) => [o.labels, o.value, o.breached])).toEqual([[{ node_id: 'n1' }, 95.5, true], [{ node_id: 'n2' }, 10, false]]);
    expect(statements).toHaveLength(1);
  });

  it('treats an unreadable value as unknown, never breached', async () => {
    const ctx = createFakeContext(createInMemoryAlertsPrisma(), { now: NOW, telemetry: { query: facade([['n1', null]]), tables } });
    const [o] = await metricThresholdKind.evaluate(ctx, rule(ALERT_KIND_IDS.METRIC_THRESHOLD, config));
    expect([o.value, o.breached]).toEqual([null, false]);
  });

  it('propagates the store being unavailable, and reports a missing metric', async () => {
    const down = createFakeContext(createInMemoryAlertsPrisma(), { now: NOW });
    await expect(metricThresholdKind.evaluate(down, rule(ALERT_KIND_IDS.METRIC_THRESHOLD, config))).rejects.toBeInstanceOf(AlertStoreUnavailableError);
    const ctx = createFakeContext(createInMemoryAlertsPrisma(), { now: NOW, telemetry: { query: facade([]), tables: new Map() } });
    await expect(metricThresholdKind.evaluate(ctx, rule(ALERT_KIND_IDS.METRIC_THRESHOLD, config))).rejects.toThrow(/no table for the metric/);
  });
});

describe('node_event kind', () => {
  const cfg = nodeEventKind.configSchema.parse({
    eventTypes: ['power.source_changed'],
    attrs: { to: 'battery' },
    recovery: { eventTypes: ['power.source_changed'], attrs: { to: 'ac' } },
  });

  it('matches types exactly or by prefix', () => {
    expect(eventTypeMatches('power.*', 'power.battery_low')).toBe(true);
    expect(eventTypeMatches('power.battery_low', 'power.battery_critical')).toBe(false);
  });

  it('classifies triggers, recoveries and noise', () => {
    const e = (to: string, extra = {}) => ({ nodeId: 'n1', type: 'power.source_changed', severity: 'warning', attrs: { to }, ...extra });
    expect(classifyNodeEvent(cfg, e('battery'))).toBe('trigger');
    expect(classifyNodeEvent(cfg, e('ac'))).toBe('recovery');
    expect(classifyNodeEvent(cfg, e('other'))).toBeNull();
    expect(classifyNodeEvent({ ...cfg, minSeverity: 'critical' }, e('battery'))).toBeNull();
    expect(classifyNodeEvent({ ...cfg, nodeIds: ['n2'] }, e('battery'))).toBeNull();
  });

  it('breaches on the newest trigger per node and clears on a later recovery', async () => {
    const db = createInMemoryAlertsPrisma();
    db.nodes.push({ id: 'n1', name: 'node-a', status: 'online', lastHeartbeatAt: NOW }, { id: 'n2', name: 'node-b', status: 'online', lastHeartbeatAt: NOW });
    const ev = (nodeId: string, to: string, s: number) => db.nodeEvents.push({ id: `${nodeId}${s}`, nodeId, type: 'power.source_changed', severity: 'warning', attrs: { to }, occurredAt: NOW, receivedAt: new Date(NOW.getTime() - s * 1000) });
    ev('n1', 'battery', 100);
    ev('n2', 'battery', 100);
    ev('n2', 'ac', 50);
    const ctx = createFakeContext(db, { now: NOW });
    const out = await nodeEventKind.evaluate(ctx, rule(ALERT_KIND_IDS.NODE_EVENT, cfg));
    expect(out.map((o) => [o.labels['node.name'], o.breached])).toEqual([['node-a', true], ['node-b', false]]);
  });

  it('ignores events older than resolveAfterSeconds (the label set is absent)', async () => {
    const db = createInMemoryAlertsPrisma();
    db.nodeEvents.push({ id: 'e', nodeId: 'n1', type: 'power.source_changed', severity: 'warning', attrs: { to: 'battery' }, occurredAt: NOW, receivedAt: new Date(NOW.getTime() - 7200_000) });
    const out = await nodeEventKind.evaluate(createFakeContext(db, { now: NOW }), rule(ALERT_KIND_IDS.NODE_EVENT, cfg));
    expect(out).toEqual([]);
  });

  it('says whether an incoming event can change the rule', () => {
    expect(nodeEventKind.matchesEvent!(cfg, { nodeId: 'n', nodeName: 'n', type: 'power.source_changed', severity: 'info', attrs: { to: 'ac' }, occurredAt: '' })).toBe(true);
    expect(nodeEventKind.matchesEvent!(cfg, { nodeId: 'n', nodeName: 'n', type: 'node.disk_low', severity: 'info', attrs: {}, occurredAt: '' })).toBe(false);
  });
});

describe('node_offline, verdict and telemetry_unavailable kinds', () => {
  it('flags a stale node, passes a fresh one and skips a disabled one', async () => {
    const db = createInMemoryAlertsPrisma();
    db.nodes.push(
      { id: 'a', name: 'stale', status: 'online', lastHeartbeatAt: new Date(NOW.getTime() - 600_000) },
      { id: 'b', name: 'fresh', status: 'online', lastHeartbeatAt: new Date(NOW.getTime() - 10_000) },
      { id: 'c', name: 'off', status: 'disabled', lastHeartbeatAt: null },
    );
    // The in-memory client applies `where.status.not`.
    const out = await nodeOfflineKind.evaluate(createFakeContext(db, { now: NOW, staleHeartbeatSeconds: 90 }), rule(ALERT_KIND_IDS.NODE_OFFLINE, {}));
    expect(out.map((o) => [o.labels['node.name'], o.breached])).toEqual([['stale', true], ['fresh', false]]);
  });

  it('verdict: breaches at or past minLevel, never on no_data', async () => {
    const run = (level: string, minLevel: 'degraded' | 'critical') =>
      verdictKind.evaluate(createFakeContext(createInMemoryAlertsPrisma(), { verdict: { level, reasons: ['p95 high'] } }), rule(ALERT_KIND_IDS.VERDICT, { minLevel }));
    expect((await run('degraded', 'degraded'))[0].breached).toBe(true);
    expect((await run('degraded', 'critical'))[0].breached).toBe(false);
    expect((await run('critical', 'critical'))[0].breached).toBe(true);
    expect((await run('no_data', 'degraded'))[0].breached).toBe(false);
  });

  it('telemetry_unavailable: a failed probe is the breach', async () => {
    const down = await telemetryUnavailableKind.evaluate(createFakeContext(createInMemoryAlertsPrisma()), rule(ALERT_KIND_IDS.TELEMETRY_UNAVAILABLE, {}));
    expect(down[0].breached).toBe(true);
    const up = await telemetryUnavailableKind.evaluate(createFakeContext(createInMemoryAlertsPrisma(), { telemetry: { query: facade([[1]]), tables } }), rule(ALERT_KIND_IDS.TELEMETRY_UNAVAILABLE, {}));
    expect(up[0].breached).toBe(false);
  });
});
