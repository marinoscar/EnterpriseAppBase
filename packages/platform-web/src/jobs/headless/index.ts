// `@marinoscar/platform-web/jobs/headless`: the jobs slice's behaviour without
// markup (issue #854): the job queue and worker-fleet API client over the
// app's transport, the wire types (from `@marinoscar/platform-contract/jobs`
// and `/nodes`), the data hooks, the visible-tab poll, the adapters and the
// formatting helpers. Documented in ../README.md. Explicit named exports only.

export { createJobsApi } from './api.js';
export type { JobsApi } from './api.js';
export { isJobActionable } from './types.js';
export type {
  Job,
  JobDurationStats,
  JobEta,
  JobEtaBasis,
  JobInsights,
  JobLifetimeStats,
  JobListParams,
  JobListResponse,
  JobReasonName,
  JobStats,
  JobStatusCounts,
  JobStatusName,
  JobTypeDurationStats,
  JobTypeStats,
  ProcessedWithin,
  ResetHistoryResult,
  ResetStuckResult,
  RetryFailedResult,
} from './types.js';
export { formatDateTime, formatDuration, shortId } from './format.js';
export { JobsWebAdaptersProvider, useJobsApi, useJobsWebAdapters } from './adapters.js';
export type { JobsSpinnerProps, JobsWebAdapters } from './adapters.js';
export type {
  JobsDataTableComponent,
  JobsDataTableProps,
  JobsTableColumn,
  JobsTableColumnPriority,
  JobsTableEnumValue,
  JobsTableFilter,
  JobsTableFilterModelOperator,
  JobsTableFilterOperator,
  JobsTableRowAction,
  JobsTableSortState,
} from './table.js';
export { useVisiblePolling } from './use-visible-polling.js';
export { JOBS_POLL_INTERVAL_MS, useJobActions, useJobStats, useJobs } from './use-jobs.js';
export type { UseJobActionsResult, UseJobStatsResult, UseJobsResult } from './use-jobs.js';
export { DEFAULT_INSIGHTS_WINDOW_DAYS, INSIGHTS_WINDOW_OPTIONS, useJobInsights } from './use-job-insights.js';
export type { UseJobInsightsResult } from './use-job-insights.js';
// The worker fleet moved to `@marinoscar/platform-web/nodes/headless` (#881);
// everything this entry exported for it stays exported, from there.
export {
  MAX_NODE_CREDENTIAL_DAYS,
  MAX_NODE_CREDENTIAL_NAME_LENGTH,
  NODE_HEALTHS,
  NODE_STATUSES,
  WORKER_NODES_POLL_INTERVAL_MS,
  nodeCredentialStatus,
  useNodeActions,
  useNodeCredentials,
  useWorkerNode,
  useWorkerNodes,
} from '../../nodes/index.js';
export type {
  CreateNodeCredentialInput,
  NodeCredential,
  NodeCredentialCreated,
  NodeCredentialStatus,
  NodeHealth,
  NodeJobCounts,
  NodeOwner,
  NodeStatus,
  NodeVitals,
  NodeVitalsCounters,
  UseNodeActionsResult,
  UseNodeCredentialsResult,
  UseWorkerNodeResult,
  UseWorkerNodesResult,
  WorkerNode,
} from '../../nodes/index.js';
