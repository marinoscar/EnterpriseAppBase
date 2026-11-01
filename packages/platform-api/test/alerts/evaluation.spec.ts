import { z } from 'zod';
import { ALERT_KIND_IDS } from '@marinoscar/platform-contract/alerts';

import { AlertContextService } from '../../src/alerts/alerts-context.service';
import { AlertsDispatchService } from '../../src/alerts/alerts-dispatch.service';
import { AlertsEvaluationService } from '../../src/alerts/alerts-evaluation.service';
import { AlertStoreUnavailableError } from '../../src/alerts/alerts.errors';
import { AlertsMetrics } from '../../src/alerts/alerts.metrics';
import { resolveAlertsModuleOptions } from '../../src/alerts/alerts.options';
import { alertRuleKindRegistry, registerAlertRuleKind } from '../../src/alerts/kinds/alert-kind.registry';
import { registerBuiltinAlertKinds } from '../../src/alerts/kinds/builtin-kinds';
import { createFakeKind, createInMemoryAlertsPrisma } from '../../src/alerts/testing/index';

const KIND = 'test_scripted';
const { kind, script } = createFakeKind(KIND, z.object({}).passthrough(), { eventDriven: true });
if (!alertRuleKindRegistry.has(KIND)) registerAlertRuleKind(kind);
registerBuiltinAlertKinds();

