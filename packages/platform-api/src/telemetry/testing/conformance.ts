// =============================================================================
// The telemetry slice's conformance suite (PP-4.6)
// =============================================================================
//
// "Conformance suites travel with packages" (docs/specs/platform-packages.md):
// the slice's invariants used to be enforced by tests that live in the
// platform repository, so an app that consumed the package stopped being
// checked. This suite is those invariants as a registered
// `ConformanceSuite`, run in every app through `runPlatformConformance()`:
//
//   1  metric groups       every registered group is well formed, and computes
//                          against an empty schema with everything `skipped`
//   2  route permissions   every route declares exactly its permissions
//   3  doctor read-only    no telemetry Doctor check can write, enqueue or audit
//   4  no secrets          the connection and config responses never carry a
//                          stored password
//   5  queue rule          the app's cron scan covers the slice's cron
//   6  boot without store  the module boots with no GreptimeDB and every
//                          dashboard route answers its documented response
//
// EVERYTHING IS DISCOVERED, nothing is a hand-kept list of routes, groups or
// checks: groups from `metricGroupRegistry`, routes from the Nest metadata of
// the controllers `TelemetryModule.forRoot` builds, Doctor checks from the
// providers that inject the `DoctorCheckRegistry`. The expectations below are
// rules (a permission per route SHAPE) so a new route that matches no rule is
// itself a finding.
//
// Check 7 (web/API permission parity) runs in the web test suite
// (`apps/web/src/__tests__/config/telemetryParity.test.ts`) and check 8 (infra
// drift) is `platform-infra sync --check` in CI.
//
// Each check is also an exported function over its input, so the package proves
// it FAILS on a deliberately broken fixture (`test/telemetry/conformance.spec.ts`).
// =============================================================================

import { Module, RequestMethod, type DynamicModule, type Type } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TELEMETRY_CONNECTION_CARRIES_NO_SECRET } from '@marinoscar/platform-contract/telemetry';

import { DoctorCheckRegistry, DoctorModule } from '../../doctor/index';
import {
  TEST_PERMISSIONS_HEADER,
  TEST_REQUIRED_PERMISSIONS_KEY,
  conformanceSuites,
  createTestPlatformHost,
  cronEnqueueOnlySuite,
} from '../../testing/index';
import type { ConformanceCase, ConformanceFinding, ConformanceReport, ConformanceSuite } from '../../testing/index';
import { TelemetryAiEnabledGuard } from '../assistant/telemetry-ai-enabled.guard';
import { TelemetryConnectionTestService } from '../connection/telemetry-connection-test.service';
import { TelemetryDashboardService } from '../dashboard/telemetry-dashboard.service';
import { TELEMETRY_AUDIT_SINK, TELEMETRY_JOBS } from '../ports';
import { TELEMETRY_ERROR_REASONS } from '../query/telemetry-query.errors';
import { TELEMETRY_HOST_PERMISSIONS, TELEMETRY_PERMISSIONS } from '../telemetry.permissions';
import { TelemetryModule } from '../telemetry.module';
import { computeMetricGroup, type MetricGroupResult } from '../metrics/metric-group';
import { METRIC_UNITS } from '../metrics/metric-catalog.helpers';
import { METRIC_FILTER_COLUMNS } from '../metrics/metric-catalog.helpers';
import { metricTablesOf, type MetricGroup } from '../metrics/metric-catalog';
import { METRIC_GROUP_ID_PATTERN, metricGroupRegistry, type MetricGroupDef } from '../metrics/metric-group.registry';
import { createStubTelemetryPorts, type StubTelemetryPortsOptions } from './stub-ports';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The telemetry slice's suite: its options, or `false` to opt out. Registered by importing `@marinoscar/platform-api/telemetry/testing`. */
    telemetry?: TelemetryConformanceOptions | false;
  }
}

/**
 * What an app passes as `suites.telemetry` to `runPlatformConformance()`. Both
 * options are optional: without them the suite checks every metric group in
 * `metricGroupRegistry` and skips the cron coverage.
 *
 * @example
 * ```ts
 * import '../../src/platform/telemetry/telemetry.config'; // registers the app's metric groups
 * runPlatformConformance({
 *   sourceRoots: [join(__dirname, '../../src')],
 *   suites: { telemetry: { cronSourceRoots: CRON_SOURCE_ROOTS } },
 * });
 * ```
 *
 * @stability experimental
 */
