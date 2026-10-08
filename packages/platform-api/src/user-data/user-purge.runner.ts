// =============================================================================
// UserPurgeRunner: the per-user purge as a service (issue #743, PP-9.1)
// =============================================================================
//
// The three-step flow of EvoPath's `UserDataResetHandler`, registry-driven,
// shared by the `user.data.purge` handler, its legacy aliases, the factory
// reset (rows only, every user) and offboarding (`userDisposition: 'purge'`):
//
//   1. Collect   every storage object id the included categories reach, into
//                `payload.objectIds`, BEFORE the rows go (unioned on retry);
//   2. Rows      one transaction (5 minutes), children first; the counts go
//                on `payload.deleted` IN THE SAME COMMIT, added to what an
//                earlier attempt committed;
//   3. Delegates enqueue the delegated purge jobs (queue dedup);
//   4. Media     bytes, then the row; a provider failure keeps the row, is
//                counted in `storageObjectsFailed` and never fails the job.
//
// The result goes to `payload.result` (the queue has no result column).
// =============================================================================

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { trace } from '@opentelemetry/api';
import { USER_DATA_PURGE_JOB_TYPE, type UserDataPurgeResult } from '@marinoscar/platform-contract/user-data';
import { z } from 'zod';

import { AUDIT_SINK, type AuditSink } from '../core/index';
import { JobsService, type Job } from '../jobs/index';
import { MetricsHostService } from '../otel-core/index';
import { STORAGE_PROVIDER, type StorageProvider } from '../storage/index';
import { USER_DATA_DB, type UserDataDbPort } from './ports';
import {
  addCounts,
  collectUserObjectIds,
  deleteStorageObjects,
  deleteUserRows,
  readCounts,
  type DeletedUserRows,
} from './purge/user-purge';
import { UserDataPlanService } from './user-data-plan.service';
import { USER_DATA_AUDIT_ACTIONS, USER_DATA_PURGES_METRIC } from './user-data.metrics';
import { USER_DATA_OPTIONS, type ResolvedUserDataModuleOptions } from './user-data.options';
import { categoriesOfScope, findUserDataScope, userDataCategoryRegistry } from './user-data.registries';

/**
 * The subject type of a `user.data.purge` job: the queue's active dedup over
 * `user.data.purge:user:<userId>` allows one pending or running purge per user.
 *
 * @stability experimental
 */
export const USER_DATA_SUBJECT_TYPE = 'user';

/**
 * The input of a per-user purge, as the job payload carries it.
 *
 * @stability experimental
 */
export const userDataPurgeInputSchema = z.object({
  userId: z.string().uuid(),
  scope: z.string().min(1),
});

/**
 * The payload a `user.data.purge` job accumulates across attempts.
 *
 * @stability experimental
 */
export interface UserDataPurgePayload {
  userId: string;
  scope: string;
  objectIds?: string[];
  deleted?: { models?: Record<string, number>; categories?: Record<string, number>; cancelledJobs?: number };
  delegated?: number;
  media?: { storageObjectsDeleted?: number };
  result?: UserDataPurgeResult;
}

