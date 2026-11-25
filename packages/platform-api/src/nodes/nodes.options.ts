// =============================================================================
// `NodesModule.forRoot()` options (issue #734, PP-8.2)
// =============================================================================

import type { DynamicModule, ForwardReference, Type } from '@nestjs/common';

/**
 * What an app passes to `NodesModule.forRoot()`. Every field is optional:
 * `NodesModule.forRoot({})` is the deployment as its environment describes it
 * (`NODE_*_ENABLED`, `jobsConfiguration()`).
 *
 * @stability experimental
 */
export interface NodesModuleOptions {
  /**
   * Toggle the node crons for THIS process; default from the environment as
   * today (`NODE_STALE_OFFLINE_ENABLED`, `NODE_OFFLINE_PRUNE_ENABLED`,
   * `NODE_SECRET_SWEEP_ENABLED`, each on unless `false`).
   */
  tasks?: Partial<{
    /** The stale-offline sweep (queues `nodes.fleet.sweep` every ten minutes). */
    staleOffline: boolean;
    /** The offline prune (queues `nodes.fleet.prune` daily). */
    offlinePrune: boolean;
    /** The brokered-secret sweep (a permanent cron exemption: it revokes credentials inline). */
    secretSweep: boolean;
    /** The node-event purge (queues `nodes.node_events_purge` daily). */
    nodeEventsPurge: boolean;
  }>;
  /**
   * How many days node events (`worker_node_events`) are kept; default
   * {@link DEFAULT_NODE_EVENTS_RETENTION_DAYS}. Whole days, 1 to 3650.
   */
  nodeEventsRetentionDays?: number;
  /**
   * The modules that bind the slice's host ports (`NODE_OBJECT_STORE`,
   * `NODE_JOB_INPUTS`). Each must be `@Global()` or export the tokens.
   */
  imports?: ReadonlyArray<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

/**
 * Injection token of the {@link ResolvedNodesModuleOptions}. Optional to every
 * consumer: a task built without `forRoot` (a unit test) reads the environment.
 *
 * @stability experimental
 */
export const NODES_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/nodes/OPTIONS');

/**
 * The options after validation, as `NODES_OPTIONS` provides them.
 *
 * @stability experimental
 */
export interface ResolvedNodesModuleOptions {
  /** Per-cron overrides; an absent key defers to the environment. */
  readonly tasks: Readonly<
    Partial<{
      /** The stale-offline sweep cron (`NODE_STALE_OFFLINE_ENABLED`). */
      staleOffline: boolean;
      /** The offline-prune cron (`NODE_OFFLINE_PRUNE_ENABLED`). */
      offlinePrune: boolean;
      /** The secret-sweep cron (`NODE_SECRET_SWEEP_ENABLED`). */
      secretSweep: boolean;
      /** The node-event purge cron (no environment variable; on unless set to `false`). */
      nodeEventsPurge: boolean;
    }>
  >;
  /** Days node events are kept. */
  readonly nodeEventsRetentionDays: number;
  /** The host-port modules. */
  readonly imports: ReadonlyArray<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

/**
 * How long node events are kept when the app does not say: 30 days.
 *
 * @stability experimental
 */
export const DEFAULT_NODE_EVENTS_RETENTION_DAYS = 30;

/**
 * Validates the options.
 *
 * @param options - the app's options.
 * @returns the resolved, frozen options.
 * @throws Error naming the field when an option is invalid.
 *
 * @stability experimental
 */
export function resolveNodesModuleOptions(options: NodesModuleOptions = {}): ResolvedNodesModuleOptions {
  const tasks = options.tasks ?? {};
  for (const [key, value] of Object.entries(tasks)) {
    if (!['staleOffline', 'offlinePrune', 'secretSweep', 'nodeEventsPurge'].includes(key)) {
      throw new Error(`NodesModule.forRoot: tasks.${key} is not a node task.`);
    }
    if (value !== undefined && typeof value !== 'boolean') {
      throw new Error(`NodesModule.forRoot: tasks.${key} must be a boolean, got ${JSON.stringify(value)}.`);
    }
  }
  const retention = options.nodeEventsRetentionDays ?? DEFAULT_NODE_EVENTS_RETENTION_DAYS;
  if (!Number.isInteger(retention) || retention < 1 || retention > 3650) {
    throw new Error(`NodesModule.forRoot: nodeEventsRetentionDays must be a whole number from 1 to 3650, got ${JSON.stringify(retention)}.`);
  }
  return Object.freeze({
    tasks: Object.freeze({ ...tasks }),
    nodeEventsRetentionDays: retention,
    imports: Object.freeze([...(options.imports ?? [])]),
  });
}
