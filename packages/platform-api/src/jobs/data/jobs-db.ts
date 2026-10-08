// =============================================================================
// The data the jobs and nodes slices read and write, structurally (issue #734)
// =============================================================================
//
// The slices never import a generated Prisma client, not even its types (the
// rule of identity, `identity/data/identity-db.ts`, settings and sharing): the
// package is built, type-checked and tested before any app's `prisma
// generate`, and works with any app that composed the `jobs` fragment of
// `@marinoscar/platform-db` (`Job`, `JobStatsRollup`, `WorkerNode`,
// `NodeCredential`, `JobNodeSecret`).
//
// THE CLIENT ARRIVES THROUGH THE CORE PORT `PLATFORM_PRISMA` and is seen as
// {@link JobsPrisma}. Every delegate method takes Prisma's arguments untyped
// (`JobsQueryArgs`) and returns the model's row: an app's generated client is
// assignable to these shapes as it is, so `new JobsService(prismaService)`
// type-checks in an app's own tests without a cast. A call that `include`s or
// `select`s names the shape it reads with a cast at the call site.
//
// The rows mirror the fragment column for column. A column added to the
// fragment is added here in the same change.
// =============================================================================

/**
 * Prisma's arguments for one delegate call (`where`, `data`, `select`, ...),
 * untyped on purpose: the app's client checks them at run time, and a typed
 * shape here would make the app's generated client unassignable to
 * {@link JobsPrisma}.
 *
 * @stability experimental
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JobsQueryArgs = any;

/**
 * A `where` filter on one model, as Prisma accepts it.
 *
 * @stability experimental
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JobsWhere = { [field: string]: any };

/**
 * The `data` of an update or `updateMany` on `jobs`, as Prisma accepts it.
 *
 * @stability experimental
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JobsUpdateData = { [field: string]: any };

/**
 * The `data` of a `create` on `jobs`, as Prisma accepts it.
 *
 * @stability experimental
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JobsCreateData = { [field: string]: any };

/**
 * A JSON column's value, as Prisma reads it (`Prisma.JsonValue`).
 *
 * @stability experimental
 */
export type JobsJsonValue = string | number | boolean | JobsJsonObject | JobsJsonArray | null;

/**
 * A JSON object, as Prisma reads it.
 *
 * @stability experimental
 */
export type JobsJsonObject = { [Key in string]?: JobsJsonValue };

/**
 * A JSON array, as Prisma reads it.
 *
 * @stability experimental
 */
export interface JobsJsonArray extends Array<JobsJsonValue> {}

/**
 * A JSON value a write accepts (`Prisma.InputJsonValue`).
 *
 * @stability experimental
 */
export type JobsInputJsonValue =
  | string
  | number
  | boolean
  | JobsInputJsonObject
  | JobsInputJsonArray
  | {
      /** Serialises the value. */
      toJSON(): unknown;
    };

/**
 * A JSON object a write accepts.
 *
 * @stability experimental
 */
export type JobsInputJsonObject = { readonly [Key in string]?: JobsInputJsonValue | null };

/**
 * A JSON array a write accepts.
 *
 * @stability experimental
 */
export interface JobsInputJsonArray extends ReadonlyArray<JobsInputJsonValue | null> {}

/**
 * What a batch write returns (`JobsBatchPayload`).
 *
 * @stability experimental
 */
export interface JobsBatchPayload {
  /** How many rows it changed. */
  count: number;
}

// ---- enums --------------------------------------------------------------------------

/**
 * `JobStatus`: where a job is in its lifecycle. `pending` and `running` are
 * active; `succeeded` and `failed` are terminal.
 *
 * @stability stable
 */
export const JobStatus = Object.freeze({
  pending: 'pending',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
} as const);

/**
 * A {@link JobStatus} value.
 *
 * @stability stable
 */
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

/**
 * `JobReason`: why the job was queued.
 *
 * @stability stable
 */
export const JobReason = Object.freeze({
  upload: 'upload',
  rerun: 'rerun',
  backfill: 'backfill',
} as const);

/**
 * A {@link JobReason} value.
 *
 * @stability stable
 */
export type JobReason = (typeof JobReason)[keyof typeof JobReason];

/**
 * `NodeStatus`: a worker node's own lifecycle.
 *
 * @stability stable
 */
export const NodeStatus = Object.freeze({
  online: 'online',
  draining: 'draining',
  offline: 'offline',
  disabled: 'disabled',
} as const);

/**
 * A {@link NodeStatus} value.
 *
 * @stability stable
 */