export interface TelemetryConformanceOptions {
  /**
   * The metric groups to check. Default: every group in `metricGroupRegistry`
   * (the platform's six plus whatever the app registered when its module
   * code ran: import the module that calls `TelemetryModule.forRoot` first).
   */
  metricGroups?: readonly MetricGroupDef[];
  /**
   * The roots the app's `cron-enqueue-only` suite scans. When given, the
   * telemetry retention cron (`tasks/telemetry-retention.task.ts`) must be
   * inside them, so the queue rule is enforced on the slice's own cron.
   */
  cronSourceRoots?: readonly string[];
}

const FILE_GROUPS = 'metric-groups';
const FILE_ROUTES = 'routes';
const FILE_DOCTOR = 'doctor';
const FILE_CRON = 'cron';
const FILE_SECRETS = 'no-secrets';
const FILE_BOOT = 'boot';

const finding = (file: string, message: string): ConformanceFinding => ({ file, message });
const lines = (findings: readonly ConformanceFinding[]): string[] => findings.map((f) => `${f.file}: ${f.message}`);

// ---- check 1: metric groups ---------------------------------------------------------

/**
 * Check 1, static half: every group has a unique id matching
 * {@link METRIC_GROUP_ID_PATTERN} and a non-empty label; family, ratio and table
 * keys are unique across groups; every unit is in `METRIC_UNITS`; every filter
 * key is a `METRIC_FILTER_COLUMNS` key; every entry names the group that holds it.
 *
 * @param groups - the groups to check.
 * @returns the violations; empty means conformant.
 *
 * @stability experimental
 */
export function checkMetricGroups(groups: readonly MetricGroupDef[]): ConformanceFinding[] {
  const out: ConformanceFinding[] = [];
  const units = new Set<string>(METRIC_UNITS);
  const filters = new Set<string>(Object.keys(METRIC_FILTER_COLUMNS));
  const ids = new Map<string, number>();
  const keys = new Map<string, string>();

  for (const group of groups) {
    const where = `group "${group.id}"`;
    ids.set(group.id, (ids.get(group.id) ?? 0) + 1);
    if (typeof group.id !== 'string' || !METRIC_GROUP_ID_PATTERN.test(group.id)) {
      out.push(finding(FILE_GROUPS, `${where}: id must match ${METRIC_GROUP_ID_PATTERN}`));
    }
    if (typeof group.label !== 'string' || group.label.trim() === '') out.push(finding(FILE_GROUPS, `${where}: label is empty`));

    const entries: Array<{ kind: string; key: string; group: string; units: readonly string[]; filters: readonly string[] }> = [
      ...group.families.map((f) => ({ kind: 'family', key: f.key, group: f.group, units: [f.unit], filters: f.filters })),
      ...(group.ratios ?? []).map((r) => ({ kind: 'ratio', key: r.key, group: r.group, units: [r.unit], filters: [] as string[] })),
      ...(group.tables ?? []).map((t) => ({
        kind: 'table',
        key: t.key,
        group: t.group,
        units: [...t.parts.map((p) => p.unit), ...(t.derived ?? []).map((d) => d.unit)],
        filters: t.filters,
      })),
    ];
    for (const entry of entries) {
      const name = `${where}: ${entry.kind} "${entry.key}"`;
      const owner = keys.get(entry.key);
      if (owner !== undefined) out.push(finding(FILE_GROUPS, `${name} key is already used by group "${owner}"; keys are unique across groups`));
      keys.set(entry.key, group.id);
      if (entry.group !== group.id) out.push(finding(FILE_GROUPS, `${name} declares group "${entry.group}"`));
      for (const unit of entry.units) {
        if (!units.has(unit)) out.push(finding(FILE_GROUPS, `${name} has unit "${unit}"; expected one of METRIC_UNITS`));
      }
      for (const filter of entry.filters) {
        if (!filters.has(filter)) out.push(finding(FILE_GROUPS, `${name} has filter "${filter}"; expected one of ${[...filters].join(', ')}`));
      }
    }
  }
  for (const [id, count] of ids) {
    if (count > 1) out.push(finding(FILE_GROUPS, `group id "${id}" is declared ${count} times`));
  }
  return out;
}

