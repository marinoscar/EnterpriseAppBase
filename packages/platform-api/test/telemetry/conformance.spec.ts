import 'reflect-metadata';

import { join } from 'node:path';

import { Controller, Get, Inject, Injectable, Module, SetMetadata } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { DoctorCheckRegistry } from '../../src/doctor/index';
import { definePlatformHost } from '../../src/core/index';
import { TelemetryDashboardService } from '../../src/telemetry/dashboard/telemetry-dashboard.service';
import { TelemetryConnectionTestService } from '../../src/telemetry/connection/telemetry-connection-test.service';
import {
  TELEMETRY_AUDIT_SINK,
  TELEMETRY_JOBS,
  TelemetryModule,
  metricGroups,
  type MetricGroupDef,
} from '../../src/telemetry/index';
import {
  CONFORMANCE_SECRETS,
  TELEMETRY_CRON_FILE,
  bootStubApp,
  checkBootsWithoutTelemetry,
  checkCronCoverage,
  checkDoctorReadOnly,
  checkMetricGroups,
  checkMetricGroupsOnEmptySchema,
  checkNoSecretsInResponses,
  checkRoutePermissions,
  discoverDoctorChecks,
  discoverRoutes,
  telemetryConformanceSuite,
} from '../../src/telemetry/testing/index';
import { TEST_REQUIRED_PERMISSIONS_KEY, conformanceSuites, createTestPlatformHost, runPlatformConformance } from '../../src/testing/index';
import { emptySourceRoot, removeSourceRoots, writeSource } from '../support/conformance-harness';

// =============================================================================
// The telemetry conformance suite (PP-4.6)
// =============================================================================
//
// Two halves. First, the suite RUN against the slice itself, through the real
// `runPlatformConformance` (it is the platform repository's own app of it).
// Second, for each of checks 1 to 6, a DELIBERATELY BROKEN fixture the check
// must reject: a check that cannot fail would let an app silently stop being
// checked.
// =============================================================================

const SLICE_ROOT = join(__dirname, '..', '..', 'src', 'telemetry');

runPlatformConformance({
  sourceRoots: [SLICE_ROOT],
  suites: { telemetry: { cronSourceRoots: [SLICE_ROOT] } },
});

afterAll(removeSourceRoots);

const lines = (findings: Array<{ file: string; message: string }>): string[] => findings.map((f) => f.message);

/** A well-formed group the broken fixtures are bent from. */
const GOOD: MetricGroupDef = {
  id: 'activity_test',
  label: 'Activity',
  title: 'Activity',
  order: 90,
  description: 'a fixture',
  families: [
    {
      key: 'fixtureCounter',
      group: 'activity_test' as never,
      label: 'Counter',
      table: 'app_fixture_total',
      kind: 'counter',
      unit: 'count',
      rate: 'count',
      requiredColumns: [],
      filters: ['service', 'instance'],
    },
  ],
};

describe('the suite is registered when the telemetry testing entry is imported', () => {
  it('registers `telemetry` next to the platform suites, and the app spells its key `telemetry`', () => {
    expect(conformanceSuites.list().map((suite) => suite.id)).toEqual(
      expect.arrayContaining(['cron-enqueue-only', 'user-owned-data', 'telemetry']),
    );
    expect(telemetryConformanceSuite.id).toBe('telemetry');
  });
});

describe('check 1: metric groups', () => {
  it('accepts a well-formed group', () => {
    expect(checkMetricGroups([GOOD])).toEqual([]);
  });

  it.each([
    ['an id outside the pattern', { ...GOOD, id: 'Not-Valid' }, /id must match/],
    ['an empty label', { ...GOOD, label: '  ' }, /label is empty/],
    ['an unknown unit', { ...GOOD, families: [{ ...GOOD.families[0], unit: 'parsecs' }] }, /unit "parsecs"/],
    ['an unknown filter', { ...GOOD, families: [{ ...GOOD.families[0], filters: ['galaxy'] }] }, /filter "galaxy"/],
    ['a family that names another group', { ...GOOD, families: [{ ...GOOD.families[0], group: 'host' }] }, /declares group "host"/],
  ] as Array<[string, MetricGroupDef, RegExp]>)('rejects %s', (_name, group, message) => {
    expect(lines(checkMetricGroups([group])).join('\n')).toMatch(message);
  });

  it('rejects a duplicate group id and a family key two groups share', () => {
    const other = { ...GOOD, id: 'activity_other' };
    expect(lines(checkMetricGroups([GOOD, GOOD])).join('\n')).toMatch(/declared 2 times/);
    expect(lines(checkMetricGroups([GOOD, other])).join('\n')).toMatch(/key is already used by group "activity_test"/);
  });

  it('checks the registered groups against an empty schema: all skipped, none rendered', async () => {
    expect(await checkMetricGroupsOnEmptySchema(metricGroups())).toEqual([]);
  });

  it('rejects a group whose computation throws, or renders something out of nothing', async () => {
    const throws = await checkMetricGroupsOnEmptySchema([GOOD], async () => {
      throw new Error('boom');
    });
    expect(lines(throws).join('\n')).toMatch(/threw: boom/);

    const rendered = await checkMetricGroupsOnEmptySchema([GOOD], async () => ({
      available: true,
      tiles: [{ key: 'fixtureCounter', label: 'x', value: 1, previous: null, unit: 'count', sparkline: [] }],
      series: [],
      tables: [],
      skipped: [],
    }));
    const text = lines(rendered).join('\n');
    expect(text).toMatch(/reports available/);
    expect(text).toMatch(/renders tiles/);
    expect(text).toMatch(/"fixtureCounter" is not reported in skipped/);
  });
});

