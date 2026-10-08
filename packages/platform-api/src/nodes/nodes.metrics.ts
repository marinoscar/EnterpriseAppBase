// =============================================================================
// The worker-node fleet gauges (`app.nodes.*`, issue #606; declared by the
// slice since #734)
// =============================================================================
//
// Pure data, created by `NodeFleetMetrics` (./node-fleet-metrics.service.ts)
// from the app-metric registry. The app registers them with the rest of its
// metrics (`registerAppMetrics(...)`; the reference app spreads them into its
// platform list so the registration order is unchanged). The names and units
// are the GreptimeDB table names: changing one orphans every dashboard query
// that reads it.
// =============================================================================

import type { AppMetricAttribute, AppMetricDef } from '../otel-core/index';

/**
 * The `status` label values of `app.nodes.count`.
 *
 * @stability stable
 */
export const NODE_STATUS_VALUES = ['online', 'draining', 'offline', 'disabled'] as const;

/**
 * The `health` label values of `app.nodes.count`.
 *
 * @stability stable
 */
export const NODE_HEALTH_VALUES = ['healthy', 'stale', 'offline'] as const;

const free: AppMetricAttribute = { kind: 'free' };
const oneOf = (...values: string[]): AppMetricAttribute => ({ kind: 'enum', values });
const NODE_ATTRIBUTES = { node_id: free, node_name: free };

/**
 * The fleet gauges' declarations. Register them with
 * `registerAppMetrics(NODES_APP_METRICS)` before the metrics host is built.
 *
 * @example
 * ```ts
 * registerAppMetrics([...PLATFORM_APP_METRICS, ...NODES_APP_METRICS]);
 * ```
 *
 * @stability stable
 */
export const NODES_APP_METRICS = [
  {
    key: 'nodesCount',
    name: 'app.nodes.count',
    kind: 'gauge',
    unit: '{node}',
    description: 'Registered worker nodes, by status and derived health.',
    attributes: { status: oneOf(...NODE_STATUS_VALUES), health: oneOf(...NODE_HEALTH_VALUES) },
  },
  {
    key: 'nodesCpuUtilization',
    name: 'app.nodes.cpu.utilization',
    kind: 'gauge',
    unit: '{core}',
    description: 'Node process CPU over the last heartbeat interval, in cores (1 = one full core).',
    attributes: NODE_ATTRIBUTES,
  },
  {
    key: 'nodesMemoryRss',
    name: 'app.nodes.memory.rss',
    kind: 'gauge',
    unit: 'By',
    description: 'Node process resident set size.',
    attributes: NODE_ATTRIBUTES,
  },
  {
    key: 'nodesHeapUsed',
    name: 'app.nodes.heap.used',
    kind: 'gauge',
    unit: 'By',
    description: 'Node process V8 heap in use.',
    attributes: NODE_ATTRIBUTES,
  },
  {
    key: 'nodesHeapLimit',
    name: 'app.nodes.heap.limit',
    kind: 'gauge',
    unit: 'By',
    description: 'Node process V8 heap limit.',
    attributes: NODE_ATTRIBUTES,
  },
  {
    key: 'nodesEventLoopDelayP99',
    name: 'app.nodes.event_loop.delay.p99',
    kind: 'gauge',
    unit: 's',
    description: 'Node process event-loop delay, p99 over the last interval.',
    attributes: NODE_ATTRIBUTES,
  },
  {
    key: 'nodesStateDirFree',
    name: 'app.nodes.state_dir.free',
    kind: 'gauge',
    unit: 'By',
    description: "Free bytes on the filesystem holding the node's state directory.",
    attributes: NODE_ATTRIBUTES,
  },
  {
    key: 'nodesStateDirTotal',
    name: 'app.nodes.state_dir.total',
    kind: 'gauge',
    unit: 'By',
    description: "Size of the filesystem holding the node's state directory.",
    attributes: NODE_ATTRIBUTES,
  },
  {
    key: 'nodesSlotsUsed',
    name: 'app.nodes.slots.used',
    kind: 'gauge',
    unit: '{slot}',
    description: 'Job slots in use on the node.',
    attributes: NODE_ATTRIBUTES,
  },
  {
    key: 'nodesSlotsTotal',
    name: 'app.nodes.slots.total',
    kind: 'gauge',
    unit: '{slot}',
    description: 'Job slots the node offers.',
    attributes: NODE_ATTRIBUTES,
  },
  {
    key: 'nodesUptime',
    name: 'app.nodes.uptime',
    kind: 'gauge',
    unit: 's',
    description: 'Node process uptime.',
    attributes: NODE_ATTRIBUTES,
  },
  {
    key: 'nodesCounter',
    name: 'app.nodes.counter',
    kind: 'gauge',
    unit: '{event}',
    description:
      'Node-reported cumulative counters since the node process started (reset on restart), by counter.',
    attributes: { ...NODE_ATTRIBUTES, counter: free },
  },
  {
    key: 'nodesTypesNoEligibleNode',
    name: 'app.nodes.types.no_eligible_node',
    kind: 'gauge',
    unit: '{type}',
    description:
      '1 when an offered job type has runnable pending jobs and no healthy online node lists it as eligible.',
    attributes: { job_type: free },
  },
] as const satisfies readonly AppMetricDef[];