/** What {@link checkMetricGroupsOnEmptySchema} runs per group; `computeMetricGroup` by default. */
export type ComputeMetricGroup = (group: string) => Promise<Pick<MetricGroupResult, 'available' | 'tiles' | 'series' | 'tables' | 'skipped'>>;

/**
 * Check 1, dynamic half: every group computes against an EMPTY schema (the
 * store has no metric table) without throwing, reporting everything in
 * `skipped` and nothing as a tile, series or table. A group that errors, or one
 * that renders a number out of nothing, would break the dashboard of a fresh stack.
 *
 * @param groups - the groups; each must be registered in `metricGroupRegistry` (the computation reads it).
 * @param compute - what runs one group; default `computeMetricGroup` with an empty schema. A test passes a broken one.
 * @returns the violations; empty means conformant.
 *
 * @stability experimental
 */
export async function checkMetricGroupsOnEmptySchema(
  groups: readonly MetricGroupDef[],
  compute: ComputeMetricGroup = (id) =>
    computeMetricGroup({
      group: id as MetricGroup,
      window: { from: new Date(0), to: new Date(3_600_000), previousFrom: new Date(-3_600_000), bucketSeconds: 60 },
      filters: {},
      tables: metricTablesOf({ tables: [] }),
      runner: { maybe: async () => null },
      now: new Date(3_600_000),
    }),
): Promise<ConformanceFinding[]> {
  const out: ConformanceFinding[] = [];
  for (const group of groups) {
    const where = `group "${group.id}"`;
    let result: Awaited<ReturnType<ComputeMetricGroup>>;
    try {
      result = await compute(group.id);
    } catch (error) {
      out.push(finding(FILE_GROUPS, `${where}: computing against an empty schema threw: ${(error as Error).message}`));
      continue;
    }
    if (result.available) out.push(finding(FILE_GROUPS, `${where}: reports available with no metric table in the store`));
    if (result.tiles.length + result.series.length + result.tables.length > 0) {
      out.push(finding(FILE_GROUPS, `${where}: renders tiles, series or tables with no metric table in the store`));
    }
    const skipped = new Set(result.skipped);
    const keys = [...group.families.map((f) => f.key), ...(group.ratios ?? []).map((r) => r.key), ...(group.tables ?? []).map((t) => t.key)];
    for (const key of keys) {
      if (!skipped.has(key)) out.push(finding(FILE_GROUPS, `${where}: "${key}" is not reported in skipped with no metric table in the store`));
    }
  }
  return out;
}

// ---- check 2: route permissions ----------------------------------------------------

/**
 * One route of a controller, read from the Nest metadata.
 *
 * @stability experimental
 */
export interface TelemetryRoute {
  /** The HTTP method (`GET`, `PUT`, ...). */
  method: string;
  /** The path without leading or trailing slash, controller prefix included. */
  path: string;
  /** The permissions its access decorator recorded, or `undefined` when it has none (a public route). */
  permissions: readonly string[] | undefined;
  /** The guard classes on the handler and its controller. */
  guards: readonly unknown[];
  /** The handler function, for reading further metadata (a route's documented query parameters). */
  handler: unknown;
}

const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, '');

/**
 * Every route of `controllers`, from `@Controller`/`@Get`/... metadata and the
 * permissions recorded by the package's test host (`createTestPlatformHost`).
 *
 * @param controllers - controller classes, e.g. `TelemetryModule.forRoot(...).controllers`.
 * @returns the routes, in declaration order.
 *
 * @stability experimental
 */
export function discoverRoutes(controllers: readonly Type<unknown>[]): TelemetryRoute[] {
  const routes: TelemetryRoute[] = [];
  for (const controller of controllers) {
    const prefix = trimSlashes(String(Reflect.getMetadata(PATH_METADATA, controller) ?? ''));
    const controllerGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = (controller.prototype as Record<string, unknown>)[name];
      if (typeof handler !== 'function' || !Reflect.hasMetadata(METHOD_METADATA, handler)) continue;
      const own = trimSlashes(String(Reflect.getMetadata(PATH_METADATA, handler) ?? ''));
      routes.push({
        method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number] ?? 'UNKNOWN',
        path: [prefix, own].filter(Boolean).join('/'),
        permissions: Reflect.getMetadata(TEST_REQUIRED_PERMISSIONS_KEY, handler) as string[] | undefined,
        guards: [...controllerGuards, ...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined) ?? [])],
        handler,
      });
    }
  }
  return routes;
}

