import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ALERT_ERROR_CODES, ALERT_KIND_IDS, createAlertRuleSchema } from '@marinoscar/platform-contract/alerts';

import { AlertsAdminController } from '../../src/alerts/alerts-admin.controller';
import { AlertsEventListener } from '../../src/alerts/alerts-event.listener';
import { AlertsIncidentsService } from '../../src/alerts/alerts-incidents.service';
import { AlertsRulesService } from '../../src/alerts/alerts-rules.service';
import { AlertsSeedService } from '../../src/alerts/alerts-seed.service';
import { AlertsIncidentsPurgeHandler } from '../../src/alerts/handlers/alerts-incidents-purge.handler';
import { AlertsEvaluateEventHandler } from '../../src/alerts/handlers/alerts-evaluate-event.handler';
import { registerBuiltinAlertKinds } from '../../src/alerts/kinds/builtin-kinds';
import { resolveAlertsModuleOptions } from '../../src/alerts/alerts.options';
import { STARTER_ALERT_RULES } from '../../src/alerts/starter-rules';
import { createInMemoryAlertsPrisma } from '../../src/alerts/testing/index';
import { discoverAlertsRoutes } from '../../src/alerts/testing/index';

registerBuiltinAlertKinds();

const body = (extra = {}) => createAlertRuleSchema.parse({ name: 'Rule A', kind: ALERT_KIND_IDS.VERDICT, severity: 'critical', config: { minLevel: 'critical' }, ...extra });
const UUID = '11111111-1111-4111-8111-111111111111';