/** The payload object of a job (`{}` for null or a non-object). */
export function payloadOf(job: Pick<Job, 'payload'>): Record<string, unknown> {
  const raw = job.payload as unknown;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

/**
 * Runs per-user purges. See the file header.
 *
 * @stability experimental
 */
@Injectable()
export class UserPurgeRunner {
  private readonly logger = new Logger(UserPurgeRunner.name);

  constructor(
    @Inject(USER_DATA_DB) private readonly db: UserDataDbPort,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly plans: UserDataPlanService,
    private readonly jobs: JobsService,
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
    @Inject(USER_DATA_OPTIONS) private readonly options: ResolvedUserDataModuleOptions,
    @Optional() private readonly moduleRef?: ModuleRef,
    @Optional() private readonly metrics?: MetricsHostService,
  ) {}

  /**
   * The whole `user.data.purge` flow for one job (the handler and every
   * legacy alias call it). Throws on a database error so the queue retries.
   *
   * @param job - the running job (its payload is read for an earlier attempt's progress).
   * @param input - the user and the scope.
   * @returns the result written to `payload.result`.
   */
  async runJob(job: Pick<Job, 'id' | 'payload'>, input: { userId: string; scope: string }): Promise<UserDataPurgeResult> {
    try {
      const result = await this.run(job, input);
      this.metrics?.add(USER_DATA_PURGES_METRIC, 1, { scope: input.scope, outcome: 'succeeded' });
      return result;
    } catch (error) {
      this.metrics?.add(USER_DATA_PURGES_METRIC, 1, { scope: input.scope, outcome: 'failed' });
      throw error;
    }
  }

  private async run(job: Pick<Job, 'id' | 'payload'>, input: { userId: string; scope: string }): Promise<UserDataPurgeResult> {
    const { userId, scope: scopeId } = userDataPurgeInputSchema.parse(input);
    const scope = findUserDataScope(scopeId);
    if (!scope) throw new Error(`user.data.purge job ${job.id}: unknown scope "${scopeId}"`);
    const plan = this.plans.user();
    const categories = new Set(categoriesOfScope(scope));
    const clearUserFields = userDataCategoryRegistry
      .list()
      .filter((def) => categories.has(def.id))
      .flatMap((def) => def.clearUserFields ?? []);
    const payload = payloadOf(job) as Partial<UserDataPurgePayload>;
    const span = trace.getActiveSpan();
    span?.setAttribute('user_data.scope', scopeId);

    // 1. Collect, BEFORE the rows go.
    const previousIds = Array.isArray(payload.objectIds) ? payload.objectIds.filter((id) => typeof id === 'string') : [];
    const collected = await collectUserObjectIds(this.db.system('purge'), plan, userId, categories);
    const objectIds = [...new Set([...previousIds, ...collected])];
    const state: UserDataPurgePayload = { ...(payload as object), userId, scope: scopeId, objectIds } as UserDataPurgePayload;
    await this.writePayload(this.db.system('purge'), job.id, state);

    // 2. Rows, in one transaction with their counts.
    const deleted = await this.db.runAsSystem(
      'purge',
      async (tx) => {
        const rows = await deleteUserRows(tx, plan, userId, { categories, jobId: job.id, objectIds, clearUserFields });
        const next = mergeDeleted(state.deleted, rows);
        await this.writePayload(tx, job.id, { ...state, deleted: next });
        return next;
      },
      { timeout: this.options.txTimeoutMs },
    );
    state.deleted = deleted;

    // 3. Delegated purges (queue dedup makes a retry harmless).
    let delegatedJobs = 0;
    for (const step of plan.delegated) {
      if (!categories.has(step.category) || !step.delegateJob) continue;
      await this.jobs.enqueue({
        type: step.delegateJob.jobType,
        reason: 'rerun',
        subjectType: USER_DATA_SUBJECT_TYPE,
        subjectId: userId,
        payload: step.delegateJob.payload(userId) as never,
        orgId: null,
      });
      delegatedJobs += 1;
    }

    // 4. Media: bytes, then rows. Never throws on a provider failure.
    const media = await deleteStorageObjects(
      this.db.system('purge'),
      this.storage,
      this.logger,
      `${USER_DATA_PURGE_JOB_TYPE} job ${job.id}`,
      objectIds,
      plan.storage?.delegate,
    );
    const storageObjectsDeleted = (state.media?.storageObjectsDeleted ?? 0) + media.storageObjectsDeleted;
    const categoriesDone = { ...(deleted.categories ?? {}) };
    if (plan.storage && categories.has(plan.storage.category)) {
      categoriesDone[plan.storage.category] = (categoriesDone[plan.storage.category] ?? 0) + storageObjectsDeleted;
    }
    const result: UserDataPurgeResult = {
      categories: categoriesDone,
      models: deleted.models ?? {},
      storageObjectsDeleted,
      storageObjectsFailed: media.storageObjectsFailed,
      cancelledJobs: deleted.cancelledJobs ?? 0,
      delegatedJobs,
    };
    await this.writePayload(this.db.system('purge'), job.id, {
      ...state,
      delegated: delegatedJobs,
      media: { storageObjectsDeleted },
      result,
    });

    span?.setAttributes({
      'user_data.rows_deleted': Object.values(result.models).reduce((sum, n) => sum + n, 0),
      'user_data.storage_objects_deleted': result.storageObjectsDeleted,
      'user_data.storage_objects_failed': result.storageObjectsFailed,
    });
    await this.audit.record({
      action: USER_DATA_AUDIT_ACTIONS.PURGE_COMPLETED,
      actorUserId: userId,
      targetType: 'user',
      targetId: userId,
      meta: {
        jobId: job.id,
        scope: scopeId,
        storageObjectsDeleted: result.storageObjectsDeleted,
        storageObjectsFailed: result.storageObjectsFailed,
        cancelledJobs: result.cancelledJobs,
      },
    });
    if (result.storageObjectsFailed > 0) {
      this.logger.warn(`${USER_DATA_PURGE_JOB_TYPE} job ${job.id}: ${result.storageObjectsFailed} storage object(s) kept after a provider failure`);
    }
    return result;
  }

  /**
   * Deletes every row of one user the `everything` scope reaches, inside the
   * caller's transaction (the factory reset's per-user step). Storage objects
   * are left to the caller.
   *
   * @param tx - the bypass transaction.
   * @param userId - the user.
   * @param jobId - the running job (never cancelled).
   * @returns the counts.
   */
  async deleteEverythingRows(tx: unknown, userId: string, jobId: string): Promise<DeletedUserRows> {
    const categories = new Set(userDataCategoryRegistry.ids());
    const clearUserFields = userDataCategoryRegistry.list().flatMap((def) => def.clearUserFields ?? []);
    return deleteUserRows(tx, this.plans.user(), userId, { categories, jobId, clearUserFields });
  }

  /**
   * Runs every `userRemovalHooks` entry for a user about to be deleted.
   *
   * @param userId - the user.
   * @returns the summed counts, keyed `<hookId>.<key>`.
   */
  async runRemovalHooks(userId: string): Promise<Record<string, number>> {
    let out: Record<string, number> = {};
    for (const hook of this.options.userRemovalHooks) {
      const instance = this.moduleRef?.get(hook.inject as never, { strict: false });
      if (instance === undefined || instance === null) {
        throw new Error(`user removal hook "${hook.id}": its provider is not available in the application`);
      }
      const counts = await hook.run(instance, userId);
      out = addCounts(out, Object.fromEntries(Object.entries(counts).map(([key, value]) => [`${hook.id}.${key}`, value])));
    }
    return out;
  }

  /**
   * Purges one user completely and deletes the user row (offboarding's
   * `userDisposition: 'purge'`): every row (one transaction), the media,
   * the removal hooks, then the user.
   *
   * @param userId - the user.
   * @param jobId - the running job.
   * @returns counts: rows per category, storage objects, hooks, `usersDeleted`.
   */
  async purgeAndRemoveUser(userId: string, jobId: string): Promise<Record<string, number>> {
    const plan = this.plans.user();
    const categories = new Set(userDataCategoryRegistry.ids());
    const objectIds = await collectUserObjectIds(this.db.system('purge'), plan, userId, categories);
    const rows = await this.db.runAsSystem('purge', (tx) => this.deleteEverythingRows(tx, userId, jobId), { timeout: this.options.txTimeoutMs });
    const media = await deleteStorageObjects(
      this.db.system('purge'),
      this.storage,
      this.logger,
      `user purge ${userId}`,
      objectIds,
      plan.storage?.delegate,
    );
    const hooks = await this.runRemovalHooks(userId);
    const { count } = await this.db.system('purge').user.deleteMany({ where: { id: userId } });
    return addCounts(
      addCounts(
        Object.fromEntries(Object.entries(rows.categories).map(([key, value]) => [`category.${key}`, value])),
        { storageObjectsDeleted: media.storageObjectsDeleted, storageObjectsFailed: media.storageObjectsFailed, usersDeleted: count },
      ),
      hooks,
    );
  }

  private async writePayload(db: any, jobId: string, payload: UserDataPurgePayload | Record<string, unknown>): Promise<void> {
    await db.job.update({ where: { id: jobId }, data: { payload } });
  }
}

/** Adds an attempt's row counts to what earlier attempts committed. */
function mergeDeleted(previous: UserDataPurgePayload['deleted'], rows: DeletedUserRows): Required<NonNullable<UserDataPurgePayload['deleted']>> {
  return {
    models: addCounts(readCounts(previous?.models), rows.models),
    categories: addCounts(readCounts(previous?.categories), rows.categories),
    cancelledJobs: (typeof previous?.cancelledJobs === 'number' ? previous.cancelledJobs : 0) + rows.cancelledJobs,
  };
}