const { READ, WRITE, QUERY } = TELEMETRY_PERMISSIONS;
const { AI_USE, SYSTEM_SETTINGS_READ, SYSTEM_SETTINGS_WRITE } = TELEMETRY_HOST_PERMISSIONS;

/**
 * The permissions each route SHAPE must declare. A rule per shape, not per
 * path: the routes are discovered, and one that matches no rule is a finding.
 */
const ROUTE_RULES: ReadonlyArray<{ shape: RegExp; permissions: readonly string[]; guard?: unknown }> = [
  { shape: /^(GET) admin\/telemetry\/(config|status)$/, permissions: [READ] },
  { shape: /^PUT admin\/telemetry\/config$/, permissions: [WRITE] },
  { shape: /^(POST) admin\/telemetry\/(query|export)$/, permissions: [QUERY] },
  { shape: /^GET admin\/telemetry\/schema$/, permissions: [QUERY] },
  { shape: /^GET admin\/telemetry\/dashboard\/[a-z-]+$/, permissions: [QUERY] },
  { shape: /^GET admin\/telemetry\/connection$/, permissions: [READ] },
  { shape: /^(PUT|DELETE) admin\/telemetry\/connection$/, permissions: [WRITE] },
  { shape: /^POST admin\/telemetry\/connection\/test$/, permissions: [WRITE] },
  { shape: /^GET admin\/telemetry\/stack$/, permissions: [SYSTEM_SETTINGS_READ] },
  { shape: /^POST admin\/telemetry\/stack\/deploy$/, permissions: [SYSTEM_SETTINGS_WRITE] },
  { shape: /^POST admin\/telemetry\/assistant\/stream$/, permissions: [QUERY, AI_USE], guard: TelemetryAiEnabledGuard },
  // `@Auth()` only: any signed-in user may ask whether telemetry is on.
  { shape: /^GET telemetry\/config$/, permissions: [] },
];

/** Every permission string the slice may enforce: exactly these, never a variant. */
const KNOWN_PERMISSIONS = new Set<string>([...Object.values(TELEMETRY_PERMISSIONS), ...Object.values(TELEMETRY_HOST_PERMISSIONS)]);

/**
 * Check 2: every route under `admin/telemetry` and `telemetry` declares exactly
 * the permissions its shape requires (the table in the slice README, heading
 * "Permissions and settings"), every permission is one of the slice's exact
 * strings, no route is public, the assistant route sits behind the AI-enabled
 * guard, and every rule matches at least one route (a renamed route fails here
 * rather than silently dropping out of the check).
 *
 * @param routes - the routes, from {@link discoverRoutes}.
 * @returns the violations; empty means conformant.
 *
 * @stability experimental
 */
export function checkRoutePermissions(routes: readonly TelemetryRoute[]): ConformanceFinding[] {
  const out: ConformanceFinding[] = [];
  const matched = new Set<RegExp>();

  for (const route of routes) {
    const name = `${route.method} /${route.path}`;
    if (!/^(admin\/)?telemetry(\/|$)/.test(route.path)) {
      out.push(finding(FILE_ROUTES, `${name}: a route outside admin/telemetry and telemetry in the telemetry module`));
      continue;
    }
    if (route.permissions === undefined) {
      out.push(finding(FILE_ROUTES, `${name}: declares no access decorator, so it is public`));
      continue;
    }
    for (const permission of route.permissions) {
      if (!KNOWN_PERMISSIONS.has(permission)) out.push(finding(FILE_ROUTES, `${name}: enforces "${permission}", which is not a telemetry permission string`));
    }
    const rule = ROUTE_RULES.find((candidate) => candidate.shape.test(`${route.method} ${route.path}`));
    if (!rule) {
      out.push(finding(FILE_ROUTES, `${name}: matches no permission rule; add the route's shape to the conformance suite`));
      continue;
    }
    matched.add(rule.shape);
    const actual = [...route.permissions].sort().join(', ');
    const expected = [...rule.permissions].sort().join(', ');
    if (actual !== expected) {
      out.push(finding(FILE_ROUTES, `${name}: declares [${actual}] but must declare [${expected}]`));
    }
    if (rule.guard && !route.guards.includes(rule.guard)) {
      out.push(finding(FILE_ROUTES, `${name}: is not behind ${(rule.guard as { name: string }).name}`));
    }
  }
  for (const rule of ROUTE_RULES) {
    if (!matched.has(rule.shape)) out.push(finding(FILE_ROUTES, `no route matches ${rule.shape}: it was renamed or removed`));
  }
  return out;
}

