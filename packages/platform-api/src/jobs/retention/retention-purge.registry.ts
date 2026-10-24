// =============================================================================
// The retention purge registry (issue #898)
// =============================================================================
//
// The nightly scheduler (`retention-purge.task.ts`) has to know which job type
// enforces which `retention.*` policy, and only for the purges whose handler is
// loaded in this process: a deployment without the notifications slice never
// queues a job no handler would claim. The purges belong to the slices that own
// the tables (`ai.runs.purge` to ai, the two notification purges to
// notifications, `audit.events.purge` to this slice), so each handler DECLARES
// its own entry from `onModuleInit`, next to `JobHandlerRegistry.register(this)`.
//
// A policy registered with `registerRetentionPolicy` already names its
// `purge.type`, so an app's handler may skip this registry entirely: the
// scheduler also enqueues a policy whose `purge.type` has a mounted handler. An
// entry declared here wins over the policy's own type and phrase.
//
// An instance registry rather than a process-wide map: the entry is true only
// while the handler's module is mounted, which is Nest's lifecycle, not the
// module graph's import time. Provided and exported by `JobsModule`.
// =============================================================================

import { Injectable } from '@nestjs/common';
import type { RetentionPolicyKey } from '@marinoscar/platform-contract/jobs';

import { retentionPolicyRegistry } from './retention-policy.registry';

/**
 * One retention purge: which job type enforces which `retention.*` policy, and
 * what to call it in a log line.
 *
 * @stability experimental
 */
export interface RetentionPurgeEntry {
  /**
   * The `retention` namespace key this purge enforces: a registered policy
   * (`registerRetentionPolicy`), a built-in or an app's.
   */
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
  private readonly entries = new Map<string, RetentionPurgeEntry>();

  /**
   * Declares a purge. Registering a policy again replaces its entry (the last
   * registration wins, like the handler registry).
   *
   * @param entry - the policy, the job type and the log phrase.
   * @throws Error when the policy was not registered with `registerRetentionPolicy` or a field is empty.
   */
  register(entry: RetentionPurgeEntry): void {
    const policy = retentionPolicyRegistry.get(entry.policy);
    if (policy === undefined) {
      throw new Error(
        `RetentionPurgeRegistry.register: "${String(entry.policy)}" is not a registered retention policy ` +
          `(${retentionPolicyRegistry.ids().join(', ')}). Register it first with registerRetentionPolicy.`,
      );
    }
    if (!entry.type?.trim() || !entry.what?.trim()) {
      throw new Error('RetentionPurgeRegistry.register: type and what must be non-empty strings.');
    }

    this.entries.set(entry.policy, { ...entry });
  }

  /**
   * The purge declared for `policy`, if its handler declared one.
   *
   * @param policy - the `retention` key.
   * @returns a copy, or `undefined`.
   */
  get(policy: RetentionPolicyKey): RetentionPurgeEntry | undefined {
    const entry = this.entries.get(policy);

    return entry ? { ...entry } : undefined;
  }

  /**
   * Every registered purge, in the namespace's key order (built-ins first, then the app's policies in registration order).
   *
   * @returns a fresh array of copies.
   */
  list(): RetentionPurgeEntry[] {
    return retentionPolicyRegistry.ids().flatMap((key) => {
      const entry = this.entries.get(key);

      return entry ? [{ ...entry }] : [];
    });
  }
}
