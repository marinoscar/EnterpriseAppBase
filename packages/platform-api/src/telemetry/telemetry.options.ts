// =============================================================================
// TelemetryModule.forRoot options (issue #703, PP-4.2; Extension Contract rung 1)
// =============================================================================
//
// What an app configures when it imports the telemetry slice:
//
//   host          the app's access decorators (`definePlatformHost`, issue
//                 #696): every packaged route is guarded by them, so a
//                 telemetry route authenticates and authorizes exactly as an
//                 app route does.
//   imports       the modules exporting the host-port providers (./ports.ts);
//                 the reference app passes its `TelemetryHostModule`.
//   metricGroups  extra dashboard metric groups, registered after the six
//                 platform groups.
//   actorId       how a route reads the caller's user id off the request
//                 (default: `request.requestUser.id ?? request.user.id`, the
//                 reference app's `@CurrentUser('id')`).
//   dashboard     `verdictThresholds`: deep-merged over
//                 `DEFAULT_VERDICT_THRESHOLDS` (zod-validated); `verdictPolicy`:
//                 what `VERDICT_POLICY` is bound to (rung 3; default
//                 `DefaultVerdictPolicy`).
//   metrics       `freshMs`: how much older than its table's newest reading a
//                 `last` cell (and an uptime check) may be and still count as
//                 current (default `METRIC_FRESH_MS`, 150 s).
//
// Validated once, in `forRoot`: a bad option fails boot with a message naming
// it.
// =============================================================================

import { createParamDecorator, type ExecutionContext, type ModuleMetadata } from '@nestjs/common';
import { z } from 'zod';

import { definePlatformHost, type PlatformHost, type PortBinding } from '../core/index';
import { DEFAULT_VERDICT_THRESHOLDS, type VerdictThresholds } from './dashboard/telemetry-dashboard.verdict';
import type { VerdictPolicy } from './dashboard/verdict-policy';
import { METRIC_FRESH_MS } from './metrics/metric-group';
import type { MetricGroupDef } from './metrics/metric-group.registry';

/**
 * A partial {@link VerdictThresholds}: any field, at any depth, may be left out
 * and keeps its default.
 *
 * @stability experimental
 */
export type VerdictThresholdsOverride = {
  -readonly [K in keyof VerdictThresholds]?: VerdictThresholds[K] extends object
    ? { -readonly [L in keyof VerdictThresholds[K]]?: VerdictThresholds[K][L] }
    : VerdictThresholds[K];
};

/**
 * The dashboard's options.
 *
 * @example
 * ```ts
 * TelemetryModule.forRoot({ host, imports, dashboard: { verdictThresholds: { noDataMinutes: 10 } } });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface TelemetryDashboardOptions {
  /** Deep-merged over `DEFAULT_VERDICT_THRESHOLDS`; validated at boot. */
  verdictThresholds?: VerdictThresholdsOverride;
  /** What `VERDICT_POLICY` is bound to; default `{ useClass: DefaultVerdictPolicy }`. Its own dependencies come from `imports`. */
  verdictPolicy?: PortBinding<VerdictPolicy>;
}

/**
 * The dashboard metric groups' options.
 *
 * @example
 * ```ts
 * TelemetryModule.forRoot({ host, imports, metrics: { freshMs: 300_000 } });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface TelemetryMetricsOptions {
  /**
   * The freshness window, in milliseconds: a per-key table cell read as `last`
   * (and an uptime check) older than its table's newest reading by more than
   * this is not current. A whole number from 1 000 (1 s) to 86 400 000 (24 h);
   * default `METRIC_FRESH_MS` (150 000, 150 s). Raise it when the app's
   * metrics export interval is longer than the default's 60 s.
   */
  freshMs?: number;
}

/**
 * Options of `TelemetryModule.forRoot()`.
 *
 * @example
 * ```ts
 * TelemetryModule.forRoot({ host: platformHost, imports: [TelemetryHostModule] });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface TelemetryModuleOptions {
  /** The app's access decorators (`definePlatformHost`); required: a platform route is never public. */
  host: PlatformHost;
  /** Modules that export the host-port providers (`TELEMETRY_AUDIT_SINK`, `TELEMETRY_SETTINGS_STORE`, ...): the app's adapters. */
  imports: NonNullable<ModuleMetadata['imports']>;
  /** Extra metric groups, registered after the six platform groups when `forRoot` runs. */
  metricGroups?: readonly MetricGroupDef[];
  /**
   * Reads the caller's user id off the framework request. Defaults to
   * `request.requestUser.id`, else `request.user.id`.
   *
   * @param request - the framework request.
   * @returns the user id, or `undefined` for an anonymous request (the access decorators refuse those first).
   */
  actorId?: (request: unknown) => string | undefined;
  /** The dashboard's verdict thresholds and policy. */
  dashboard?: TelemetryDashboardOptions;
  /** The dashboard metric groups' freshness window. */
  metrics?: TelemetryMetricsOptions;
}

