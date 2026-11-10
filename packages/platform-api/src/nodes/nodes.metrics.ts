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

import { NODE_EVENT_TYPES } from '@marinoscar/platform-contract/nodes';

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

/**
 * The `type` label values of `app.nodes.events`: the event types the platform
 * knows by name, then `other` for any type an app's node reports. Bounded on
 * purpose: the wire `type` is an open string, a metric label must not be.
 *
 * @stability experimental
 */
export const NODE_EVENT_METRIC_TYPES: readonly string[] = [...Object.values(NODE_EVENT_TYPES), 'other'];

/**
 * The `severity` label values of `app.nodes.events`.
 *
 * @stability experimental
 */
export const NODE_EVENT_SEVERITY_VALUES = ['info', 'warning', 'critical'] as const;

const free: AppMetricAttribute = { kind: 'free' };
const oneOf = (...values: string[]): AppMetricAttribute => ({ kind: 'enum', values });
const NODE_ATTRIBUTES = { node_id: free, node_name: free };

/**
 * One fleet gauge's declaration: an {@link AppMetricDef} whose `key` is a
 * literal, so the app's metric-key union keeps every fleet key.
 *
 * @typeParam Key - the metric's code key.
 * @stability stable
 */
export interface NodesAppMetricDef<Key extends string> extends AppMetricDef {
  /** The metric's code key. */
  readonly key: Key;
}

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
export const NODES_APP_METRICS: readonly [
  NodesAppMetricDef<'nodesCount'>,
  NodesAppMetricDef<'nodesCpuUtilization'>,
  NodesAppMetricDef<'nodesMemoryRss'>,
  NodesAppMetricDef<'nodesHeapUsed'>,
  NodesAppMetricDef<'nodesHeapLimit'>,
  NodesAppMetricDef<'nodesEventLoopDelayP99'>,
  NodesAppMetricDef<'nodesStateDirFree'>,
  NodesAppMetricDef<'nodesStateDirTotal'>,
  NodesAppMetricDef<'nodesSlotsUsed'>,
  NodesAppMetricDef<'nodesSlotsTotal'>,
  NodesAppMetricDef<'nodesUptime'>,
  NodesAppMetricDef<'nodesCounter'>,
  NodesAppMetricDef<'nodesTypesNoEligibleNode'>,
  NodesAppMetricDef<'nodesHostCpuUtilization'>,
  NodesAppMetricDef<'nodesHostMemoryUsed'>,
  NodesAppMetricDef<'nodesHostMemoryTotal'>,
  NodesAppMetricDef<'nodesHostMemoryAvailable'>,
  NodesAppMetricDef<'nodesHostLoad1'>,
  NodesAppMetricDef<'nodesPowerOnBattery'>,
  NodesAppMetricDef<'nodesPowerBatteryPercent'>,
  NodesAppMetricDef<'nodesEvents'>,
  NodesAppMetricDef<'nodesCredentialsIssued'>,
] = [
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
  {
    key: 'nodesHostCpuUtilization',
    name: 'app.nodes.host.cpu.utilization',
    kind: 'gauge',
    unit: '{percent}',
    description: 'Machine-wide CPU utilisation of the host the node runs on, 0 to 100.',
    attributes: NODE_ATTRIBUTES,
  },
  {
    key: 'nodesHostMemoryUsed',
    name: 'app.nodes.host.memory.used',
    kind: 'gauge',
    unit: 'By',
    description: 'Physical memory in use on the host (total minus available, or minus free when available is not reported).',
    attributes: NODE_ATTRIBUTES,
  },
  {
    key: 'nodesHostMemoryTotal',
    name: 'app.nodes.host.memory.total',
    kind: 'gauge',
    unit: 'By',
    description: 'Total physical memory of the host.',
    attributes: NODE_ATTRIBUTES,
  },
  {
    key: 'nodesHostMemoryAvailable',
    name: 'app.nodes.host.memory.available',
    kind: 'gauge',
    unit: 'By',
    description: 'Physical memory available to new work on the host (reclaimable included).',
    attributes: NODE_ATTRIBUTES,
  },
  {
    key: 'nodesHostLoad1',
    name: 'app.nodes.host.load1',
    kind: 'gauge',
    unit: '{load}',
    description: 'One-minute load average of the host.',
    attributes: NODE_ATTRIBUTES,
  },
  {
    key: 'nodesPowerOnBattery',
    name: 'app.nodes.power.on_battery',
    kind: 'gauge',
    unit: '{state}',
    description: '1 when the host runs on battery, 0 when on AC power. Absent while the power source is unknown.',
    attributes: NODE_ATTRIBUTES,
  },
  {
    key: 'nodesPowerBatteryPercent',
    name: 'app.nodes.power.battery_percent',
    kind: 'gauge',
    unit: '{percent}',
    description: 'Battery charge of the host, 0 to 100. Absent on a host without a battery.',
    attributes: NODE_ATTRIBUTES,
  },
  {
    key: 'nodesEvents',
    name: 'app.nodes.events',
    kind: 'counter',
    unit: '{event}',
    description: 'Node-reported events accepted at heartbeat ingestion, by event type (unknown types fold into other) and severity.',
    attributes: { type: oneOf(...NODE_EVENT_METRIC_TYPES), severity: oneOf(...NODE_EVENT_SEVERITY_VALUES) },
  },
  {
    key: 'nodesCredentialsIssued',
    name: 'app.nodes.credentials.issued',
    kind: 'counter',
    unit: '{credential}',
    description: 'Provider credentials delivered to worker nodes (#1083), by registered purpose. Never labelled by organization.',
    attributes: { purpose: free },
  },
];