const T0 = new Date('2026-01-01T00:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const obs = (breached: boolean, labels: Record<string, string> = { 'node.id': 'n1' }, value: number | null = 1) => ({ labels, value, breached, summary: breached ? 'bad' : 'ok' });

function rig(options = {}) {
  const prisma = createInMemoryAlertsPrisma();
  const events: string[] = [];
  const notifications = {
    notifyPermissionHolders: jest.fn(async (event: string, _perm: string, _data: unknown, opts?: unknown) => {
      events.push(`${event}|firing=${prisma.incidents.filter((i) => i.state === 'firing').length}|${JSON.stringify(opts ?? null)}`);
    }),
  };
  const webhooks = { emit: jest.fn(async () => undefined) };
  const dispatcher = new AlertsDispatchService(new AlertsMetrics(prisma), notifications as never, webhooks);
  const evaluation = new AlertsEvaluationService(prisma, new AlertContextService(prisma), dispatcher, resolveAlertsModuleOptions(options));
  return { prisma, evaluation, notifications, webhooks, events };
}

beforeEach(() => {
  script.next = [];
  script.calls = 0;
});

describe('AlertsEvaluationService', () => {
  it('fires at once when forSeconds is 0, notifying after the write and emitting the webhook', async () => {
    const { prisma, evaluation, events, webhooks } = rig();
    const rule = prisma.addRule({ kind: KIND, forSeconds: 0 });
    script.next = [obs(true)];
    const outcome = await evaluation.evaluateRule(rule, T0);
    expect(outcome).toMatchObject({ status: 'ok', opened: 1, fired: 1 });
    expect(prisma.incidents).toHaveLength(1);
    expect(prisma.incidents[0]).toMatchObject({ state: 'firing', summary: 'bad' });
    expect(events).toEqual(['alerts.alert_fired|firing=1|null']); // the incident was already firing when the notification was raised
    expect(webhooks.emit).toHaveBeenCalledWith('alerts.alert.fired', expect.objectContaining({ incidentId: prisma.incidents[0].id }), { orgId: null });
    expect(prisma.rules[0].lastEvaluatedAt).toEqual(T0);
  });

  it('holds a breach pending for forSeconds, then fires once', async () => {
    const { prisma, evaluation, events } = rig();
    const rule = prisma.addRule({ kind: KIND, forSeconds: 120 });
    script.next = [obs(true)];
    await evaluation.evaluateRule(rule, T0);
    expect(prisma.incidents[0].state).toBe('pending');
    await evaluation.evaluateRule(rule, at(60));
    expect(prisma.incidents[0].state).toBe('pending');
    await evaluation.evaluateRule(rule, at(120));
    expect(prisma.incidents[0].state).toBe('firing');
    await evaluation.evaluateRule(rule, at(180));
    expect(events).toHaveLength(1);
    expect(prisma.incidents).toHaveLength(1);
  });

  it('drops a pending incident that cleared before firing, without a notification', async () => {
    const { prisma, evaluation, events } = rig();
    const rule = prisma.addRule({ kind: KIND, forSeconds: 120 });
    script.next = [obs(true)];
    await evaluation.evaluateRule(rule, T0);
    script.next = [obs(false)];
    await evaluation.evaluateRule(rule, at(30));
    expect(prisma.incidents).toHaveLength(0);
    expect(events).toEqual([]);
  });

  it('resolves on the first clean evaluation and when the label set disappears', async () => {
    const { prisma, evaluation, events } = rig();
    const rule = prisma.addRule({ kind: KIND });
    script.next = [obs(true, { a: '1' }), obs(true, { a: '2' })];
    await evaluation.evaluateRule(rule, T0);
    script.next = [obs(false, { a: '1' })]; // a=2 is absent
    const outcome = await evaluation.evaluateRule(rule, at(60));
    expect(outcome.resolved).toBe(2);
    expect(prisma.incidents.every((i) => i.state === 'resolved' && i.resolvedAt)).toBe(true);
    expect(events.filter((e) => e.startsWith('alerts.alert_resolved'))).toHaveLength(2);
  });

  it('is idempotent: two passes over the same data leave one incident and one notification', async () => {
    const { prisma, evaluation, events } = rig();
    const rule = prisma.addRule({ kind: KIND });
    script.next = [obs(true)];
    await Promise.all([evaluation.evaluateRule(rule, T0), evaluation.evaluateRule(rule, T0)]);
    await evaluation.evaluateRule(rule, at(60));
    expect(prisma.incidents).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it('suppresses the notification of a re-fire inside the cooldown, and its resolve, but records the incident', async () => {
    const { prisma, evaluation, events } = rig();
    const rule = prisma.addRule({ kind: KIND, cooldownSeconds: 900 });
    script.next = [obs(true)];
    await evaluation.evaluateRule(rule, T0); // fired (notified)
    script.next = [obs(false)];
    await evaluation.evaluateRule(rule, at(60)); // resolved (notified)
    script.next = [obs(true)];
    await evaluation.evaluateRule(rule, at(120)); // re-fire inside the cooldown: recorded, not notified
    script.next = [obs(false)];
    await evaluation.evaluateRule(rule, at(180)); // its resolve: not notified either
    expect(prisma.incidents).toHaveLength(2);
    expect(events.map((e) => e.split('|')[0])).toEqual(['alerts.alert_fired', 'alerts.alert_resolved']);
    script.next = [obs(true)];
    await evaluation.evaluateRule(rule, at(3000)); // past the cooldown
    expect(events).toHaveLength(3);
  });

  it('restricts the notification to the rule channels, and emits no webhook when the rule opts out', async () => {
    const { prisma, evaluation, notifications, webhooks } = rig();
    const rule = prisma.addRule({ kind: KIND, notifyChannels: ['email'], webhook: false });
    script.next = [obs(true)];
    await evaluation.evaluateRule(rule, T0);
    expect(notifications.notifyPermissionHolders).toHaveBeenCalledWith('alerts.alert_fired', 'alerts:read', expect.anything(), { channels: ['email'] });
    expect(webhooks.emit).not.toHaveBeenCalled();
  });

  it('records a store outage on the rule and leaves its incidents untouched', async () => {
    const { prisma, evaluation, events } = rig();
    const rule = prisma.addRule({ kind: KIND });
    script.next = [obs(true)];
    await evaluation.evaluateRule(rule, T0);
    script.next = new AlertStoreUnavailableError('the store is down');
    const outcome = await evaluation.evaluateRule(rule, at(60));
    expect(outcome).toMatchObject({ status: 'error', error: 'the store is down' });
    expect(prisma.rules[0].lastError).toBe('the store is down');
    expect(prisma.incidents[0].state).toBe('firing');
    script.next = [obs(true)];
    await evaluation.evaluateRule(rule, at(120));
    expect(prisma.rules[0].lastError).toBeNull();
    expect(events).toHaveLength(1);
  });

  it('isolates a failing rule from the others and skips disabled rules', async () => {
    const { prisma, evaluation } = rig();
    prisma.addRule({ kind: 'not_registered', name: 'Broken' });
    prisma.addRule({ kind: KIND, name: 'Fine' });
    prisma.addRule({ kind: KIND, name: 'Off', enabled: false });
    script.next = [obs(true)];
    const outcomes = await evaluation.evaluateEnabled();
    expect(outcomes.map((o) => o.status)).toEqual(['error', 'ok']);
    expect(script.calls).toBe(1);
    expect(prisma.rules[0].lastError).toMatch(/not registered/);
  });

  it('abandons a rule that overruns its time budget', async () => {
    const { prisma, evaluation } = rig({ evaluationBudgetMs: 1000 });
    const slow = createFakeKind('test_slow', z.object({}).passthrough());
    slow.kind.evaluate = () => new Promise(() => undefined);
    if (!alertRuleKindRegistry.has('test_slow')) registerAlertRuleKind(slow.kind);
    const rule = prisma.addRule({ kind: 'test_slow' });
    jest.useFakeTimers();
    const pending = evaluation.evaluateRule(rule, T0);
    await jest.advanceTimersByTimeAsync(1100);
    jest.useRealTimers();
    expect(await pending).toMatchObject({ status: 'error', error: expect.stringMatching(/longer than 1000 ms/) });
  });

  it('the event path evaluates only event-driven rules the event can change', async () => {
    const { prisma, evaluation } = rig();
    prisma.addRule({ kind: KIND, name: 'event rule' });
    prisma.addRule({ kind: ALERT_KIND_IDS.VERDICT, name: 'periodic rule', config: { minLevel: 'critical' } });
    prisma.addRule({ kind: ALERT_KIND_IDS.NODE_EVENT, name: 'other event', config: { eventTypes: ['node.disk_low'] } });
    const outcomes = await evaluation.evaluateEnabled({
      event: { nodeId: 'n1', nodeName: 'n', type: 'power.battery_low', severity: 'warning', attrs: {}, occurredAt: T0.toISOString() },
    });
    expect(outcomes).toHaveLength(1); // only the scripted event-driven kind (no matchesEvent = always)
    expect(script.calls).toBe(1);
  });

  it('a dry run observes without storing or dispatching', async () => {
    const { prisma, evaluation, events } = rig();
    const rule = prisma.addRule({ kind: KIND });
    script.next = [obs(true)];
    expect(await evaluation.observe(rule, T0)).toHaveLength(1);
    expect(prisma.incidents).toHaveLength(0);
    expect(prisma.rules[0].lastEvaluatedAt).toBeNull();
    expect(events).toEqual([]);
  });
});