// ---- check 3: the Doctor stays read-only --------------------------------------------

/** Constructor dependencies a Doctor check must never have (classes, and tokens injected with `@Inject`). */
const FORBIDDEN_DOCTOR_DEPENDENCIES: ReadonlyArray<{ dependency: unknown; why: string }> = [
  { dependency: TelemetryConnectionTestService, why: 'the connection test audits every attempt, and a Doctor run must not write' },
  { dependency: TelemetryDashboardService, why: 'its reads are audited' },
  { dependency: TELEMETRY_AUDIT_SINK, why: 'a check records no audit row' },
  { dependency: TELEMETRY_JOBS, why: 'a check enqueues no job' },
];

const nameOf = (dependency: unknown): string =>
  typeof dependency === 'function' ? dependency.name : String((dependency as symbol)?.description ?? dependency);

/**
 * The providers that register themselves as Doctor checks: classes with a
 * `run` method whose constructor injects the `DoctorCheckRegistry`.
 *
 * @param providers - a module's provider list, e.g. `TelemetryModule.forRoot(...).providers`.
 * @returns the check classes.
 *
 * @stability experimental
 */
export function discoverDoctorChecks(providers: readonly unknown[]): Array<Type<unknown>> {
  return providers.filter((provider): provider is Type<unknown> => {
    if (typeof provider !== 'function') return false;
    const params: unknown[] = Reflect.getMetadata('design:paramtypes', provider) ?? [];
    return typeof provider.prototype?.run === 'function' && params.includes(DoctorCheckRegistry);
  });
}

/**
 * Check 3: no Doctor check of the slice injects the audited connection test,
 * the audited dashboard service, the audit sink or the jobs port. The check
 * reads the constructor's `design:paramtypes` and `@Inject` tokens
 * (`self:paramtypes`).
 *
 * @param checks - the check classes, from {@link discoverDoctorChecks}.
 * @returns the violations; empty means conformant.
 *
 * @stability experimental
 */
export function checkDoctorReadOnly(checks: readonly Type<unknown>[]): ConformanceFinding[] {
  const out: ConformanceFinding[] = [];
  for (const check of checks) {
    const types: unknown[] = Reflect.getMetadata('design:paramtypes', check) ?? [];
    const tokens = ((Reflect.getMetadata('self:paramtypes', check) ?? []) as Array<{ param: unknown }>).map((entry) => entry.param);
    for (const { dependency, why } of FORBIDDEN_DOCTOR_DEPENDENCIES) {
      if (types.includes(dependency) || tokens.includes(dependency)) {
        out.push(finding(FILE_DOCTOR, `${check.name} injects ${nameOf(dependency)}: ${why}`));
      }
    }
  }
  return out;
}

// ---- check 5: the queue rule ---------------------------------------------------------

/** The slice's cron, relative to its source root. */
export const TELEMETRY_CRON_FILE = 'tasks/telemetry-retention.task.ts';

/**
 * Check 5: the app's `cron-enqueue-only` scan roots hold the slice's retention
 * cron, so the queue rule ("a `@Cron` only enqueues") is enforced on it. Runs
 * the cron suite's own scan over `roots` and looks for the file.
 *
 * @param roots - the roots the app's cron suite scans.
 * @returns the violations; empty means conformant.
 *
 * @stability experimental
 */