/**
 * The options after validation and defaults, as the slice's providers and
 * controller factories receive them.
 *
 * @stability experimental
 */
export interface ResolvedTelemetryModuleOptions {
  /** The validated, frozen host. */
  readonly host: PlatformHost;
  /** The host-port modules. */
  readonly imports: NonNullable<ModuleMetadata['imports']>;
  /** The extra metric groups (possibly empty). */
  readonly metricGroups: readonly MetricGroupDef[];
  /** The caller resolver. */
  readonly actorId: (request: unknown) => string | undefined;
  /** A parameter decorator injecting `actorId(request)` into a route handler. */
  readonly actorIdParam: () => ParameterDecorator;
  /** The resolved, frozen verdict thresholds (`TELEMETRY_VERDICT_THRESHOLDS`). */
  readonly verdictThresholds: VerdictThresholds;
  /** The binding of `VERDICT_POLICY`, or `undefined` for the default policy. */
  readonly verdictPolicy: PortBinding<VerdictPolicy> | undefined;
  /** The metric groups' freshness window in milliseconds (`TELEMETRY_METRIC_FRESH_MS`). */
  readonly metricFreshMs: number;
}

/**
 * Injection token of the {@link ResolvedTelemetryModuleOptions}.
 *
 * @stability experimental
 */
export const TELEMETRY_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/telemetry/OPTIONS');

/**
 * Injection token of the resolved {@link VerdictThresholds}: the defaults with
 * the app's `dashboard.verdictThresholds` deep-merged over them, frozen. Every
 * reader of a threshold injects this.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const TELEMETRY_VERDICT_THRESHOLDS: unique symbol = Symbol.for('@marinoscar/platform/telemetry/VERDICT_THRESHOLDS');

/**
 * Injection token of the metric groups' freshness window in milliseconds: the
 * app's `metrics.freshMs`, else `METRIC_FRESH_MS`. The dashboard's `/metrics`
 * route reads it and reports it as the response's `freshMs`.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const TELEMETRY_METRIC_FRESH_MS: unique symbol = Symbol.for('@marinoscar/platform/telemetry/METRIC_FRESH_MS');

/** The bounds of `metrics.freshMs`: one second to one day. */
const FRESH_MS_MIN = 1_000;
const FRESH_MS_MAX = 86_400_000;

/**
 * The freshness window for an override: validated, else the default.
 *
 * @param metrics - the app's `metrics`, or `undefined`.
 * @returns the window in milliseconds.
 * @throws Error when `metrics` is not an object or `freshMs` is not a whole number from 1 000 to 86 400 000.
 *
 * @stability experimental
 */
export function resolveMetricFreshMs(metrics: TelemetryMetricsOptions | undefined): number {
  if (metrics === undefined) return METRIC_FRESH_MS;
  if (metrics === null || typeof metrics !== 'object') fail('`metrics` must be an object');
  const { freshMs } = metrics;
  if (freshMs === undefined) return METRIC_FRESH_MS;
  if (typeof freshMs !== 'number' || !Number.isInteger(freshMs) || freshMs < FRESH_MS_MIN || freshMs > FRESH_MS_MAX) {
    fail(`\`metrics.freshMs\` must be a whole number of milliseconds from ${FRESH_MS_MIN} to ${FRESH_MS_MAX} (got ${String(freshMs)})`);
  }
  return freshMs;
}

const amount = z.number().finite().nonnegative();
const count = z.number().int().positive();
const levels = z.object({ degraded: amount, critical: amount }).partial().strict();

/** What a `dashboard.verdictThresholds` override may contain. */
const verdictThresholdsOverrideSchema = z
  .object({
    minRequests: z.number().int().nonnegative(),
    errorRatePct: levels,
    p95Ms: levels,
    errorLogs: z
      .object({ minCurrent: z.number().int().nonnegative(), degradedRatio: amount, criticalRatio: amount })
      .partial()
      .strict(),
    noDataMinutes: z.number().finite().positive(),
    unknownRoutes: z.object({ criticalBearerRequests: count, criticalDistinctRoutes: count }).partial().strict(),
    diskUtilizationPct: levels,
    memoryUtilizationPct: levels,
    dbConnectionsPct: levels,
    oldestPendingJobMinutes: levels,
    tlsDaysLeft: levels,
    uptimeMinChecksForCritical: count,
    collectorFailedPct: z.object({ critical: amount }).partial().strict(),
    backupAgeHours: levels,
  })
  .partial()
  .strict();

/** The `{ degraded, critical }` pairs whose degraded bound must not exceed the critical one (`>`/`>=` rules). */
const RISING: ReadonlyArray<keyof VerdictThresholds> = [
  'errorRatePct',
  'p95Ms',
  'diskUtilizationPct',
  'memoryUtilizationPct',
  'dbConnectionsPct',
  'oldestPendingJobMinutes',
  'backupAgeHours',
];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

