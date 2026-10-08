// =============================================================================
// The jobs slice's wire types, as the browser sees them (issue #854)
// =============================================================================
//
// Moved from the reference app's `services/jobs.ts` (#266) and
// `services/nodes.ts` (#271). The job shapes are no longer hand-written
// mirrors: they are the OUTPUT types of the `@marinoscar/platform-contract/jobs`
// schemas the API's DTOs wrap (#734), so a field the API adds or makes
// nullable reaches this slice as a compile error, not as a silent `undefined`
// (`orgId` is the first field that arrived that way).
//
// The admin fleet shapes (`WorkerNode`, `NodeCredential`, ...) are class DTOs
// on the API side (`nodes/dto/node-admin.dto.ts`), with no contract schema
// yet, so they stay structural mirrors here; the vitals snapshot and the
// create-credential body come from `@marinoscar/platform-contract/nodes`.
//
// The nullable numbers are the ones worth being careful about. `avgMs`,
// `p50Ms` and `p95Ms` are `number | null` because a type with no succeeded
// jobs in the window has no average, and a UI that renders "0 ms" states a
// measurement that was never taken. `samples` says whether the other three
// mean anything.
//
// `NodeCredential` HAS NO `token` FIELD, not even an optional one: the raw
// token exists on the create response (`NodeCredentialCreated`) and nowhere
// else, and a `token?: string` would let the first `credential.token ?? '-'`
// compile while asking for a value the server can never produce. Its
// `expiresAt` is `string | null`, and `null` means "never expires", a real
// answer for an unattended worker.
//
// `WorkerNode.health` is SERVER-DERIVED (`deriveNodeHealth` compares the last
// heartbeat against the `nodes.staleHeartbeatSeconds` system setting, which
// the browser does not read), so nothing in this slice recomputes it.
// =============================================================================

import type { z } from 'zod';
import type {
  JOB_REASONS,
  JobDurationStats,
  JobEtaBasis,
  JobListQuery,
  JobStatusCounts,
  JobStatusName,
  ProcessedWithin,
  jobEtaSchema,
  jobInsightsSchema,
  jobLifetimeStatsSchema,
  jobSchema,
  jobStatsSchema,
  jobTypeDurationStatsSchema,
  jobTypeStatsSchema,
  resetHistoryResultSchema,
  resetStuckResultSchema,
  retryFailedResultSchema,
} from '@marinoscar/platform-contract/jobs';
import type { NodeVitals, NodeVitalsCounters, createNodeCredentialSchema } from '@marinoscar/platform-contract/nodes';

export type { JobDurationStats, JobEtaBasis, JobStatusCounts, JobStatusName, NodeVitals, NodeVitalsCounters, ProcessedWithin };

// ---- Jobs --------------------------------------------------------------------

/**
 * Why a job was queued: `upload`, `rerun` or `backfill`.
 *
 * @stability experimental
 */
export type JobReasonName = (typeof JOB_REASONS)[number];

/**
 * One row of `GET /api/admin/jobs` (`jobSchema`). Payloads are never included.
 * `orgId` is the organization the work belongs to, or `null` for a
 * deployment-wide (system) job such as housekeeping.
 *
 * @stability experimental
 */
export type Job = z.output<typeof jobSchema>;

/**
 * A page of the job list (`docs/API.md` flat pagination).
 *
 * @stability experimental
 */
export interface JobListResponse {
  /** This page's rows, newest first. */
  items: Job[];
  /** Rows across all pages. */
  total: number;
  /** This page, one-based. */
  page: number;
  /** The page size. */
  pageSize: number;
  /** The number of pages. */
  totalPages: number;
}

/**
 * The query `GET /api/admin/jobs` accepts (`jobListQuerySchema`), every field
 * optional. `orgId` narrows to one organization's jobs; omitted, every job is
 * listed, system jobs included.
 *
 * `scheduled: true` OVERRIDES `status` on the server (a row in backoff is
 * `pending` by definition), which is why the Jobs page never sends both.
 *
 * @stability experimental
 */
export type JobListParams = Partial<JobListQuery>;

/**
 * One row of the by-type breakdown (`jobTypeStatsSchema`).
 *
 * @stability experimental
 */
export type JobTypeStats = z.output<typeof jobTypeStatsSchema>;