export type NodeStatus = (typeof NodeStatus)[keyof typeof NodeStatus];

// ---- rows ---------------------------------------------------------------------------

/**
 * One `jobs` row (`Job` in the `jobs` fragment): a unit of background work.
 * Structurally the app's generated `Job`, so a handler written against the
 * app's type is a {@link JobHandler} as it is.
 *
 * @stability stable
 */
export interface Job {
  /** The job id (UUID). */
  id: string;
  /** The handler key (`storage.object.process`). Permanent once rows of it exist. */
  type: string;
  /** The kind of thing the job is about, or `null` for a subject-less job. */
  subjectType: string | null;
  /** Which one. */
  subjectId: string | null;
  /** `${type}:${subjectType}:${subjectId}` while active; unique among active rows. */
  dedupKey: string | null;
  /** Lifecycle status. */
  status: JobStatus;
  /** Why it was queued. */
  reason: JobReason;
  /** Higher runs first. */
  priority: number;
  /** The provider throttle bucket, when the work calls a rate-limited provider. */
  providerKey: string | null;
  /** The model version the work ran under, when there is one. */
  modelVersion: string | null;
  /** The handler's input. */
  payload: JobsJsonValue;
  /** Attempts so far. */
  attempts: number;
  /** The last failure's message. Never secret material. */
  lastError: string | null;
  /** When it was queued. */
  createdAt: Date;
  /** When the current (or last) attempt started. */
  startedAt: Date | null;
  /** When it reached a terminal status. */
  finishedAt: Date | null;
  /** Not claimable before this instant, when set. */
  scheduledFor: Date | null;
  /** When the provider last rate-limited it. */
  rateLimitedAt: Date | null;
  /** Rate-limit deferrals so far. */
  rateLimitHits: number;
  /** The worker node holding it, when a node claimed it. */
  claimedByNodeId: string | null;
  /** When the current claim's lease runs out. */
  leaseExpiresAt: Date | null;
  /** `'server'` or `'node'`: who ran (or runs) the current attempt. */
  executor: string | null;
  /** The claim's fencing token. */
  claimToken: string | null;
  /** The W3C trace context captured at enqueue. */
  traceContext: string | null;
  /** The organization the work belongs to, or `null` for a deployment-wide (system) job (#734). */
  orgId: string | null;
}

/**
 * One `job_stats_rollup` row: lifetime counters of a job type whose history
 * rows were purged.
 *
 * @stability experimental
 */
export interface JobStatsRollup {
  /** The job type. */
  type: string;
  /** Succeeded jobs folded in. */
  succeededCount: number;
  /** Failed jobs folded in. */
  failedCount: number;
  /** Sum of the folded durations, in milliseconds. */
  sumDurationMs: number;
  /** How many durations the sum holds. */
  durationSamples: number;
  /** Last fold. */
  updatedAt: Date;
}

/**
 * One `worker_nodes` row: a registered machine that runs node-eligible jobs.
 *
 * @stability stable
 */
export interface WorkerNode {
  /** The node id (UUID). */
  id: string;
  /** The operator's name for it; unique per owner. */
  name: string;
  /** Reported hostname. */
  hostname: string;
  /** Reported platform (`linux-x64`). */
  platform: string;
  /** Reported CLI version. */
  cliVersion: string;
  /** The job types it offered to run at registration. */
  eligibleTypes: string[];
  /** Slots it runs at once. */
  concurrency: number;
  /** Its status. */
  status: NodeStatus;
  /** Reported capabilities. */
  capabilities: JobsJsonValue;
  /** First registration. */
  registeredAt: Date;
  /** Last heartbeat. */
  lastHeartbeatAt: Date | null;
  /** Last vitals report. */
  lastVitals: JobsJsonValue;
  /** When it was reported. */
  lastVitalsAt: Date | null;
  /** The user whose `nod_` credential registered it. */
  createdById: string;
}

/**
 * One `node_credentials` row: a `nod_` token's hash and metadata. Never the
 * token itself.
 *
 * @stability stable
 */
export interface NodeCredential {
  /** The credential id (UUID). */
  id: string;
  /** The owner. */
  userId: string;
  /** The operator's label. */
  name: string;
  /** SHA-256 of the token. */
  tokenHash: string;
  /** The token's first characters, for display. */
  tokenPrefix: string;
  /** Expiry, when set. */
  expiresAt: Date | null;
  /** Last authentication. */
  lastUsedAt: Date | null;
  /** Creation. */
  createdAt: Date;
  /** Revocation, when revoked. */
  revokedAt: Date | null;
}