export function checkCronCoverage(roots: readonly string[]): ConformanceFinding[] {
  const report = cronEnqueueOnlySuite.check({ sourceRoots: roots }, { exempt: [], minCronFiles: 1 });
  const covered = report.scannedFiles.cronFiles?.some((file) => file === TELEMETRY_CRON_FILE || file.endsWith(`/${TELEMETRY_CRON_FILE}`));
  return covered
    ? []
    : [
        finding(
          FILE_CRON,
          `the cron scan roots do not contain ${TELEMETRY_CRON_FILE}: add the slice's source root (packages/platform-api/src/telemetry) to the cron-enqueue-only sourceRoots`,
        ),
      ];
}

// ---- checks 4 and 6: the module, booted ----------------------------------------------

/**
 * Boots the telemetry module on Fastify with the stub ports, for checks 4 and 6.
 *
 * @stability experimental
 */
export interface StubAppInput {
  /** What the credential and settings stores hold. */
  ports?: StubTelemetryPortsOptions;
  /** The `greptime` configuration namespace (the deployment default), or none. */
  greptime?: Record<string, unknown>;
}

/** Builds the app a booted check talks to; the default is {@link bootStubApp}. */
export type CreateConformanceApp = (input: StubAppInput) => Promise<NestFastifyApplication>;

/**
 * Boots `TelemetryModule.forRoot` with the stub ports, the package's test host,
 * the Doctor module and an `OTEL_ENABLED=false` configuration. Nothing listens
 * on a port; requests go through Fastify's `inject`.
 *
 * @param input - what the stubs and the configuration hold.
 * @returns the initialised application; the caller closes it.
 *
 * @stability experimental
 */
