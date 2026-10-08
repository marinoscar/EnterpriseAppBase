// `@marinoscar/platform-api/jobs`: the jobs slice (issue #734, PP-8.2). The
// background queue: enqueue with dedup, the atomic claim, leases, the
// terminal state machine, provider throttling, the in-process worker pool,
// the lease reaper and the temp-file janitor, the handler contract and its
// registry, and the `/api/admin/jobs` routes. Documented in ./README.md.
// Explicit named exports only.

// ---- the module, its options and configuration (rung 1) -------------------------------
export { JobsModule } from './jobs.module';
export { JOBS_OPTIONS, jobsConfigOverlay, resolveJobsModuleOptions } from './jobs.options';
export type { JobsModuleOptions, JobsWorkerMode, ResolvedJobsModuleOptions } from './jobs.options';
export { jobsConfiguration } from './jobs.configuration';
export type { JobsConfiguration, JobsConfigurationKeys, NodesConfigurationKeys } from './jobs.configuration';
export { DEFAULT_JOBS_POLICY, DEFAULT_NODES_POLICY } from './jobs.policy';
export type { JobsPolicy, NodesPolicy } from './jobs.policy';

// ---- the host ports (rung 3) -------------------------------------------------------------
export { JOBS_EVENT_BUS, JOBS_METRICS, JOBS_ORG_SCOPE, NOOP_JOBS_METRICS } from './ports';
export type { JobsEventBus, JobsEventBusMeta, JobsMetrics, JobsOrgScope } from './ports';

// ---- the data, structurally ------------------------------------------------------------------
export { JobReason, JobStatus, NodeStatus } from './data/jobs-db';
export type {
  Job,
  JobNodeSecret,
  JobStatsRollup,
  JobsBatchPayload,
  JobsCreateData,
  JobsDelegate,
  JobsEnqueueTx,
  JobsGroupByRow,
  JobsInputJsonArray,
  JobsInputJsonObject,
  JobsInputJsonValue,
  JobsJsonArray,
  JobsJsonObject,
  JobsJsonValue,
  JobsPrisma,
  JobsQueryArgs,
  JobsRawSql,
  JobsTx,
  JobsUpdateData,
  JobsWhere,
  NodeCredential,
  WorkerNode,
} from './data/jobs-db';

// ---- the handler contract and its registry (rung 2) --------------------------------------
export { JOB_HANDLER } from './job-handler.interface';
export type { JobHandler } from './job-handler.interface';
export { JobHandlerRegistry } from './job-handler.registry';
export {
  buildClaimLeases,
  resetJobProfileWarnings,
  resolveJobProfile,
  resolveLeaseHorizonMs,
  resolveMaxAttempts,
  resolveRenewIntervalMs,
} from './job-execution-profile';
export type { JobExecutionProfile } from './job-execution-profile';
export type { IssuedJobSecret, JobSecretBroker, JobSecretUsability } from './job-secret-broker';
export { JOB_HISTORY_PURGE_TYPE, JobHistoryPurgeHandler } from './handlers/job-history-purge.handler';

// ---- enqueueing ------------------------------------------------------------------------------
export { ACTIVE_DEDUP_INDEX_NAME, JobsService, isActiveDedupConflict } from './jobs.service';
export type { EnqueueJobInput } from './jobs.service';
export { buildDedupKey } from './job-keys';
export { HOUSEKEEPING_PRIORITY, enqueueHousekeepingJob } from './housekeeping.enqueue';
export type { HousekeepingEnqueueOptions } from './housekeeping.enqueue';
export { JOBS_ENQUEUED_CHANNEL } from './job-wake';

// ---- executing: claim, lease, settle, reap -----------------------------------------------
export { JOB_CLAIM_COLUMNS, JobClaimService } from './job-claim.service';
export type { ClaimOptions, JobExecutor } from './job-claim.service';
export { JobLeaseService, heldClaimWhere, heldLeaseWhere } from './job-lease.service';
export type { LeaseHolder } from './job-lease.service';
export { JobTerminalService, rowMatchesWrite } from './job-terminal.service';
export type { CompleteFailedOptions, JobSettleOutcome } from './job-terminal.service';
export { JobStuckService, stuckRunningWhere } from './job-stuck.service';
export type { ResetStuckResult } from './job-stuck.service';
export { ProviderThrottleService } from './provider-throttle.service';
export { NodeOffloadService, readJobSecretBrokerEnabled } from './node-offload.service';
export {
  JobTimeoutError,
  JobWorker,
  LEASE_GRACE_MS,
  parseWorkerMode,
  resolveJobLeaseMs,
  resolveWorkerConcurrency,
} from './job.worker';
export type { JobWorkerMode } from './job.worker';
export { JOB_CLOCK, systemJobClock } from './job-clock';
export type { JobClock } from './job-clock';
export { JOB_RANDOM, computeBackoffMs } from './backoff.util';
export type { BackoffInput } from './backoff.util';
export {
  CLASSIFY_RATE_LIMIT,
  RateLimitError,
  classifyRateLimit,
  parseRetryAfterMs,
} from './rate-limit.error';
export type { RateLimitClassification, SelfClassifyingRateLimit } from './rate-limit.error';

// ---- events (rung 4) -------------------------------------------------------------------------
export { JOB_SETTLED_EVENT, JobSettledEvent } from './events/job-settled.event';
export { emitJobSettled } from './job-settled.emit';

// ---- temp files and trace context -------------------------------------------------------------
export {
  JOB_TEMP_PREFIX,
  configureJobTempPrefix,
  jobTempDir,
  jobTempPath,
  jobTempPrefixFor,
} from './job-temp';
export {
  MAX_TRACE_CONTEXT_LENGTH,
  TRACEPARENT_HEADER,
  TRACEPARENT_PATTERN,
  captureJobTraceContext,
  jobParentContext,
  normalizeTraceparent,
} from './job-trace-context';

// ---- the admin read side ---------------------------------------------------------------------
export { JobAdminService } from './job-admin.service';
export { JobInsightsService } from './job-insights.service';
export { jobTypeLabel, jobTypeLabels, registerJobTypeLabel } from './job-type-label';

// ---- permissions, as data for the app's permission registry -----------------------------------
export { JOBS_PERMISSIONS } from './jobs.permissions';
export type { JobsPermissionDeclaration } from './jobs.permissions';