/**
 * One `job_node_secrets` row: the HANDLE of a credential brokered to a node
 * for one job. It has no column able to hold the credential itself.
 *
 * @stability stable
 */
export interface JobNodeSecret {
  /** The row id. */
  id: string;
  /** The job the credential was issued for. */
  jobId: string;
  /** The node holding it. */
  nodeId: string;
  /** The broker's kind (`database`). */
  kind: string;
  /** The broker's handle (a role name), never the secret. */
  handle: string;
  /** Issue time. */
  issuedAt: Date;
  /** Bounded by the job's lease. */
  expiresAt: Date;
  /** Revocation, once revoked. */
  revokedAt: Date | null;
}

// ---- delegates ----------------------------------------------------------------------

/**
 * One model delegate of the app's client, structurally.
 *
 * @typeParam Row - the model's row type.
 *
 * @stability experimental
 */
export interface JobsDelegate<Row> {
  /** `findUnique`. */
  findUnique(args: JobsQueryArgs): Promise<Row | null>;
  /** `findFirst`. */
  findFirst(args?: JobsQueryArgs): Promise<Row | null>;
  /** `findMany`. */
  findMany(args?: JobsQueryArgs): Promise<Row[]>;
  /** `create`. */
  create(args: JobsQueryArgs): Promise<Row>;
  /** `update`. */
  update(args: JobsQueryArgs): Promise<Row>;
  /** `upsert`. */
  upsert(args: JobsQueryArgs): Promise<Row>;
  /** `delete`. */
  delete(args: JobsQueryArgs): Promise<Row>;
  /** `updateMany`. */
  updateMany(args: JobsQueryArgs): Promise<JobsBatchPayload>;
  /** `updateManyAndReturn`. */
  updateManyAndReturn(args: JobsQueryArgs): Promise<Row[]>;
  /** `deleteMany`. */
  deleteMany(args?: JobsQueryArgs): Promise<JobsBatchPayload>;
  /** `count`. */
  count(args?: JobsQueryArgs): Promise<number>;
  /** `groupBy`: each row holds the `by` fields and the requested aggregates. */
  groupBy(args: JobsQueryArgs): Promise<JobsGroupByRow[]>;
}

/**
 * One row of a `groupBy`: the grouped-by fields plus the requested aggregates
 * (`_count`, `_min`, ...). Untyped, like the arguments that shaped it.
 *
 * @stability experimental
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JobsGroupByRow = { [field: string]: any };

/**
 * A tagged-template or `Sql` raw query, as Prisma takes it.
 *
 * @stability experimental
 */
export interface JobsRawSql {
  /** The SQL text with placeholders. */
  readonly sql: string;
  /** The bound values. */
  readonly values: readonly unknown[];
}

/**
 * The transaction client the slices work with: the jobs fragment's models
 * plus raw SQL. The app's `JobsTx` is assignable to it.
 *
 * @stability experimental
 */
export interface JobsTx {
  /** `jobs`. */
  job: JobsDelegate<Job>;
  /** `job_stats_rollup`. */
  jobStatsRollup: JobsDelegate<JobStatsRollup>;
  /** `worker_nodes`. */
  workerNode: JobsDelegate<WorkerNode>;
  /** `node_credentials`. */
  nodeCredential: JobsDelegate<NodeCredential>;
  /** `job_node_secrets`. */
  jobNodeSecret: JobsDelegate<JobNodeSecret>;
  /** A tagged-template (or `Sql`) raw query. */
  $queryRaw<T = unknown>(query: TemplateStringsArray | JobsRawSql, ...values: unknown[]): Promise<T>;
  /** A tagged-template (or `Sql`) raw statement; resolves to the affected row count. */
  $executeRaw(query: TemplateStringsArray | JobsRawSql, ...values: unknown[]): Promise<number>;
}

/**
 * The app's Prisma client as the jobs and nodes slices see it: the jobs
 * fragment's models plus an interactive transaction. The value is the app's
 * own client, injected through the core port `PLATFORM_PRISMA`.
 *
 * @stability experimental
 */
export interface JobsPrisma extends JobsTx {
  /** Runs `fn` in one interactive transaction. */
  $transaction<T>(fn: (tx: JobsTx) => Promise<T>, options?: { maxWait?: number; timeout?: number }): Promise<T>;
}

/**
 * The one delegate `JobsService.enqueueWithin` writes through: the caller's
 * own transaction client, whatever else it carries.
 *
 * @stability stable
 */
export interface JobsEnqueueTx {
  /** `jobs`; only `create` is called. */
  job: Pick<JobsDelegate<Job>, 'create'>;
}