describe('AlertsRulesService', () => {
  it('creates a disabled rule with a parsed config, and refuses an unknown kind or a bad config', async () => {
    const service = new AlertsRulesService(createInMemoryAlertsPrisma());
    const rule = await service.create(body(), 'user-1');
    expect(rule).toMatchObject({ enabled: false, starter: false, createdById: 'user-1', openIncidents: 0 });
    await expect(service.create(body({ kind: 'nope' }), null)).rejects.toMatchObject({ response: { details: { reason: ALERT_ERROR_CODES.UNKNOWN_KIND } } });
    await expect(service.create(body({ config: { minLevel: 'healthy' } }), null)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(body({ config: { minLevel: 'critical', extra: 1 } }), null)).rejects.toMatchObject({ response: { details: { reason: ALERT_ERROR_CODES.INVALID_CONFIG } } });
  });

  it('404s an unknown rule on get, update, delete', async () => {
    const service = new AlertsRulesService(createInMemoryAlertsPrisma());
    for (const call of [() => service.get(UUID), () => service.update(UUID, { enabled: true }), () => service.remove(UUID)]) {
      await expect(call()).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('re-validates a new config against the stored kind', async () => {
    const service = new AlertsRulesService(createInMemoryAlertsPrisma());
    const rule = await service.create(body(), null);
    await expect(service.update(rule.id, { config: { minLevel: 'nope' } })).rejects.toBeInstanceOf(BadRequestException);
    expect((await service.update(rule.id, { config: { minLevel: 'degraded' } })).config).toEqual({ minLevel: 'degraded' });
  });

  it('closes open incidents silently when a rule is disabled', async () => {
    const prisma = createInMemoryAlertsPrisma();
    const service = new AlertsRulesService(prisma);
    const rule = prisma.addRule({ kind: ALERT_KIND_IDS.VERDICT, config: { minLevel: 'critical' } });
    const base = { ruleId: rule.id, severity: 'warning', lastSeenAt: new Date(), summary: 's', labels: {} };
    prisma.incidents.push({ ...base, id: 'a', labelsKey: 'a', state: 'firing' } as never, { ...base, id: 'b', labelsKey: 'b', state: 'pending' } as never);
    const updated = await service.update(rule.id, { enabled: false });
    expect(updated.openIncidents).toBe(0);
    expect(prisma.incidents.map((i) => [i.id, i.state])).toEqual([['a', 'resolved']]);
  });

  it('refuses to delete a starter rule (409) but deletes an own rule with its incidents', async () => {
    const prisma = createInMemoryAlertsPrisma();
    const service = new AlertsRulesService(prisma);
    const starter = prisma.addRule({ kind: ALERT_KIND_IDS.VERDICT, key: 'telemetry.verdict_critical' });
    await expect(service.remove(starter.id)).rejects.toBeInstanceOf(ConflictException);
    const own = prisma.addRule({ kind: ALERT_KIND_IDS.VERDICT });
    prisma.incidents.push({ id: 'x', ruleId: own.id, labelsKey: '', state: 'firing' } as never);
    await service.remove(own.id);
    expect(prisma.rules.map((r) => r.id)).toEqual([starter.id]);
    expect(prisma.incidents).toHaveLength(0);
  });
});

describe('AlertsIncidentsService', () => {
  it('lists with filters and paging, 404s an unknown incident and acknowledges idempotently', async () => {
    const prisma = createInMemoryAlertsPrisma();
    const service = new AlertsIncidentsService(prisma);
    const rule = prisma.addRule({ kind: ALERT_KIND_IDS.VERDICT, name: 'Verdict' });
    const row = (id: string, state: string, severity: string, day: number) =>
      ({ id, ruleId: rule.id, labelsKey: id, labels: {}, state, severity, lastSeenAt: new Date(), summary: 's', createdAt: new Date(2026, 0, day), pendingSince: null, firedAt: null, resolvedAt: null, lastValue: null, acknowledgedAt: null, acknowledgedById: null }) as never;
    prisma.incidents.push(row('a', 'firing', 'critical', 1), row('b', 'resolved', 'warning', 2), row('c', 'firing', 'warning', 3));
    const page = await service.list({ page: 1, pageSize: 2, state: 'firing' });
    expect(page).toMatchObject({ total: 2, totalPages: 1, page: 1, pageSize: 2 });
    expect(page.items.map((i) => [i.id, i.ruleName])).toEqual([['c', 'Verdict'], ['a', 'Verdict']]);
    await expect(service.get(UUID)).rejects.toBeInstanceOf(NotFoundException);
    const first = await service.acknowledge('a', 'u1');
    const second = await service.acknowledge('a', 'u2');
    expect([first.acknowledgedById, second.acknowledgedById]).toEqual(['u1', 'u1']);
    expect(await service.summary()).toEqual({ firing: { critical: 1, warning: 1, info: 0 }, lastEvaluatedAt: null });
  });
});

describe('AlertsAdminController', () => {
  it('declares every route behind exactly alerts:read (GET) or alerts:write, none public', () => {
    const routes = discoverAlertsRoutes();
    expect(routes.length).toBe(11);
    for (const route of routes) {
      expect(route.isPublic).toBe(false);
      expect(route.authenticated).toBe(true);
      expect(route.permissions).toEqual([route.method === 'GET' ? 'alerts:read' : 'alerts:write']);
    }
  });

  it('the dry run reports a failing kind in the body and stores nothing', async () => {
    const prisma = createInMemoryAlertsPrisma();
    const rules = new AlertsRulesService(prisma);
    const evaluation = { observe: jest.fn().mockRejectedValue(new Error('the store is down')) };
    const controller = new AlertsAdminController(rules, new AlertsIncidentsService(prisma), evaluation as never);
    const rule = prisma.addRule({ kind: ALERT_KIND_IDS.VERDICT, config: { minLevel: 'critical' } });
    const result = await controller.testRule(rule.id);
    expect(result).toMatchObject({ ruleId: rule.id, observations: [], error: 'the store is down' });
    expect(prisma.rules[0].lastEvaluatedAt).toBeNull();
    await expect(controller.testRule(UUID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists the registered kinds with a JSON Schema of each config', () => {
    const controller = new AlertsAdminController({} as never, {} as never, {} as never);
    const kinds = controller.listKinds();
    expect(kinds.map((k) => k.id)).toEqual(expect.arrayContaining(Object.values(ALERT_KIND_IDS)));
    const metric = kinds.find((k) => k.id === 'metric_threshold')!;
    expect(metric.builtin).toBe(true);
    expect(metric.configSchema).toMatchObject({ type: 'object', required: expect.arrayContaining(['metric', 'threshold']) });
    expect(kinds.find((k) => k.id === 'node_event')!.eventDriven).toBe(true);
  });
});

describe('AlertsSeedService', () => {
  it('seeds every starter rule disabled, once, and never overwrites an edit', async () => {
    const prisma = createInMemoryAlertsPrisma();
    const seed = new AlertsSeedService(prisma, resolveAlertsModuleOptions());
    expect(await seed.seed()).toBe(STARTER_ALERT_RULES.length);
    expect(prisma.rules.every((r) => !r.enabled && r.key)).toBe(true);
    prisma.rules[0].enabled = true;
    prisma.rules[0].config = { ...(prisma.rules[0].config as object), edited: true };
    expect(await seed.seed()).toBe(0);
    expect(prisma.rules[0].enabled).toBe(true);
    expect(prisma.rules[0].config).toMatchObject({ edited: true });
  });

  it('does nothing when seeding is switched off', async () => {
    const prisma = createInMemoryAlertsPrisma();
    await new AlertsSeedService(prisma, resolveAlertsModuleOptions({ seedStarterRules: false })).onApplicationBootstrap();
    expect(prisma.rules).toHaveLength(0);
  });
});

describe('handlers and listener', () => {
  it('the listener only enqueues a job per event, without dedup', () => {
    const enqueue = jest.fn().mockResolvedValue({});
    new AlertsEventListener({ enqueue } as never).handleNodeEvent({
      nodeId: 'n1', nodeName: 'node-a', ownerUserId: null, type: 'power.battery_low', severity: 'warning', attrs: { batteryPercent: 9 }, occurredAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: 'alerts.evaluate_event', orgId: null, skipDedup: true, payload: expect.objectContaining({ nodeId: 'n1', type: 'power.battery_low' }) }));
  });

  it('the listener swallows an enqueue failure', async () => {
    const enqueue = jest.fn().mockRejectedValue(new Error('db down'));
    expect(() => new AlertsEventListener({ enqueue } as never).handleNodeEvent({ nodeId: 'n', nodeName: 'n', ownerUserId: null, type: 't', severity: 'info', attrs: {}, occurredAt: new Date() })).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });

  it('the event handler passes the payload to the evaluation, and drops a malformed one', async () => {
    const evaluateEnabled = jest.fn().mockResolvedValue([]);
    const handler = new AlertsEvaluateEventHandler({ register: jest.fn() } as never, { evaluateEnabled } as never);
    await handler.process({ id: 'j', payload: { nodeId: 'n1', type: 'power.battery_low', attrs: {} } } as never);
    expect(evaluateEnabled).toHaveBeenCalledWith({ event: expect.objectContaining({ nodeId: 'n1', type: 'power.battery_low' }) });
    await handler.process({ id: 'j2', payload: null } as never);
    expect(evaluateEnabled).toHaveBeenCalledTimes(1);
  });

  it('every handler is server-only and declares a profile', () => {
    const evaluate = new AlertsEvaluateEventHandler({} as never, {} as never);
    expect(evaluate.profile).toEqual({ maxRuntimeMs: 60_000, maxAttempts: 1 });
    for (const handler of [evaluate, new AlertsIncidentsPurgeHandler({} as never, {} as never, resolveAlertsModuleOptions())]) {
      expect((handler as { nodeResultSchema?: unknown }).nodeResultSchema).toBeUndefined();
      expect((handler as { persistNodeResult?: unknown }).persistNodeResult).toBeUndefined();
    }
  });

  it('the purge removes only resolved incidents past the retention', async () => {
    const prisma = createInMemoryAlertsPrisma();
    const old = new Date(Date.now() - 100 * 86_400_000);
    const recent = new Date(Date.now() - 86_400_000);
    prisma.incidents.push(
      { id: 'old', state: 'resolved', resolvedAt: old } as never,
      { id: 'new', state: 'resolved', resolvedAt: recent } as never,
      { id: 'open', state: 'firing', resolvedAt: null } as never,
    );
    await new AlertsIncidentsPurgeHandler({} as never, prisma, resolveAlertsModuleOptions({ incidentRetentionDays: 90 })).process({ id: 'j' } as never);
    expect(prisma.incidents.map((i) => i.id)).toEqual(['new', 'open']);
  });
});

describe('module options', () => {
  it('defaults and validates', () => {
    expect(resolveAlertsModuleOptions()).toMatchObject({ evaluateTask: true, purgeTask: true, incidentRetentionDays: 90, evaluationBudgetMs: 20_000, seedStarterRules: true });
    expect(resolveAlertsModuleOptions({ tasks: { evaluate: false } }).evaluateTask).toBe(false);
    expect(() => resolveAlertsModuleOptions({ incidentRetentionDays: 0 })).toThrow(/incidentRetentionDays/);
    expect(() => resolveAlertsModuleOptions({ evaluationBudgetMs: 10 })).toThrow(/evaluationBudgetMs/);
  });
});