/**
 * The queue summary, `GET /api/admin/jobs/stats` (`jobStatsSchema`).
 * `stuckThresholdMinutes` is the threshold `stuckRunning` was counted against,
 * so a UI never guesses it.
 *
 * @stability experimental
 */
export type JobStats = z.output<typeof jobStatsSchema>;

/**
 * One job type's duration distribution over the window.
 *
 * @stability experimental
 */
export type JobTypeDurationStats = z.output<typeof jobTypeDurationStatsSchema>;

/**
 * One job type's estimate of the outstanding work (`jobEtaSchema`); read
 * `basis` before trusting `avgMs`.
 *
 * @stability experimental
 */
export type JobEta = z.output<typeof jobEtaSchema>;

/**
 * One job type's all-time totals (`jobLifetimeStatsSchema`).
 *
 * @stability experimental
 */
export type JobLifetimeStats = z.output<typeof jobLifetimeStatsSchema>;

/**
 * Queue analytics, `GET /api/admin/jobs/insights` (`jobInsightsSchema`).
 * `windowDays` is the window actually used, after the API clamped it.
 *
 * @stability experimental
 */
export type JobInsights = z.output<typeof jobInsightsSchema>;

/**
 * The answer of `POST /api/admin/jobs/retry-failed`.
 *
 * @stability experimental
 */
export type RetryFailedResult = z.output<typeof retryFailedResultSchema>;

/**
 * The answer of `POST /api/admin/jobs/reset-stuck`.
 *
 * @stability experimental
 */
export type ResetStuckResult = z.output<typeof resetStuckResultSchema>;

/**
 * The answer of `POST /api/admin/jobs/insights/reset-history`: rollup rows
 * deleted, one per job type.
 *
 * @stability experimental
 */
export type ResetHistoryResult = z.output<typeof resetHistoryResultSchema>;

/**
 * Whether a job may be retried or deleted at all: `false` for a `running` job.
 *
 * A MIRROR of the API's refusal (`job-admin.service.ts` answers 400 for both),
 * not an independent policy: a retry would reset a row an executor is still
 * writing to, and a delete would not stop that executor.
 *
 * @param job - the row (only its `status` is read).
 * @returns `true` when the API accepts a retry or a delete.
 *
 * @stability experimental
 */
export function isJobActionable(job: Pick<Job, 'status'>): boolean {
  return job.status !== 'running';
}

// ---- The worker fleet ----------------------------------------------------------

/**
 * `AdminNodeDto.status`: OPERATOR state, not liveness. `online` accepts
 * claims, `draining` finishes what it holds, `offline` deregistered or swept,
 * `disabled` administratively refused.
 *
 * @stability experimental
 */
export const NODE_STATUSES = ['online', 'draining', 'offline', 'disabled'] as const;

/**
 * One node status.
 *
 * @stability experimental
 */
export type NodeStatus = (typeof NODE_STATUSES)[number];

/**
 * `AdminNodeDto.health`: DERIVED liveness, computed at read time. Read
 * alongside `status`, never instead of it.
 *
 * @stability experimental
 */
export const NODE_HEALTHS = ['healthy', 'stale', 'offline'] as const;

/**
 * One derived node health.
 *
 * @stability experimental
 */
export type NodeHealth = (typeof NODE_HEALTHS)[number];

export { MAX_NODE_CREDENTIAL_DAYS } from '@marinoscar/platform-contract/nodes';

/**
 * The `name` length ceiling of `createNodeCredentialSchema`.
 *
 * @stability experimental
 */
export const MAX_NODE_CREDENTIAL_NAME_LENGTH = 100;

/**
 * Who registered a node or minted a credential (`NodeOwnerDto`).
 *
 * @stability experimental
 */
export interface NodeOwner {
  /** The user's id. */
  id: string;
  /** The user's email address. */
  email: string;
  /** The account's display name, when it has one. */
  name: string | null;
}

/**
 * How many jobs a node holds in each state (`NodeJobCountsDto`). Every key is
 * always present, zero included. `pending` is what an operator calls CLAIMED:
 * assigned to this node and not yet started.
 *
 * @stability experimental
 */
export interface NodeJobCounts {
  /** Jobs this node is running. */
  running: number;
  /** Jobs claimed by this node and not yet started. */
  pending: number;
  /** Jobs this node finished. */
  succeeded: number;
  /** Jobs this node failed. */
  failed: number;
  /** All of the above. */
  total: number;
}

