// =============================================================================
// Stand-ins for the reference app's services, for the jobs and nodes specs
// (#734)
// =============================================================================
//
// The specs moved here from apps/api with the code they test. Where a spec
// named an app service, it now names the host port the slice injects instead;
// each export below is BOTH the port's injection token (a value, for
// `{ provide: X, useValue }` and `overrideProvider(X)`) and its type, under the
// app service's old name, so the specs read as they did.
// =============================================================================

import { PLATFORM_PRISMA } from '../../../src/core/index';
import type { JobsPrisma } from '../../../src/jobs/data/jobs-db';
import { JOBS_EVENT_BUS, JOBS_METRICS, type JobsEventBus, type JobsEventBusMeta, type JobsMetrics } from '../../../src/jobs/ports';
import { DEFAULT_JOBS_POLICY, DEFAULT_NODES_POLICY } from '../../../src/jobs/jobs.policy';

/** The database port (the app's `PrismaService`). */
export const PrismaService = PLATFORM_PRISMA;
export type PrismaService = JobsPrisma;

/** The metrics port (the app binds its `AppMetricsService`). */
export const AppMetricsService = JOBS_METRICS;
export type AppMetricsService = JobsMetrics;

/** The wake-up bus port (the app binds its `EVENT_BUS`). */
export const EVENT_BUS = JOBS_EVENT_BUS;
export type EventBus = JobsEventBus;

/** The shipped policies, under the app's `DEFAULT_SYSTEM_SETTINGS` shape. */
export const DEFAULT_SYSTEM_SETTINGS = Object.freeze({ jobs: DEFAULT_JOBS_POLICY, nodes: DEFAULT_NODES_POLICY });

/**
 * A synchronous, same-process event bus: the app's `InProcessEventBus`,
 * reduced to what the worker's wake-up uses.
 */
export class InProcessEventBus implements JobsEventBus {
  readonly adapter = 'in-process';
  private readonly handlers = new Map<string, Set<(payload: unknown, meta: JobsEventBusMeta) => void | Promise<void>>>();

  async publish<T>(channel: string, payload: T): Promise<void> {
    for (const handler of this.handlers.get(channel) ?? []) {
      await handler(JSON.parse(JSON.stringify(payload)) as unknown, { origin: 'local', local: true });
    }
  }

  subscribe<T>(channel: string, handler: (payload: T, meta: JobsEventBusMeta) => void | Promise<void>): () => void {
    const set = this.handlers.get(channel) ?? new Set();
    set.add(handler as (payload: unknown, meta: JobsEventBusMeta) => void | Promise<void>);
    this.handlers.set(channel, set);
    return () => set.delete(handler as (payload: unknown, meta: JobsEventBusMeta) => void | Promise<void>);
  }
}
