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
//
// Validated once, in `forRoot`: a bad option fails boot with a message naming
// it.
// =============================================================================

import { createParamDecorator, type ExecutionContext, type ModuleMetadata } from '@nestjs/common';

import { definePlatformHost, type PlatformHost } from '../core/index';
import type { MetricGroupDef } from './metrics/metric-group.registry';

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
}

/**
 * Injection token of the {@link ResolvedTelemetryModuleOptions}.
 *
 * @stability experimental
 */
export const TELEMETRY_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/telemetry/OPTIONS');

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

  const actorId = options.actorId ?? defaultTelemetryActorId;
  const param = createParamDecorator((_data: unknown, ctx: ExecutionContext) => actorId(ctx.switchToHttp().getRequest()));

  return Object.freeze({
    host,
    imports: [...options.imports],
    metricGroups: Object.freeze([...(options.metricGroups ?? [])]),
    actorId,
    actorIdParam: () => param(),
  });
}