/**
 * The verdict thresholds for an override: validated, deep-merged over
 * {@link DEFAULT_VERDICT_THRESHOLDS} and frozen.
 *
 * @param override - the app's `dashboard.verdictThresholds`, or `undefined`.
 * @returns the resolved thresholds.
 * @throws Error naming every invalid field, or a degraded bound beyond its critical one.
 *
 * @stability experimental
 */
export function resolveVerdictThresholds(override: VerdictThresholdsOverride | undefined): VerdictThresholds {
  const parsed = verdictThresholdsOverrideSchema.safeParse(override ?? {});
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`)
      .join('; ');
    fail(`\`dashboard.verdictThresholds\` is invalid (${problems})`);
  }

  const merged: Record<string, unknown> = structuredClone(DEFAULT_VERDICT_THRESHOLDS) as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    merged[key] =
      value !== null && typeof value === 'object'
        ? { ...(merged[key] as Record<string, unknown>), ...value }
        : value;
  }
  const resolved = merged as unknown as VerdictThresholds;

  for (const key of RISING) {
    const pair = resolved[key] as { degraded: number; critical: number };
    if (pair.degraded > pair.critical) {
      fail(`\`dashboard.verdictThresholds.${key}\`: degraded (${pair.degraded}) must not exceed critical (${pair.critical})`);
    }
  }
  if (resolved.tlsDaysLeft.degraded < resolved.tlsDaysLeft.critical) {
    fail(
      `\`dashboard.verdictThresholds.tlsDaysLeft\`: degraded (${resolved.tlsDaysLeft.degraded}) must not be below ` +
        `critical (${resolved.tlsDaysLeft.critical}); fewer days left is worse`,
    );
  }
  if (resolved.errorLogs.degradedRatio > resolved.errorLogs.criticalRatio) {
    fail(
      `\`dashboard.verdictThresholds.errorLogs\`: degradedRatio (${resolved.errorLogs.degradedRatio}) must not exceed ` +
        `criticalRatio (${resolved.errorLogs.criticalRatio})`,
    );
  }

  return deepFreeze(resolved);
}

/**
 * The default caller resolver: the authenticated user's `id`, from
 * `request.requestUser` (set by the app's guards) or `request.user` (the JWT
 * strategy's user).
 *
 * @param request - the framework request.
 * @returns the user id, or `undefined`.
 *
 * @stability experimental
 */
export function defaultTelemetryActorId(request: unknown): string | undefined {
  if (request === null || typeof request !== 'object') return undefined;
  const { requestUser, user } = request as { requestUser?: { id?: unknown }; user?: { id?: unknown } };
  const id = (requestUser || user)?.id;
  return typeof id === 'string' ? id : undefined;
}

function fail(why: string): never {
  throw new Error(`TelemetryModule.forRoot: ${why}.`);
}

/**
 * Validates `options` and applies the defaults.
 *
 * @param options - what the app passed to `forRoot`.
 * @returns the resolved, frozen options.
 * @throws Error naming the bad option.
 *
 * @stability experimental
 */
export function resolveTelemetryModuleOptions(options: TelemetryModuleOptions): ResolvedTelemetryModuleOptions {
  if (options === null || typeof options !== 'object') fail('options are required ({ host, imports })');
  if (!options.host) fail('`host` is required (the app\'s definePlatformHost(...)): a platform route is never public');
  const host = definePlatformHost(options.host);
  if (!Array.isArray(options.imports)) {
    fail('`imports` must list the modules that provide the telemetry host ports (the app\'s TelemetryHostModule)');
  }
  if (options.metricGroups !== undefined && !Array.isArray(options.metricGroups)) fail('`metricGroups` must be an array');
  if (options.actorId !== undefined && typeof options.actorId !== 'function') fail('`actorId` must be a function');
  if (options.dashboard !== undefined && (options.dashboard === null || typeof options.dashboard !== 'object')) {
    fail('`dashboard` must be an object');
  }
  const verdictPolicy = options.dashboard?.verdictPolicy;
  if (verdictPolicy !== undefined) {
    const kinds =
      verdictPolicy && typeof verdictPolicy === 'object'
        ? ['useExisting', 'useClass', 'useFactory'].filter((k) => k in verdictPolicy)
        : [];
    if (kinds.length !== 1) fail('`dashboard.verdictPolicy` needs exactly one of useExisting, useClass or useFactory');
  }
  const verdictThresholds = resolveVerdictThresholds(options.dashboard?.verdictThresholds);
  const metricFreshMs = resolveMetricFreshMs(options.metrics);

  const actorId = options.actorId ?? defaultTelemetryActorId;
  const param = createParamDecorator((_data: unknown, ctx: ExecutionContext) => actorId(ctx.switchToHttp().getRequest()));

  return Object.freeze({
    host,
    imports: [...options.imports],
    metricGroups: Object.freeze([...(options.metricGroups ?? [])]),
    actorId,
    actorIdParam: () => param(),
    verdictThresholds,
    verdictPolicy,
    metricFreshMs,
  });
}
