// =============================================================================
// Batched retention purge — the shared loop behind the four retention jobs
// (#681, platform-packages PP-1.10; moved into the jobs slice by #898)
// =============================================================================
//
// `notifications.inbox.purge`, `notifications.deliveries.purge`,
// `audit.events.purge` and `ai.runs.purge` all do the same thing to a different
// table: delete the rows older than a cutoff, a bounded batch at a time. This
// file is that loop, written once, with the semantics `AiUsagePurgeHandler`
// established (`ai/usage/ai-usage-purge.handler.ts`):
//
//   - BATCHED, OLDEST FIRST. `selectIds` reads at most `batchSize` ids older
//     than the cutoff, ordered by `created_at`, and `deleteIds` deletes EXACTLY
//     those ids — never by re-running the `where`, which could reach rows the
//     read never saw. No single statement holds locks on a large slice of a
//     table the application inserts into on every user action.
//   - A SHORT BATCH ENDS THE RUN. Fewer ids than asked for means nothing older
//     than the cutoff is left.
//   - A SAFETY STOP. The loop's exit depends on rows disappearing; a bounded
//     loop stops having done real work if that ever stops being true. The stop
//     logs a warning, and the next run continues from the same cutoff, so the
//     purge is idempotent.
//
// ONE COPY, owned by the jobs slice and exported from it
// (`@marinoscar/platform-api/jobs`). Until #898 the reference app and the ai
// slice each carried a byte-for-byte copy; the ai slice's `ai.runs.purge` and
// the notifications slice's two purges now import this one.
//
// `AiUsagePurgeHandler` and `JobHistoryPurgeHandler` are deliberately NOT moved
// onto this helper (no unrelated refactors in #681); a later change may.
//
// `runRetentionPolicyPurge` wraps the loop in what every retention handler
// also shares: re-read the policy, be a logged no-op while it is disabled, and
// write one summary line per run.
// =============================================================================

import type { Logger } from '@nestjs/common';
import type { RetentionPolicyValue } from '@marinoscar/platform-contract/jobs';

import type { Job } from '../data/jobs-db';

/**
 * Ids per batch — a lock-duration bound, as in `ai-usage-purge.handler.ts`.
 *
 * @stability experimental
 */
export const RETENTION_PURGE_BATCH_SIZE = 5000;

/**
 * Safety stop on the batch loop (5 million rows a run); the next run continues from the same cutoff.
 *
 * @stability experimental
 */
export const RETENTION_PURGE_MAX_BATCHES = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What one {@link purgeInBatches} run did.
 *
 * @stability experimental
 */
export interface BatchedPurgeResult {
  /** Rows the deletes reported removed. */
  deleted: number;
  /** Batches that deleted something (an empty first read is zero batches). */
  batches: number;
  /** True when the loop stopped at `maxBatches` with rows possibly left. */
  hitSafetyStop: boolean;
}

/**
 * The loop's inputs: how to read a batch of ids and how to delete them.
 *
 * @stability experimental
 */
export interface BatchedPurgeOptions {
  /** Reads at most `take` ids older than the cutoff, oldest first. */
  selectIds: (take: number) => Promise<string[]>;
  /** Deletes exactly these ids; returns the count. */
  deleteIds: (ids: string[]) => Promise<number>;
  batchSize?: number;
  maxBatches?: number;
  /** Where the safety-stop warning goes. Optional so the loop stays usable on its own. */
  logger?: Pick<Logger, 'warn'>;
  /** A human phrase for the warning ("notification inbox purge"). */
  what?: string;
}

