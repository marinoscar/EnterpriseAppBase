import type { Type } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ALERT_KIND_IDS, ALERT_PERMISSIONS } from '@marinoscar/platform-contract/alerts';

import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../../identity/index';
import { conformanceSuites } from '../../testing/index';
import type { ConformanceCase, ConformanceFinding, ConformanceReport, ConformanceSuite } from '../../testing/index';
import { AlertsAdminController } from '../alerts-admin.controller';
import { AlertContextService } from '../alerts-context.service';
import { AlertsDispatchService } from '../alerts-dispatch.service';
import { AlertsEvaluationService } from '../alerts-evaluation.service';
import { AlertsSeedService } from '../alerts-seed.service';
import { ALERT_OPEN_INCIDENT_INDEX } from '../alerts.constants';
import { AlertsMetrics } from '../alerts.metrics';
import { resolveAlertsModuleOptions } from '../alerts.options';
import type { AlertRuleRow } from '../data/alerts-db';
import { alertRuleKindRegistry } from '../kinds/alert-kind.registry';
import { registerBuiltinAlertKinds } from '../kinds/builtin-kinds';
import { AlertsEventListener } from '../alerts-event.listener';
import { STARTER_ALERT_RULES } from '../starter-rules';
import { createInMemoryAlertsPrisma } from './fakes';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The alerts slice's suite: its options, or `false` to opt out. Registered by importing `@marinoscar/platform-api/alerts/testing`. */
    alerts?: AlertsConformanceOptions | false;
  }
}

/**
 * What the `alerts` suite takes: the app's data, never its code.
 *
 * @stability experimental
 */
export interface AlertsConformanceOptions {
  /** The names of the raw-SQL indexes the app's migrations install, so the suite proves the one-open-incident index is on the list. */
  readonly rawSqlIndexNames: readonly string[];
}

/**
 * One route of the slice, as the suite sees it.
 *
 * @stability experimental
 */
export interface AlertsRoute {
  /** `Controller#handler`. */
  readonly id: string;
  /** The HTTP method name. */
  readonly method: string;
  /** Whether it is `@Public()`. */
  readonly isPublic: boolean;
  /** Whether `@Auth(...)` put a guard on it. */
  readonly authenticated: boolean;
  /** The permissions it requires. */
  readonly permissions: readonly string[];
}

/**
 * The routes of the slice's controller, read from its metadata.
 *
 * @returns every handler.
 *
 * @stability experimental
 */
