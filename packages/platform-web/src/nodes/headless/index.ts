// `@marinoscar/platform-web/nodes/headless`: the worker-node slice's behaviour
// without markup (issue #881): the fleet and credential API client over the
// app's transport, the wire types (derived from `@marinoscar/platform-contract/nodes`),
// the data hooks, the visible-tab poll, the adapters and the formatting
// helpers. Documented in ../README.md. Explicit named exports only.

export { createNodesApi } from './api.js';
export type { NodesApi } from './api.js';
export {
  MAX_NODE_CREDENTIAL_DAYS,
  MAX_NODE_CREDENTIAL_NAME_LENGTH,
  NODE_EVENT_TYPES,
  NODE_HEALTHS,
  NODE_STATUSES,
  nodeCredentialStatus,
} from './types.js';
export type {
  CreateNodeCredentialInput,
  NodeCredential,
  NodeCredentialCreated,
  NodeCredentialStatus,
  NodeEventSeverity,
  NodeEventsQuery,
  NodeHealth,
  NodeHostVitals,
  NodeJobCounts,
  NodeOwner,
  NodePower,
  NodeStatus,
  NodeVitals,
  NodeVitalsCounters,
  WorkerNode,
  WorkerNodeEvent,
  WorkerNodeEventList,
} from './types.js';
export { MAX_NODE_EVENT_SUMMARY_ATTRS, humanizeNodeEventType, nodeEventLabel, nodeEventSummary } from './node-events.js';
export { NODE_BATTERY_CRITICAL_PERCENT, NODE_BATTERY_WARNING_PERCENT, describeNodePower } from './power.js';
export type { NodePowerDescription } from './power.js';
export { useNodeEvents } from './use-node-events.js';
export type { UseNodeEventsResult } from './use-node-events.js';
export { formatDateTime, formatDuration, shortId } from './format.js';
export { formatNodeVital, nodeVitalFor, nodeVitalRows, registerNodeVital, registeredNodeVitals } from './node-vitals.js';
export type { NodeVitalDef, NodeVitalRow, NodeVitalUnit } from './node-vitals.js';
export { MAX_CAPABILITY_TEXT_LENGTH, MAX_LISTED_CAPABILITIES, nodeCapabilityItems } from './capabilities.js';
export type { NodeCapabilityItem } from './capabilities.js';
export { NodesWebAdaptersProvider, useNodesApi, useNodesWebAdapters } from './adapters.js';
export type { NodesSpinnerProps, NodesWebAdapters } from './adapters.js';
export type {
  NodesDataTableComponent,
  NodesDataTableProps,
  NodesTableColumn,
  NodesTableColumnPriority,
  NodesTableEnumValue,
  NodesTableFilter,
  NodesTableFilterModelOperator,
  NodesTableFilterOperator,
  NodesTableRowAction,
  NodesTableSortState,
} from './table.js';
export { useVisiblePolling } from './use-visible-polling.js';
export {
  WORKER_NODES_POLL_INTERVAL_MS,
  useNodeActions,
  useNodeCredentials,
  useWorkerNode,
  useWorkerNodes,
} from './use-worker-nodes.js';
export type {
  UseNodeActionsResult,
  UseNodeCredentialsResult,
  UseWorkerNodeResult,
  UseWorkerNodesResult,
} from './use-worker-nodes.js';
