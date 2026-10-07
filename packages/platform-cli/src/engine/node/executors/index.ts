import type {
  ClaimToken,
  DownloadUrlResult,
  JobSecret,
  NodeJob,
  NodeSpanAttributes,
  NodeSpanName,
  UploadUrlResult,
} from '../node-api.js';
import { UnknownJobTypeError } from '../node-errors.js';

// =============================================================================
// The CLI-side executor registry  (issue #274, epic #254)
// =============================================================================
//
// The mirror image of the server's `JobHandlerRegistry`, and deliberately the
// same shape: a fork adds a node-side executor by writing one class and
// registering it, with no wiring anywhere else. The two registries are
// separate because they answer different questions — the server's decides what
// may be enqueued and what a result must look like; this one decides what THIS
// machine can actually run.
//
// A TYPE IN ONE AND NOT THE OTHER IS A REAL STATE, not a bug to design away:
//
//   - Server-only (no executor here) — this node simply never claims it, which
//     is what `eligibleTypes` says, and the in-process worker runs it.
//   - Executor-only (the server does not advertise it) — the server refuses
//     the claim; #273's `--types` validation catches the typo before that.
// =============================================================================

/**
 * The part of the node API an executor may call, all of it for the job it
 * holds. The engine passes its whole `NodeApi`; an executor is typed against
 * this so it cannot settle, renew or claim behind the engine's back.
 *
 * @stability experimental
 */
export interface ExecutorNodeApi {
  /**
   * Mints this job's credential: job-scoped, bounded by the lease, held in
   * memory for the job and never written or logged (CLAUDE.md queue rule 3).
   *
   * @param nodeId - `context.nodeId`.
   * @param jobId - `context.job.id`.
   * @param claimToken - `context.claimToken`, passed through unchanged.
   */
  jobSecret(nodeId: string, jobId: string, claimToken?: ClaimToken): Promise<JobSecret>;
  /**
   * A presigned PUT for the job's output; the SERVER chooses the key.
   *
   * @param nodeId - `context.nodeId`.
   * @param jobId - `context.job.id`.
   * @param contentType - The upload's MIME type.
   * @param claimToken - `context.claimToken`, passed through unchanged.
   */
  uploadUrl(nodeId: string, jobId: string, contentType?: string, claimToken?: ClaimToken): Promise<UploadUrlResult>;
  /**
   * A presigned GET for the job's input object (the engine already streams it
   * to `inputPath` when `requiresInput` is true).
   *
   * @param nodeId - `context.nodeId`.
   * @param jobId - `context.job.id`.
   * @param claimToken - `context.claimToken`, passed through unchanged.
   */
  downloadUrl(nodeId: string, jobId: string, claimToken?: ClaimToken): Promise<DownloadUrlResult>;
}

/**
 * Everything an executor is given. Nothing is reachable except through this.
 *
 * @stability experimental
 */
export interface JobExecutionContext {
  /** The job row as the server leased it. */
  job: NodeJob;
  /** The handler's own parameters, straight from `Job.payload`. */
  params: Record<string, unknown>;
  /**
   * Where the input object was streamed to, when `requiresInput` is true.
   * Guaranteed non-empty for such a type: the engine refuses the job with a
   * NAMED error rather than passing an empty path through.
   */
  inputPath: string | undefined;
  /** The input object's metadata, when there was one. */
  input:
    | {
        /** The input object's id. */
        objectId: string;
        /** Its size in bytes, as a decimal string. */
        size: string;
        /** Its MIME type. */
        mimeType: string;
      }
    | undefined;
  /** For a type that needs its credential or must upload its output. */
  api: ExecutorNodeApi;
  /** This node's id, for every `api` call. */
  nodeId: string;
  /**
   * Which claim of this job the engine is executing (#364).
   *
   * Pass it to EVERY `api` call made against `job.id` — an upload target, a
   * job credential — exactly as the engine passes it to the renewal ticker,
   * the result and the failure. `nodeId` says which machine is calling;
   * without this, a slot that stalled and was re-claimed is indistinguishable
   * from the slot now running the job, and can mint a signed PUT or a database
   * credential against a lease it no longer holds.
   *
   * `undefined` is ordinary, not a fault: an older control plane sends no
   * token, and a row claimed before the column existed sends `null`. Pass the
   * value through unchanged either way — `claimTokenBody` is what decides that
   * the key is omitted rather than sent as `null`, and it is the only place
   * that decision should be made.
   */
  claimToken: ClaimToken;
  /** Aborted on drain and on lease loss. Long work should honour it. */
  signal: AbortSignal;
  /** Structured logging that goes through the daemon's redaction (#275). */
  log(message: string, fields?: Record<string, unknown>): void;
  /**
   * Times `work` as a relayed phase span (#608) — for a phase only the
   * executor can see, such as an upload streamed from inside `execute`.
   * Returns (or rethrows) exactly what `work` does; recording never fails the
   * job. Optional so a hand-built test context need not supply it.
   */
  phase?<T>(
    name: NodeSpanName,
    work: () => Promise<T>,
    attributes?: NodeSpanAttributes | ((result: T) => NodeSpanAttributes | undefined),
  ): Promise<T>;
}

/**
 * One job type this machine can run.
 *
 * @stability experimental
 *
 * `execute` RETURNS the result and THROWS to fail — the same contract the
 * server's handlers use, for the same reason: every provider error, missing
 * file and truncated stream becomes a reported failure with the real message,
 * and nobody has to remember to check a return code.
 *
 * Throw `ProviderRateLimitError` to route a throttle through the server's
 * deferral path instead of burning an attempt.
 */
export interface JobExecutor {
  /** The job type, as the server's handler declares it (permanent once jobs exist). */
  readonly type: string;
  /**
   * Whether the engine should fetch a download URL and stream the input to a
   * temp file before calling `execute`.
   *
   * Declared rather than inferred, so a type that needs an input and did not
   * get one fails with a named error at the top of the job instead of an
   * opaque filesystem error somewhere inside it.
   */
  readonly requiresInput: boolean;
  /**
   * Runs the job: returns the result the server's `nodeResultSchema` expects,
   * throws to fail it.
   *
   * @param context - The job, its params and the node API.
   */
  execute(context: JobExecutionContext): Promise<unknown>;
}

/**
 * A mutable registry. One instance per engine, so tests never share state.
 *
 * @stability experimental
 */
export class ExecutorRegistry {
  private readonly executors = new Map<string, JobExecutor>();

  /**
   * Adds (or replaces) the executor for its type.
   *
   * @param executor - The executor.
   * @returns This registry, for chaining.
   */
  register(executor: JobExecutor): this {
    this.executors.set(executor.type, executor);
    return this;
  }

  /** Every type this node can run. What `register`/`claim` advertise. */
  types(): string[] {
    return [...this.executors.keys()].sort();
  }

  /**
   * Whether this node can run `type`.
   *
   * @param type - A job type.
   * @returns `true` when an executor is registered for it.
   */
  has(type: string): boolean {
    return this.executors.has(type);
  }

  /** Throws `UnknownJobTypeError`, naming what this node CAN run. */
  require(type: string): JobExecutor {
    const executor = this.executors.get(type);
    if (executor === undefined) throw new UnknownJobTypeError(type, this.types());
    return executor;
  }
}
