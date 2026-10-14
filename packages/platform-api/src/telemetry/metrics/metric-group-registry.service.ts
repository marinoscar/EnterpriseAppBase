// =============================================================================
// MetricGroupRegistry: the metric-group registry as an injectable (issue #703,
// Extension Contract rung 2)
// =============================================================================
//
// A facade over the static `metricGroupRegistry` (./metric-group.registry.ts,
// #680), NOT a second registry: the dashboard route, its documentation, the
// assistant's tools and the support bundle all read the one static registry,
// and this class reads and writes the same one. It exists so an app can add a
// group the Nest way, from its own `onModuleInit`:
//
//   constructor(private readonly groups: MetricGroupRegistry) {}
//   onModuleInit() { registerMetricGroup(this.groups, COACH_METRIC_GROUP); }
//
// The simpler path, and the only one that also puts the group in the
// `/metrics` route's documented enum, is `TelemetryModule.forRoot({
// metricGroups })`. Either way the rules are the registry's own: a duplicate
// id or family key throws (boot fails), and after `onApplicationBootstrap` the
// registry is frozen and a late `register` throws `FROZEN`.
//
// Kept apart from ./metric-group.registry.ts so that file stays
// framework-free (it is evaluated by the DTOs at import time).
// =============================================================================

import { Injectable, OnApplicationBootstrap } from '@nestjs/common';

import { metricGroupRegistry, registerMetricGroups, type MetricGroupDef } from './metric-group.registry';

/**
 * A dashboard metric group, under the name the platform-packages spec uses
 * (#703): the same shape as {@link MetricGroupDef} (#680), whose naming wins.
 *
 * @stability experimental
 */
export type MetricGroupDefinition = MetricGroupDef;

/**
 * The dashboard's metric groups: the six platform groups, then the app's,
 * in dashboard order. Provided by `TelemetryModule.forRoot()`.
 *
 * @stability experimental
 */
@Injectable()
export class MetricGroupRegistry implements OnApplicationBootstrap {
  /**
   * Adds a group, checked against every group already registered (unique id,
   * family, ratio and table keys unique across ALL groups, known units and
   * filters, references to registered families).
   *
   * @param definition - the group.
   * @throws RegistryError `DUPLICATE_ID`, `INVALID_ID`, `INVALID_ENTRY`, or
   *   `FROZEN` once the application has bootstrapped.
   *
   * @extensionPoint registry
   */
  register(definition: MetricGroupDefinition): void {
    registerMetricGroups([definition]);
  }

  /** Every registered group, in dashboard order (`order`, then id): the platform's first. */
  list(): readonly MetricGroupDefinition[] {
    return metricGroupRegistry.list();
  }

  /**
   * The group registered under `id`, or `undefined`.
   *
   * @param id - the group id (`host`, `coach`, ...).
   */
  get(id: string): MetricGroupDefinition | undefined {
    return metricGroupRegistry.get(id);
  }

  /** Refuses further registrations once every module's `onModuleInit` has run. */
  onApplicationBootstrap(): void {
    metricGroupRegistry.freeze();
  }
}

/**
 * Registers one metric group; the function form of
 * {@link MetricGroupRegistry.register}.
 *
 * @param registry - the injected registry.
 * @param definition - the group.
 * @throws RegistryError as {@link MetricGroupRegistry.register} does.
 *
 * @example
 * ```ts
 * onModuleInit(): void {
 *   registerMetricGroup(this.groups, COACH_METRIC_GROUP);
 * }
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerMetricGroup(registry: MetricGroupRegistry, definition: MetricGroupDefinition): void {
  registry.register(definition);
}