/**
 * One node as `GET /api/admin/nodes` returns it (`AdminNodeDto`).
 *
 * @stability experimental
 */
export interface WorkerNode {
  /** The node id. */
  id: string;
  /** Operator-chosen, unique per owner. */
  name: string;
  /** The machine's hostname. */
  hostname: string;
  /** Self-reported, e.g. `linux-x64`. */
  platform: string;
  /** The node CLI's version. */
  cliVersion: string;
  /** The job types this node declared it can run. May be empty. */
  eligibleTypes: string[];
  /** How many jobs it runs at once. */
  concurrency: number;
  /** Operator state. */
  status: NodeStatus;
  /** Server-derived liveness; nothing here recomputes it. */
  health: NodeHealth;
  /** The node's last self-reported capability summary. Opaque. */
  capabilities: unknown;
  /** When it registered (ISO 8601). */
  registeredAt: string;
  /** `null` when the node has never sent one, which reads as `stale`. */
  lastHeartbeatAt: string | null;
  /** Who registered it. */
  owner: NodeOwner;
  /** The jobs it holds, per state. */
  jobCounts: NodeJobCounts;
  /** The last vitals snapshot, or `null` when the node has never sent one. */
  lastVitals: NodeVitals | null;
  /** When `lastVitals` was received, or `null` with it. */
  lastVitalsAt: string | null;
}

/**
 * One credential as `GET /api/admin/nodes/credentials` returns it
 * (`AdminNodeCredentialDto`). No `token` and no hash; revoked credentials are
 * included, carrying `revokedAt` (the audit trail).
 *
 * @stability experimental
 */
export interface NodeCredential {
  /** The credential id. */
  id: string;
  /** Its display name. */
  name: string;
  /** Non-secret display prefix, e.g. `nod_1a2b`. */
  tokenPrefix: string;
  /** `null` means NEVER EXPIRES, a supported, expected answer. */
  expiresAt: string | null;
  /** `null` means it has never authenticated. */
  lastUsedAt: string | null;
  /** When it was minted (ISO 8601). */
  createdAt: string;
  /** `null` while the credential is still live. */
  revokedAt: string | null;
  /** Who minted it. */
  owner: NodeOwner;
}

/**
 * The response to `POST /api/node-credentials`, the only shape that carries
 * `token`. The server stores a hash and cannot produce the raw value again.
 *
 * @stability experimental
 */
export interface NodeCredentialCreated {
  /** The raw `nod_` token: show it once. */
  token: string;
  /** The credential id. */
  id: string;
  /** Its display name. */
  name: string;
  /** Non-secret display prefix. */
  tokenPrefix: string;
  /** `null` means never expires. */
  expiresAt: string | null;
  /** When it was minted (ISO 8601). */
  createdAt: string;
}

/**
 * The body `POST /api/node-credentials` accepts (`createNodeCredentialSchema`).
 * Omitting `expiresInDays` is a real choice meaning "never expires".
 *
 * @stability experimental
 */
export type CreateNodeCredentialInput = z.input<typeof createNodeCredentialSchema>;

/**
 * A credential's live-ness: `active`, `expired` or `revoked`.
 *
 * @stability experimental
 */
export type NodeCredentialStatus = 'active' | 'expired' | 'revoked';

/**
 * Whether a credential can still authenticate a node right now.
 *
 * A MIRROR of `validateToken`'s two checks (`node-credential.service.ts`):
 * revoked wins, then expiry, and a `null` expiry is not an expiry at all.
 *
 * @param credential - the row (its `expiresAt` and `revokedAt`).
 * @param now - the instant to judge expiry against.
 * @returns the credential's status.
 *
 * @stability experimental
 */
export function nodeCredentialStatus(
  credential: Pick<NodeCredential, 'expiresAt' | 'revokedAt'>,
  now: Date = new Date(),
): NodeCredentialStatus {
  if (credential.revokedAt) return 'revoked';
  // `null` is "never expires", so it must be checked BEFORE the comparison:
  // `new Date(null)` is the epoch, which would read as expired in 1970 and
  // mark every unattended worker credential dead.
  if (credential.expiresAt && new Date(credential.expiresAt).getTime() <= now.getTime()) {
    return 'expired';
  }
  return 'active';
}