describe('check 2: route permissions', () => {
  const routesWith = (host: ReturnType<typeof definePlatformHost>) =>
    discoverRoutes((TelemetryModule.forRoot({ host, imports: [] }).controllers ?? []) as never);

  it('discovers the real routes from the Nest metadata and accepts them', () => {
    const routes = routesWith(createTestPlatformHost());
    expect(routes.length).toBeGreaterThanOrEqual(21);
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual(
      expect.arrayContaining(['GET admin/telemetry/config', 'PUT admin/telemetry/config', 'POST admin/telemetry/assistant/stream', 'GET telemetry/config']),
    );
    expect(checkRoutePermissions(routes)).toEqual([]);
  });

  it('rejects a route that declares the wrong permission (a write behind telemetry:read)', () => {
    const host = definePlatformHost({
      access: {
        requirePermissions: (permissions) =>
          SetMetadata(TEST_REQUIRED_PERMISSIONS_KEY, permissions.map((p) => (p === 'telemetry:write' ? 'telemetry:read' : p))),
        requireAuthenticated: () => SetMetadata(TEST_REQUIRED_PERMISSIONS_KEY, []),
      },
    });
    const messages = lines(checkRoutePermissions(routesWith(host)));
    expect(messages).toContain('PUT /admin/telemetry/config: declares [telemetry:read] but must declare [telemetry:write]');
    expect(messages.some((m) => m.startsWith('DELETE /admin/telemetry/connection'))).toBe(true);
  });

  it('rejects a public route, an invented permission and an extra permission', () => {
    const routes = routesWith(createTestPlatformHost());
    const [first, second, third] = routes;
    const broken = [
      { ...first, permissions: undefined },
      { ...second, permissions: ['telemetry:everything'] },
      { ...third, permissions: [...(third.permissions ?? []), 'telemetry:write'] },
      ...routes.slice(3),
    ];
    const messages = lines(checkRoutePermissions(broken)).join('\n');
    expect(messages).toMatch(/declares no access decorator, so it is public/);
    expect(messages).toMatch(/"telemetry:everything", which is not a telemetry permission string/);
    expect(messages).toMatch(/declares \[.*telemetry:write.*\] but must declare/);
  });

  it('rejects a route that matches no rule, and a rule no route matches any more', () => {
    const routes = routesWith(createTestPlatformHost());
    const extra = { method: 'GET', path: 'admin/telemetry/secrets', permissions: ['telemetry:read'], guards: [], handler: undefined };
    expect(lines(checkRoutePermissions([...routes, extra])).join('\n')).toMatch(/GET \/admin\/telemetry\/secrets: matches no permission rule/);
    expect(lines(checkRoutePermissions(routes.filter((route) => route.path !== 'admin/telemetry/stack'))).join('\n')).toMatch(/no route matches/);
  });

  it('rejects a route outside the telemetry prefixes and an assistant route without the AI guard', () => {
    const routes = routesWith(createTestPlatformHost());
    const unguarded = routes.map((route) => (route.path === 'admin/telemetry/assistant/stream' ? { ...route, guards: [] } : route));
    expect(lines(checkRoutePermissions(unguarded)).join('\n')).toMatch(/is not behind TelemetryAiEnabledGuard/);
    const outside = { method: 'GET', path: 'admin/users', permissions: [], guards: [], handler: undefined };
    expect(lines(checkRoutePermissions([...routes, outside])).join('\n')).toMatch(/outside admin\/telemetry and telemetry/);
  });
});