export function discoverAlertsRoutes(): AlertsRoute[] {
  const controller: Type<unknown> = AlertsAdminController;
  const prototype = controller.prototype as Record<string, unknown>;
  const routes: AlertsRoute[] = [];
  for (const name of Object.getOwnPropertyNames(prototype)) {
    const handler = prototype[name];
    if (name === 'constructor' || typeof handler !== 'function') continue;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    if (method === undefined || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
    const guards = [...((Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[]), ...((Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[])];
    routes.push({
      id: `${controller.name}#${name}`,
      method: RequestMethod[method] ?? String(method),
      isPublic: Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true || Reflect.getMetadata(IS_PUBLIC_KEY, controller) === true,
      authenticated: guards.length > 0,
      permissions: [...((Reflect.getMetadata(PERMISSIONS_KEY, handler) ?? []) as string[])],
    });
  }
  return routes;
}

/**
 * The static invariants of the slice, as findings.
 *
 * @param options - the suite's options.
 * @returns one finding per problem.
 *
 * @stability experimental
 */
export function checkAlertsStatic(options: AlertsConformanceOptions): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  for (const route of discoverAlertsRoutes()) {
    if (route.isPublic) findings.push({ file: route.id, message: 'no alerts route may be public' });
    if (!route.authenticated) findings.push({ file: route.id, message: 'declares no @Auth(...)' });
    const wanted = route.method === 'GET' ? ALERT_PERMISSIONS.READ : ALERT_PERMISSIONS.WRITE;
    if (route.permissions.length !== 1 || route.permissions[0] !== wanted) {
      findings.push({ file: route.id, message: `must require exactly ${wanted} (got ${route.permissions.join(', ') || 'none'})` });
    }
  }
  registerBuiltinAlertKinds();
  for (const id of Object.values(ALERT_KIND_IDS)) {
    if (!alertRuleKindRegistry.has(id)) findings.push({ file: 'kinds', message: `built-in kind ${id} is not registered` });
  }
  const seen = new Set<string>();
  for (const { key, rule } of STARTER_ALERT_RULES) {
    if (seen.has(key)) findings.push({ file: 'starter-rules', message: `duplicate starter key ${key}` });
    seen.add(key);
    if ('enabled' in rule && (rule as { enabled?: boolean }).enabled) findings.push({ file: 'starter-rules', message: `${key} must be seeded disabled` });
    const kind = alertRuleKindRegistry.get(rule.kind);
    if (!kind) findings.push({ file: 'starter-rules', message: `${key} uses unregistered kind ${rule.kind}` });
    else if (!kind.configSchema.safeParse(rule.config).success) findings.push({ file: 'starter-rules', message: `${key} has a config its kind refuses` });
  }
  if (!options.rawSqlIndexNames.includes(ALERT_OPEN_INCIDENT_INDEX)) {
    findings.push({ file: 'raw-sql-indexes', message: `${ALERT_OPEN_INCIDENT_INDEX} is not on the raw-SQL index list` });
  }
  for (const cls of [AlertsEvaluationService, AlertsDispatchService]) {
    if (/\$transaction|runInOrg/.test(cls.toString())) findings.push({ file: cls.name, message: 'must not open a transaction: a dispatch follows a committed write' });
  }
  if (/\b(fetch|spawn|exec|readFile|writeFile|\.download\(|\.upload\()\b/.test(AlertsEventListener.toString())) {
    findings.push({ file: 'AlertsEventListener', message: 'a node event listener only enqueues a job; it does no I/O of its own' });
  }
  return findings;
}

const STALE_NODE = { id: '11111111-1111-4111-8111-111111111111', name: 'node-a', status: 'online', lastHeartbeatAt: new Date(0) };

function rig() {
  const prisma = createInMemoryAlertsPrisma();
  prisma.nodes.push({ ...STALE_NODE });
  const metrics = new AlertsMetrics(prisma);
  const log: string[] = [];
  const notifications = {
    notifyPermissionHolders: async (event: string) => {
      log.push(`notify:${event}:${prisma.incidents.filter((i) => i.state === 'firing').length}`);
    },
  };
  const dispatcher = new AlertsDispatchService(metrics, notifications as never);
  const evaluation = new AlertsEvaluationService(prisma, new AlertContextService(prisma), dispatcher, resolveAlertsModuleOptions());
  return { prisma, evaluation, log };
}

/**
 * The `alerts` conformance suite.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const alertsConformanceSuite: ConformanceSuite<AlertsConformanceOptions> = {
  id: 'alerts',
  title: 'the alerts slice keeps its invariants',
  description:
    'every route requires exactly alerts:read (GET) or alerts:write and none is public, the built-in kinds and valid disabled starter rules exist, the one-open-incident index is on the raw-SQL list, nothing opens a transaction, an evaluation is idempotent, a dispatch follows the committed write, and seeding never overwrites an edit.',
  check(_context, options): ConformanceReport {
    const routes = discoverAlertsRoutes();
    return { scanned: { routes: routes.length }, scannedFiles: { routes: routes.map((r) => r.id) }, findings: checkAlertsStatic(options) };
  },
  cases(): ConformanceCase[] {
    return [
      {
        name: 'routes: authenticated, never public, exactly alerts:read / alerts:write',
        run: (report, expect) => {
          expect(report.findings.filter((f) => f.file.startsWith('AlertsAdminController'))).toEqual([]);
        },
      },
      {
        name: 'kinds and starter rules: built-ins registered, starter rules valid and disabled',
        run: (report, expect) => {
          expect(report.findings.filter((f) => f.file === 'kinds' || f.file === 'starter-rules')).toEqual([]);
        },
      },
      {
        name: 'data: the one-open-incident index is on the raw-SQL index list',
        run: (report, expect) => {
          expect(report.findings.filter((f) => f.file === 'raw-sql-indexes')).toEqual([]);
        },
      },
      {
        name: 'no transaction around a dispatch; the listener only enqueues',
        run: (report, expect) => {
          expect(report.findings.filter((f) => ['AlertsEvaluationService', 'AlertsDispatchService', 'AlertsEventListener'].includes(f.file))).toEqual([]);
        },
      },
      {
        name: 'evaluation is idempotent: two passes over the same data leave one incident',
        run: async (_report, expect) => {
          registerBuiltinAlertKinds();
          const { prisma, evaluation } = rig();
          const rule = prisma.addRule({ kind: ALERT_KIND_IDS.NODE_OFFLINE, config: {} });
          await evaluation.evaluateRule(rule as AlertRuleRow);
          await evaluation.evaluateRule(rule as AlertRuleRow);
          expect(prisma.incidents.filter((i) => i.state === 'firing').length).toEqual(1);
        },
      },
      {
        name: 'dispatch follows the committed write: the incident is firing when the notification is raised',
        run: async (_report, expect) => {
          registerBuiltinAlertKinds();
          const { prisma, evaluation, log } = rig();
          const rule = prisma.addRule({ kind: ALERT_KIND_IDS.NODE_OFFLINE, config: {} });
          await evaluation.evaluateRule(rule as AlertRuleRow);
          expect(log).toEqual(['notify:alerts.alert_fired:1']);
        },
      },
      {
        name: 'starter rules are seeded disabled and never overwrite an edit',
        run: async (_report, expect) => {
          registerBuiltinAlertKinds();
          const prisma = createInMemoryAlertsPrisma();
          const seed = new AlertsSeedService(prisma, resolveAlertsModuleOptions());
          expect(await seed.seed()).toEqual(STARTER_ALERT_RULES.length);
          expect(prisma.rules.filter((r) => r.enabled).length).toEqual(0);
          prisma.rules[0].enabled = true;
          prisma.rules[0].name = 'Edited by an administrator';
          expect(await seed.seed()).toEqual(0);
          expect([prisma.rules[0].enabled, prisma.rules[0].name]).toEqual([true, 'Edited by an administrator']);
        },
      },
    ];
  },
};

if (!conformanceSuites.has(alertsConformanceSuite.id)) conformanceSuites.register(alertsConformanceSuite);