/**
 * Deletes in bounded batches until a batch comes back short or the safety stop
 * is reached. Errors from `selectIds`/`deleteIds` propagate, so a queue job
 * built on this fails and is retried.
 *
 * @param options - the reader, the deleter and the optional bounds.
 * @returns what the loop deleted, in how many batches, and whether it stopped early.
 * @throws RangeError when `batchSize` or `maxBatches` is not a positive integer.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export async function purgeInBatches(options: BatchedPurgeOptions): Promise<BatchedPurgeResult> {
  const batchSize = options.batchSize ?? RETENTION_PURGE_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? RETENTION_PURGE_MAX_BATCHES;

  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError(`batchSize must be a positive integer, got ${batchSize}`);
  }
  if (!Number.isInteger(maxBatches) || maxBatches < 1) {
    throw new RangeError(`maxBatches must be a positive integer, got ${maxBatches}`);
  }

  let deleted = 0;
  let batches = 0;
  let exhausted = false;

  while (batches < maxBatches) {
    const ids = await options.selectIds(batchSize);

    if (ids.length === 0) {
      exhausted = true;
      break;
    }

    // By the exact ids read, never by re-running the `where`.
    deleted += await options.deleteIds(ids);
    batches += 1;

    if (ids.length < batchSize) {
      exhausted = true;
      break;
    }
  }

  const hitSafetyStop = !exhausted;

  if (hitSafetyStop) {
    options.logger?.warn(
      `${capitalise(options.what ?? 'retention purge')} stopped at its ${maxBatches}-batch safety ` +
        `limit after deleting ${deleted} row(s); the next run continues from the same cutoff.`,
    );
  }

  return { deleted, batches, hitSafetyStop };
}

/**
 * `now - days`, the instant before which a row is purged.
 *
 * @param days - the policy's retention in days.
 * @param now - the clock, in epoch milliseconds (tests pin it).
 * @returns the cutoff instant.
 *
 * @stability experimental
 */
export function retentionCutoff(days: number, now: number = Date.now()): Date {
  return new Date(now - days * DAY_MS);
}

/**
 * What {@link runRetentionPolicyPurge} needs from a retention handler.
 *
 * @stability experimental
 */
export interface RetentionPolicyPurgeOptions {
  job: Pick<Job, 'id'>;
  logger: Pick<Logger, 'log' | 'warn'>;
  /** The policy as read at the start of this run — re-read per run, never cached. */
  policy: RetentionPolicyValue;
  /** The setting's path, for the log lines ("retention.aiRuns"). */
  setting: string;
  /** A human phrase for the log lines, lower case ("AI run purge"). */
  what: string;
  /** What a deleted row is, plural ("AI run(s)"). */
  rows: string;
  /** Reads at most `take` ids older than `cutoff` that this purge may delete, oldest first. */
  selectIds: (cutoff: Date, take: number) => Promise<string[]>;
  /** Deletes exactly these ids; returns the count. */
  deleteIds: (ids: string[]) => Promise<number>;
}

/**
 * The body of every retention handler: a logged no-op while the policy is
 * disabled, otherwise `purgeInBatches` from `now - policy.days` and one summary
 * line (deleted, cutoff, retention days, batches, job id).
 *
 * THE POLICY IS CHECKED HERE AS WELL AS IN THE SCHEDULING TASK, deliberately —
 * the argument `job-history-purge.handler.ts` makes. The 01:00 task is not the
 * only way a purge row appears: an admin rerun of a historical row, or a job
 * queued just before the switch was flipped, would otherwise delete data an
 * operator believes they stopped deleting.
 *
 * @param options - the job, logger, policy and the table's reader and deleter.
 * @returns `null` for the disabled no-op, otherwise the loop's result.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export async function runRetentionPolicyPurge(
  options: RetentionPolicyPurgeOptions,
): Promise<BatchedPurgeResult | null> {
  const { job, logger, policy, setting, what } = options;

  if (!policy.enabled) {
    logger.log(`${capitalise(what)} is disabled (${setting}.enabled); job ${job.id} is a no-op`);

    return null;
  }

  const cutoff = retentionCutoff(policy.days);

  const result = await purgeInBatches({
    selectIds: (take) => options.selectIds(cutoff, take),
    deleteIds: options.deleteIds,
    logger,
    what,
  });

  logger.log(
    `${capitalise(what)} removed ${result.deleted} ${options.rows} created before ` +
      `${cutoff.toISOString()} (retention ${policy.days} day(s)) in ${result.batches} batch(es) ` +
      `(job ${job.id})`,
  );

  return result;
}

function capitalise(phrase: string): string {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}
