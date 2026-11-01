// The alerts data invariants on real Postgres (#1047):
//   - alert_incidents_open_uniq_idx refuses a second OPEN incident for one rule
//     and label set, allows a resolved one beside it and an open one for other
//     labels;
//   - two overlapping evaluations of the same data leave one incident and one
//     dispatch (the unique violation reads as "already open");
//   - deleting a rule cascades to its incidents.
import type { PrismaClient } from '@prisma/client';
import {
  AlertContextService,
  AlertsDispatchService,
  AlertsEvaluationService,
  AlertsMetrics,
  alertRuleKindRegistry,
  registerAlertRuleKind,
  resolveAlertsModuleOptions,
} from '@marinoscar/platform-api/alerts';
import { createFakeKind } from '@marinoscar/platform-api/alerts/testing';
import { z } from 'zod';

import { createDbClient, resolveDbSuite } from '../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('alerts-incidents.db.spec');

const KIND = 'db_scripted';
const { kind, script } = createFakeKind(KIND, z.object({}).passthrough());
if (!alertRuleKindRegistry.has(KIND)) registerAlertRuleKind(kind);

describeWithDb('alerts on real Postgres (#1047)', () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function makeRule() {
    const rule = await client.alertRule.create({
      data: { name: `db-rule-${process.pid}-${created.length}`, kind: KIND, severity: 'warning', config: {}, enabled: true },
    });
    created.push(rule.id);
    return rule;
  }

  const incident = (ruleId: string, labelsKey: string, state: string) => ({
    ruleId,
    labelsKey,
    labels: {},
    state,
    severity: 'warning',
    lastSeenAt: new Date(),
    summary: 's',
  });

  beforeAll(() => {
    client = createDbClient();
  });

  afterAll(async () => {
    await client.alertRule.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it('refuses a second open incident for one rule and labels, but not a resolved or another-labels one', async () => {
    const rule = await makeRule();
    await client.alertIncident.create({ data: incident(rule.id, 'a=1', 'firing') });
    await expect(client.alertIncident.create({ data: incident(rule.id, 'a=1', 'pending') })).rejects.toMatchObject({ code: 'P2002' });
    await client.alertIncident.create({ data: incident(rule.id, 'a=2', 'pending') });
    await client.alertIncident.create({ data: incident(rule.id, 'a=1', 'resolved') });
    await client.alertIncident.create({ data: incident(rule.id, 'a=1', 'resolved') });
    // Resolving the open one frees the slot.
    await client.alertIncident.updateMany({ where: { ruleId: rule.id, labelsKey: 'a=1', state: 'firing' }, data: { state: 'resolved' } });
    await client.alertIncident.create({ data: incident(rule.id, 'a=1', 'firing') });
  });

  it('two overlapping evaluations leave one incident and one notification', async () => {
    const rule = await makeRule();
    const notify = jest.fn(async () => undefined);
    const dispatcher = new AlertsDispatchService(new AlertsMetrics(client as never), { notifyPermissionHolders: notify } as never);
    const evaluation = new AlertsEvaluationService(
      client as never,
      new AlertContextService(client as never),
      dispatcher,
      resolveAlertsModuleOptions(),
    );
    script.next = [{ labels: { 'node.id': 'n1' }, value: 1, breached: true, summary: 'bad' }];
    const now = new Date();
    await Promise.all([evaluation.evaluateRule(rule, now), evaluation.evaluateRule(rule, now), evaluation.evaluateRule(rule, now)]);
    await evaluation.evaluateRule(rule, new Date(now.getTime() + 60_000));
    expect(await client.alertIncident.count({ where: { ruleId: rule.id } })).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
    const row = await client.alertRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(row.lastEvaluatedAt).not.toBeNull();
    expect(row.lastError).toBeNull();
  });

  it('deleting a rule deletes its incidents', async () => {
    const rule = await makeRule();
    await client.alertIncident.create({ data: incident(rule.id, '', 'firing') });
    await client.alertRule.delete({ where: { id: rule.id } });
    expect(await client.alertIncident.count({ where: { ruleId: rule.id } })).toBe(0);
  });

  it('a starter key is unique', async () => {
    const key = `test.db_${process.pid}`;
    const rule = await client.alertRule.create({ data: { key, name: 'k', kind: KIND, severity: 'info', config: {} } });
    created.push(rule.id);
    await expect(client.alertRule.create({ data: { key, name: 'k2', kind: KIND, severity: 'info', config: {} } })).rejects.toMatchObject({ code: 'P2002' });
  });
});
