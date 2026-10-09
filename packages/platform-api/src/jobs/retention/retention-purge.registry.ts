// =============================================================================
// The retention purge registry (issue #898)
// =============================================================================
//
// The nightly scheduler (`retention-purge.task.ts`) has to know which job type
// enforces which `retention.*` policy. Until #898 that was a hard-coded list in
// the reference app. The purges belong to the slices that own the tables
// (`ai.runs.purge` to ai, the two notification purges to notifications,
// `audit.events.purge` to this slice), so each handler DECLARES its own entry
// from `onModuleInit`, next to `JobHandlerRegistry.register(this)`, and the
// scheduler enqueues exactly the purges whose handler is loaded in this
// process. A deployment without the notifications slice never queues a job no
// handler would claim.
//
// An instance registry rather than a process-wide map: the entry is true only
// while the handler's module is mounted, which is Nest's lifecycle, not the
// module graph's import time. Provided and exported by `JobsModule`.
// =============================================================================

import { Injectable } from '@nestjs/common';
import { RETENTION_POLICY_KEYS, type RetentionPolicyKey } from '@marinoscar/platform-contract/jobs';

/**
 * One retention purge: which job type enforces which `retention.*` policy, and
 * what to call it in a log line.
 *
 * @stability experimental
 */
export interface RetentionPurgeEntry {
  /** The `retention` namespace key this purge enforces. */
  policy: RetentionPolicyKey;
  /** The purge's job type. The handler's own `type`, never re-typed. */
  type: string;
  /** A human phrase for the scheduler's log lines ("notification inbox purge"). */
  what: string;
}

/**
 * The retention purges mounted in this process, in the namespace's key order.
 * A purge handler calls {@link RetentionPurgeRegistry.register} from
 * `onModuleInit`; the nightly {@link RetentionPurgeTask} enqueues one job per
 * enabled policy it lists.
 *
 * @example
 * ```ts
 * onModuleInit(): void {
 *   this.registry.register(this);
 *   this.retention.register({ policy: 'aiRuns', type: this.type, what: 'AI run purge' });
 * }
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
@Injectable()
export class RetentionPurgeRegistry {
  private readonly entries = new Map<RetentionPolicyKey, RetentionPurgeEntry>();

  /**
   * Declares a purge. Registering a policy again replaces its entry (the last
   * registration wins, like the handler registry).
   *
   * @param entry - the policy, the job type and the log phrase.
   * @throws Error when the policy is not a `retention` namespace key or a field is empty.
   */
  register(entry: RetentionPurgeEntry): void {
    if (!(RETENTION_POLICY_KEYS as readonly string[]).includes(entry.policy)) {
      throw new Error(
        `RetentionPurgeRegistry.register: "${String(entry.policy)}" is not a retention policy key ` +
          `(${RETENTION_POLICY_KEYS.join(', ')}).`,
      );
    }
    if (!entry.type?.trim() || !entry.what?.trim()) {
      throw new Error('RetentionPurgeRegistry.register: type and what must be non-empty strings.');
    }

    this.entries.set(entry.policy, { ...entry });
  }

  /**
   * Every registered purge, in the namespace's key order.
   *
   * @returns a fresh array of copies.
   */
  list(): RetentionPurgeEntry[] {
    return RETENTION_POLICY_KEYS.flatMap((key) => {
      const entry = this.entries.get(key);

      return entry ? [{ ...entry }] : [];
    });
  }
}