export const bootStubApp: CreateConformanceApp = async (input) => {
  const host = createTestPlatformHost();
  const { module } = createStubTelemetryPorts(input.ports);
  // Loaded here, not at the top, so importing this entry needs no Fastify adapter until a check boots the module.
  const { FastifyAdapter } = require('@nestjs/platform-fastify') as typeof import('@nestjs/platform-fastify');

  @Module({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => ({ otel: { enabled: false }, ...(input.greptime ? { greptime: input.greptime } : {}) })],
      }),
      DoctorModule.forRoot({ host, supportBundle: false }),
      TelemetryModule.forRoot({ host, imports: [module] }),
    ],
  })
  class ConformanceAppModule {}

  const app = await NestFactory.create<NestFastifyApplication>(ConformanceAppModule, new FastifyAdapter(), { logger: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
};

/** The passwords check 4 seeds. Distinctive on purpose: a substring match can only be the secret. */
export const CONFORMANCE_SECRETS = {
  storedReader: 'conformance-stored-reader-secret-7f3a',
  storedAdmin: 'conformance-stored-admin-secret-91c2',
  environmentReader: 'conformance-env-reader-secret-5d08',
  environmentAdmin: 'conformance-env-admin-secret-b64e',
} as const;

/**
 * Check 4: `GET /admin/telemetry/connection` and `GET /admin/telemetry/config`
 * never carry a stored password. Boots the module with known passwords in the
 * credential store (and in the `greptime` deployment default), a stored custom
 * connection row, and asserts none of the four appears in the serialised
 * responses. `TELEMETRY_CONNECTION_CARRIES_NO_SECRET` (the contract's
 * compile-time proof that the connection type has no field able to hold one)
 * must still be `true`.
 *
 * @param createApp - builds the app; default {@link bootStubApp}. A test passes a leaky one.
 * @returns the violations; empty means conformant.
 *
 * @stability experimental
 */
export async function checkNoSecretsInResponses(createApp: CreateConformanceApp = bootStubApp): Promise<ConformanceFinding[]> {
  const out: ConformanceFinding[] = [];
  if (TELEMETRY_CONNECTION_CARRIES_NO_SECRET !== true) {
    out.push(finding(FILE_SECRETS, 'TELEMETRY_CONNECTION_CARRIES_NO_SECRET is not true: the connection type can hold a secret'));
  }

  const app = await createApp({
    ports: {
      credentials: { reader: CONFORMANCE_SECRETS.storedReader, admin: CONFORMANCE_SECRETS.storedAdmin },
      rows: {
        telemetry_connection: { host: 'db.conformance.test', pgPort: 4003, database: 'public', readerUser: 'reader', adminUser: 'admin' },
      },
    },
    greptime: {
      host: 'greptimedb',
      pgPort: 4003,
      database: 'public',
      readerUser: 'reader',
      readerPassword: CONFORMANCE_SECRETS.environmentReader,
      adminUser: 'admin',
      adminPassword: CONFORMANCE_SECRETS.environmentAdmin,
      available: true,
    },
  });
  try {
    for (const url of ['/admin/telemetry/connection', '/admin/telemetry/config']) {
      const response = await app.inject({ method: 'GET', url, headers: { [TEST_PERMISSIONS_HEADER]: TELEMETRY_PERMISSIONS.READ } });
      if (response.statusCode !== 200) {
        out.push(finding(FILE_SECRETS, `GET ${url} answered ${response.statusCode}, not 200, so it proves nothing`));
        continue;
      }
      for (const [name, secret] of Object.entries(CONFORMANCE_SECRETS)) {
        if (response.body.includes(secret)) out.push(finding(FILE_SECRETS, `GET ${url} carries the ${name} password`));
      }
    }
  } finally {
    await app.close();
  }
  return out;
}

/** The query parameters a route requires, with a valid value each, from its `@ApiQuery` metadata. */
function requiredQuery(handler: unknown): Record<string, string> {
  const parameters = (Reflect.getMetadata('swagger/apiParameters', handler as object) ?? []) as Array<{
    name: string;
    in?: string;
    required?: boolean;
    enum?: unknown[];
    schema?: { enum?: unknown[] };
  }>;
  const query: Record<string, string> = {};
  for (const parameter of parameters) {
    if (parameter.in !== 'query' || !parameter.required) continue;
    query[parameter.name] = String((parameter.enum ?? parameter.schema?.enum ?? ['x'])[0]);
  }
  return query;
}

/**
 * Check 6: `TelemetryModule.forRoot` boots with `OTEL_ENABLED=false`, no
 * GreptimeDB and an empty configuration, and every dashboard route answers
 * with its documented response: `200` (a route that reads only memory) or `503`
 * with `details.reason` `TELEMETRY_NOT_CONFIGURED`. Never a `500`.
 *
 * @param createApp - builds the app; default {@link bootStubApp}.
 * @returns the violations; empty means conformant.
 *
 * @stability experimental
 */
export async function checkBootsWithoutTelemetry(createApp: CreateConformanceApp = bootStubApp): Promise<ConformanceFinding[]> {
  const out: ConformanceFinding[] = [];
  let app: NestFastifyApplication;
  try {
    app = await createApp({});
  } catch (error) {
    return [finding(FILE_BOOT, `TelemetryModule.forRoot did not boot without a telemetry store: ${(error as Error).message}`)];
  }
  try {
    const controllers = (stubModule().controllers ?? []) as Array<Type<unknown>>;
    const dashboard = controllers.find((controller) => Reflect.getMetadata(PATH_METADATA, controller) === 'admin/telemetry/dashboard');
    const routes = dashboard ? discoverRoutes([dashboard]).filter((route) => route.method === 'GET') : [];
    if (routes.length === 0) out.push(finding(FILE_BOOT, 'no dashboard route found to exercise'));

    for (const route of routes) {
      const response = await app.inject({
        method: 'GET',
        url: `/${route.path}`,
        query: requiredQuery(route.handler),
        headers: { [TEST_PERMISSIONS_HEADER]: TELEMETRY_PERMISSIONS.QUERY },
      });
      const body = (response.body ? safeJson(response.body) : undefined) as { details?: { reason?: string } } | undefined;
      const documented =
        response.statusCode === 200 ||
        (response.statusCode === 503 && body?.details?.reason === TELEMETRY_ERROR_REASONS.NOT_CONFIGURED);
      if (!documented) {
        out.push(finding(FILE_BOOT, `GET /${route.path} answered ${response.statusCode}${body?.details?.reason ? ` (${body.details.reason})` : ''} with no telemetry store; expected 200 or 503 TELEMETRY_NOT_CONFIGURED`));
      }
    }
  } finally {
    await app.close();
  }
  return out;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ---- the suite ------------------------------------------------------------------------

/** The module the sync checks inspect: the real routes and providers, the package's test host, no ports bound. */
function stubModule(): DynamicModule {
  return TelemetryModule.forRoot({ host: createTestPlatformHost(), imports: [] });
}

function check(_context: { sourceRoots: readonly string[] }, options: TelemetryConformanceOptions): ConformanceReport {
  const module = stubModule();
  const routes = discoverRoutes((module.controllers ?? []) as Array<Type<unknown>>);
  const doctorChecks = discoverDoctorChecks(module.providers ?? []);
  const groups = options.metricGroups ?? metricGroupRegistry.list();

  return {
    scanned: { metricGroups: groups.length, routes: routes.length, doctorChecks: doctorChecks.length },
    scannedFiles: {},
    findings: [
      ...checkMetricGroups(groups),
      ...checkRoutePermissions(routes),
      ...checkDoctorReadOnly(doctorChecks),
      ...(options.cronSourceRoots ? checkCronCoverage(options.cronSourceRoots) : []),
    ],
  };
}

const findingsIn = (report: ConformanceReport, file: string): string[] => lines(report.findings.filter((f) => f.file === file));

function cases(options: TelemetryConformanceOptions): ReadonlyArray<ConformanceCase> {
  return [
    {
      // The failure this guards: the discovery breaks and every case below passes over nothing.
      name: 'discovers the groups, routes and Doctor checks, so a broken scan cannot pass vacuously',
      run: (report, expect) => {
        expect(report.scanned.metricGroups).toBeGreaterThanOrEqual(6);
        expect(report.scanned.routes).toBeGreaterThanOrEqual(21);
        expect(report.scanned.doctorChecks).toBeGreaterThanOrEqual(5);
      },
    },
    {
      name: '1. every metric group has a unique id, a label, known units and filters, and unique keys',
      run: (report, expect) => expect(findingsIn(report, FILE_GROUPS)).toEqual([]),
    },
    {
      name: '1. every metric group computes against an empty schema with everything skipped',
      run: async (_report, expect) =>
        expect(lines(await checkMetricGroupsOnEmptySchema(options.metricGroups ?? metricGroupRegistry.list()))).toEqual([]),
    },
    {
      name: '2. every route declares exactly its permissions, and none is public',
      run: (report, expect) => expect(findingsIn(report, FILE_ROUTES)).toEqual([]),
    },
    {
      name: '3. no Doctor check can write, enqueue or audit',
      run: (report, expect) => expect(findingsIn(report, FILE_DOCTOR)).toEqual([]),
    },
    {
      name: '4. the connection and config responses never carry a stored password',
      run: async (_report, expect) => expect(lines(await checkNoSecretsInResponses())).toEqual([]),
    },
    ...(options.cronSourceRoots
      ? [
          {
            name: "5. the app's cron scan covers the telemetry retention cron",
            run: (report: ConformanceReport, expect: Parameters<ConformanceCase['run']>[1]) =>
              expect(findingsIn(report, FILE_CRON)).toEqual([]),
          } satisfies ConformanceCase,
        ]
      : [
          {
            name: '5. cron coverage: skipped, no cronSourceRoots given',
            run: () => undefined,
          } satisfies ConformanceCase,
        ]),
    {
      name: '6. boots without a telemetry store and every dashboard route answers its documented response',
      run: async (_report, expect) => expect(lines(await checkBootsWithoutTelemetry())).toEqual([]),
    },
  ];
}

/**
 * The suite behind `runPlatformConformance({ suites: { telemetry } })`: the
 * telemetry slice's invariants 1 to 6 (see this file's header). Registered in
 * {@link conformanceSuites} when `@marinoscar/platform-api/telemetry/testing`
 * is imported.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const telemetryConformanceSuite: ConformanceSuite<TelemetryConformanceOptions> = {
  id: 'telemetry',
  title: 'the telemetry slice keeps its invariants',
  description:
    'Metric groups are well formed and degrade to skipped, every route declares exactly its permissions, Doctor checks are read-only, responses carry no secret, the cron is enqueue-only, and the module boots without a store.',
  check,
  cases,
};

if (!conformanceSuites.has(telemetryConformanceSuite.id)) conformanceSuites.register(telemetryConformanceSuite);