describe('check 3: the Doctor stays read-only', () => {
  it('finds the five real checks by what they inject, and accepts them', () => {
    const checks = discoverDoctorChecks(TelemetryModule.forRoot({ host: createTestPlatformHost(), imports: [] }).providers ?? []);
    expect(checks.map((check) => check.name).sort()).toEqual([
      'TelemetryConnectionDoctorCheck',
      'TelemetryExportDoctorCheck',
      'TelemetryFreshnessDoctorCheck',
      'TelemetryReachableDoctorCheck',
      'TelemetryTablesDoctorCheck',
    ]);
    expect(checkDoctorReadOnly(checks)).toEqual([]);
  });

  it('rejects a check that injects the audited connection test, the audit sink or the jobs port', () => {
    @Injectable()
    class WritingCheck {
      constructor(
        _registry: DoctorCheckRegistry,
        _test: TelemetryConnectionTestService,
        @Inject(TELEMETRY_AUDIT_SINK) _audit: unknown,
        @Inject(TELEMETRY_JOBS) _jobs: unknown,
      ) {}
      async run() {
        return { status: 'pass' as const };
      }
    }

    expect(discoverDoctorChecks([WritingCheck])).toEqual([WritingCheck]);
    const messages = lines(checkDoctorReadOnly([WritingCheck])).join('\n');
    expect(messages).toMatch(/WritingCheck injects TelemetryConnectionTestService/);
    expect(messages).toMatch(/WritingCheck injects @marinoscar\/platform\/telemetry\/AUDIT_SINK|WritingCheck injects .*AUDIT_SINK/);
    expect(messages).toMatch(/WritingCheck injects .*JOBS/);
  });
});

describe('check 4: no secret in a response', () => {
  it('accepts the real connection and config routes, seeded with known passwords', async () => {
    expect(await checkNoSecretsInResponses()).toEqual([]);
  });

  it('rejects an app whose connection route echoes a stored password', async () => {
    const leaky = async (): Promise<NestFastifyApplication> => {
      @Controller('admin/telemetry')
      class LeakyController {
        @Get('connection')
        connection() {
          return { host: 'db', readerPassword: CONFORMANCE_SECRETS.storedReader };
        }

        @Get('config')
        config() {
          return { adminPassword: CONFORMANCE_SECRETS.environmentAdmin };
        }
      }
      @Module({ controllers: [LeakyController] })
      class LeakyModule {}

      const app = await NestFactory.create<NestFastifyApplication>(LeakyModule, new FastifyAdapter(), { logger: false });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      return app;
    };

    const messages = lines(await checkNoSecretsInResponses(leaky)).join('\n');
    expect(messages).toMatch(/GET \/admin\/telemetry\/connection carries the storedReader password/);
    expect(messages).toMatch(/GET \/admin\/telemetry\/config carries the environmentAdmin password/);
  });

  it('rejects a check that proves nothing (a route that does not answer 200)', async () => {
    @Module({})
    class EmptyModule {}
    const empty = async (): Promise<NestFastifyApplication> => {
      const app = await NestFactory.create<NestFastifyApplication>(EmptyModule, new FastifyAdapter(), { logger: false });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      return app;
    };
    expect(lines(await checkNoSecretsInResponses(empty)).join('\n')).toMatch(/answered 404, not 200, so it proves nothing/);
  });
});

describe('check 5: the queue rule covers the slice cron', () => {
  it('accepts the real slice root', () => {
    expect(checkCronCoverage([SLICE_ROOT])).toEqual([]);
    expect(TELEMETRY_CRON_FILE).toBe('tasks/telemetry-retention.task.ts');
  });

  it('accepts a larger root that contains the slice (the app scans the repository)', () => {
    expect(checkCronCoverage([join(SLICE_ROOT, '..')])).toEqual([]);
  });

  it('rejects a scan list that does not contain the slice cron', () => {
    const root = emptySourceRoot();
    writeSource(root, 'jobs/tasks/other.task.ts', "@Cron('0 * * * *')\nrun() { this.jobs.enqueue('x'); }\n");
    expect(lines(checkCronCoverage([root])).join('\n')).toMatch(/do not contain tasks\/telemetry-retention\.task\.ts/);
  });
});

describe('check 6: boots without a telemetry store', () => {
  it('boots and answers every dashboard route as documented', async () => {
    expect(await checkBootsWithoutTelemetry()).toEqual([]);
  });

  it('rejects a module that does not boot without a store', async () => {
    const broken = async (): Promise<NestFastifyApplication> => {
      throw new Error('Nest could not find GreptimeClient');
    };
    expect(lines(await checkBootsWithoutTelemetry(broken)).join('\n')).toMatch(/did not boot without a telemetry store: Nest could not find GreptimeClient/);
  });

  it('rejects a route that crashes with no store (a 500 instead of 503 TELEMETRY_NOT_CONFIGURED)', async () => {
    const crashing = async (input: Parameters<typeof bootStubApp>[0]) => {
      const app = await bootStubApp(input);
      jest.spyOn(app.get(TelemetryDashboardService), 'summary').mockRejectedValue(new Error('boom'));
      return app;
    };

    const messages = lines(await checkBootsWithoutTelemetry(crashing)).join('\n');
    expect(messages).toMatch(/GET \/admin\/telemetry\/dashboard\/summary answered 500 with no telemetry store/);
    expect(messages).not.toMatch(/dashboard\/timeseries/);
  });
});
