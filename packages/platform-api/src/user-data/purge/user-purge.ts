// =============================================================================
// The per-user purge: plan and execution (issue #743, PP-9.1)
// =============================================================================
//
// The registry-driven replacement of EvoPath's `user-data-purge.ts`
// (`collectUserObjectIds`, `deleteUserOwnedRows`, `deleteStorageObjects`). The
// keep/delete decision per model comes from the registries; the order from
// the planner. Shared by the user's own deletion, the factory reset (every
// user) and offboarding (`userDisposition: 'purge'`), so a model is decided
// once and every flow covers it.
//
// Every function takes its client (a transaction or the bypass client) as an
// argument and holds no state: callers decide transaction boundaries.
//
// RETRY SAFETY (EvoPath's rules, verbatim):
//   - every delete is a `deleteMany` by owner, so a rerun deletes what is left;
//   - object ids are collected BEFORE rows go, into the payload, and unioned
//     on retry;
//   - a storage failure keeps the row and is counted, never thrown;
//   - running jobs are never cancelled; pending jobs whose subject is a
//     deleted row are deleted (never this job).
// =============================================================================

import type { Logger } from '@nestjs/common';

import type { UserOwnedModelDef } from '../../core/index';
import type { StorageProvider } from '../../storage/index';
import { USER_DATA_OTHER_CATEGORY } from '../user-data.registries';
import type { UserDataCategoryDef, UserDataModelHint, UserDataPurgeDelegate } from '../user-data.types';
import {
  UserDataPlanError,
  backRelationFields,
  delegateName,
  hasField,
  orderForDeletion,
  selfUnlinkFields,
  type PurgeDatamodel,
} from './purge-planner';

/**
 * Largest `IN (...)` list sent in one statement.
 *
 * @stability experimental
 */
export const USER_DATA_CHUNK_SIZE = 1000;

/**
 * One owner model the purge deletes.
 *
 * @stability experimental
 */
export interface UserPurgeStep {
  /** The Prisma model name. */
  readonly model: string;
  /** Its client delegate (`aiRun`). */
  readonly delegate: string;
  /** The owner column. */
  readonly ownerField: string;
  /** Whether the owner column is nullable (user-less rows exist). */
  readonly ownerOptional: boolean;
  /** The category it is deleted in. */
  readonly category: string;
  /** Nullable self-references cleared first. */
  readonly selfUnlink: readonly string[];
  /** Back-relations that must all be empty for a row to go (`keepWhenReferenced`). */
  readonly keepWhenReferenced: readonly string[];
  /** Columns naming storage objects to collect first. */
  readonly storageObjectColumns: readonly string[];
  /** Whether the model has an `id` column (pending jobs naming it are cancelled). */
  readonly hasId: boolean;
  /** Set when another job purges the model. */
  readonly delegateJob?: UserPurgeDelegateStep;
}

/**
 * A delegated model: the job to enqueue.
 *
 * @stability experimental
 */
export interface UserPurgeDelegateStep extends UserDataPurgeDelegate {
  /** The model it covers. */
  readonly model: string;
}

/**
 * An owner model every data reset keeps.
 *
 * @stability experimental
 */
export interface KeptModel {
  /** The model. */
  readonly model: string;
  /** Why it is kept (the hint's `keep`). */
  readonly reason: string;
}

/**
 * What one user owns, for the Danger Zone summary.
 *
 * @stability experimental
 */
export interface UserDataCounts {
  /** Rows per category id. */
  counts: Record<string, number>;
  /** Stored bytes per category id (the storage-object model's category only). */
  bytes: Record<string, number>;
}

/**
 * The purge, computed once at bootstrap.
 *
 * @stability experimental
 */
export interface UserPurgePlan {
  /** Inline deletes, in delete order (storage model and delegated models excluded). */
  readonly steps: readonly UserPurgeStep[];
  /** Delegated models. */
  readonly delegated: readonly UserPurgeStep[];
  /** The storage-object model, deleted in the media step. */
  readonly storage?: UserPurgeStep;
  /** Owner models every data reset keeps, with the reason. */
  readonly kept: readonly KeptModel[];
  /** Every model the purge reaches, per category (storage and delegated included). */
  readonly modelsByCategory: Readonly<Record<string, readonly string[]>>;
  /** The schema it was planned from (for the factory reset and offboarding orders). */
  readonly datamodel: PurgeDatamodel;
}

/**
 * Builds the per-user purge plan from the registered owner models and hints.
 *
 * @param input - the parsed schema, the owner models (the user-owned registry), the hints and the categories.
 * @returns the plan.
 * @throws UserDataPlanError on a cycle, a model the schema lacks, a hint naming
 *   an unknown category, or a storage-object column the model lacks.
 *
 * @stability experimental
 */
export function planUserPurge(input: {
  datamodel: PurgeDatamodel;
  owned: readonly UserOwnedModelDef[];
  hint: (model: string) => UserDataModelHint | undefined;
  categories: readonly UserDataCategoryDef[];
}): UserPurgePlan {
  const { datamodel } = input;
  const categoryIds = new Set(input.categories.map((def) => def.id));
  const kept: { model: string; reason: string }[] = [];
  const candidates: UserPurgeStep[] = [];
  let storage: UserPurgeStep | undefined;

  for (const def of input.owned) {
    if (def.ownerField === undefined) continue;
    const hint = input.hint(def.model);
    if (hint?.keep !== undefined) {
      kept.push({ model: def.model, reason: hint.keep });
      continue;
    }
    const category = hint?.category ?? USER_DATA_OTHER_CATEGORY;
    if (!categoryIds.has(category)) {
      throw new UserDataPlanError(`${def.model} is deleted in category "${category}", which is not registered`, [def.model]);
    }
    const model = datamodel.find((entry) => entry.name === def.model);
    if (!model) throw new UserDataPlanError(`the schema has no model ${def.model}`, [def.model]);
    for (const column of hint?.storageObjectColumns ?? []) {
      if (!hasField(def.model, column, datamodel)) {
        throw new UserDataPlanError(`${def.model} has no column ${column} (storageObjectColumns)`, [def.model]);
      }
    }
    const ownerField = model.fields.find((field) => field.name === def.ownerField);
    const step: UserPurgeStep = {
      model: def.model,
      delegate: delegateName(def.model),
      ownerField: def.ownerField,
      ownerOptional: ownerField?.isOptional ?? false,
      category,
      selfUnlink: selfUnlinkFields(def.model, datamodel),
      keepWhenReferenced: hint?.keepWhenReferenced ? backRelationFields(def.model, datamodel) : [],
      storageObjectColumns: hint?.storageObjectColumns ?? [],
      hasId: hasField(def.model, 'id', datamodel),
      ...(hint?.delegate ? { delegateJob: { ...hint.delegate, model: def.model } } : {}),
    };
    if (hint?.storageObjects) storage = step;
    else candidates.push(step);
  }

  const inline = candidates.filter((step) => !step.delegateJob);
  const order = orderForDeletion(
    inline.map((step) => step.model),
    datamodel,
  );
  const byModel = new Map(inline.map((step) => [step.model, step]));
  const modelsByCategory: Record<string, string[]> = {};
  for (const step of [...candidates, ...(storage ? [storage] : [])]) {
    (modelsByCategory[step.category] ??= []).push(step.model);
  }

  return {
    steps: order.map((name) => byModel.get(name)!),
    delegated: candidates.filter((step) => step.delegateJob),
    ...(storage ? { storage } : {}),
    kept: kept.sort((a, b) => (a.model < b.model ? -1 : 1)),
    modelsByCategory,
    datamodel,
  };
}

/**
 * Splits `items` into lists of at most `size`.
 *
 * @stability experimental
 */
export function chunk<T>(items: readonly T[], size = USER_DATA_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Key-wise sum of two count maps.
 *
 * @stability experimental
 */
export function addCounts(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [key, value] of Object.entries(b)) out[key] = (out[key] ?? 0) + value;
  return out;
}

/**
 * A count map an earlier attempt left on a payload (`{}` for anything else).
 *
 * @stability experimental
 */
export function readCounts(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/** A model delegate of the app's client, or a clear error. */
function model(db: any, step: Pick<UserPurgeStep, 'delegate' | 'model'>): any {
  const delegate = db?.[step.delegate];
  if (!delegate) throw new Error(`the database client has no delegate "${step.delegate}" for model ${step.model}`);
  return delegate;
}

/**
 * Every storage object id one user's purge must delete for these categories:
 * the user's own objects (`files`) and the columns named by
 * `storageObjectColumns` on the included models.
 *
 * @param db - a client (transaction or bypass).
 * @param plan - the purge plan.
 * @param userId - the user.
 * @param categories - the included category ids.
 * @returns distinct ids.
 *
 * @stability experimental
 */
export async function collectUserObjectIds(db: any, plan: UserPurgePlan, userId: string, categories: ReadonlySet<string>): Promise<string[]> {
  const ids = new Set<string>();
  if (plan.storage && categories.has(plan.storage.category)) {
    const rows: { id: string }[] = await model(db, plan.storage).findMany({ where: { [plan.storage.ownerField]: userId }, select: { id: true } });
    rows.forEach((row) => ids.add(row.id));
  }
  for (const step of plan.steps) {
    if (!categories.has(step.category)) continue;
    for (const column of step.storageObjectColumns) {
      const rows: Record<string, unknown>[] = await model(db, step).findMany({
        where: { [step.ownerField]: userId, [column]: { not: null } },
        select: { [column]: true },
      });
      for (const row of rows) if (typeof row[column] === 'string') ids.add(row[column] as string);
    }
  }
  return [...ids];
}

/**
 * What {@link deleteUserRows} did.
 *
 * @stability experimental
 */
export interface DeletedUserRows {
  /** Rows per model. */
  models: Record<string, number>;
  /** Rows per category. */
  categories: Record<string, number>;
  /** Pending jobs whose subject was a deleted row. */
  cancelledJobs: number;
}

/**
 * Deletes one user's rows of the included categories, children before
 * parents, inside the caller's transaction. Clears the `User` columns the
 * included categories name. Never deletes the storage-object model (the
 * media step does) nor a delegated one.
 *
 * @param tx - the transaction client (bypass).
 * @param plan - the purge plan.
 * @param userId - the user.
 * @param options - the included categories, the running job (never cancelled), extra subject ids (the collected objects) and the categories' `clearUserFields`.
 * @returns the counts.
 *
 * @stability experimental
 */
export async function deleteUserRows(
  tx: any,
  plan: UserPurgePlan,
  userId: string,
  options: {
    categories: ReadonlySet<string>;
    jobId: string | null;
    objectIds?: readonly string[];
    clearUserFields?: readonly string[];
  },
): Promise<DeletedUserRows> {
  const out: DeletedUserRows = { models: {}, categories: {}, cancelledJobs: 0 };
  const notThisJob = options.jobId ? { id: { not: options.jobId } } : {};

  const cancelPending = async (subjectIds: readonly string[]) => {
    for (const ids of chunk(subjectIds)) {
      const { count } = await tx.job.deleteMany({ where: { status: 'pending', subjectId: { in: ids }, ...notThisJob } });
      out.cancelledJobs += count;
    }
  };

  for (const step of plan.steps) {
    if (!options.categories.has(step.category)) continue;
    const delegate = model(tx, step);
    const owner = { [step.ownerField]: userId };

    if (step.hasId) {
      const rows: { id: string }[] = await delegate.findMany({ where: owner, select: { id: true } });
      await cancelPending(rows.map((row) => row.id));
    }
    for (const field of step.selfUnlink) {
      await delegate.updateMany({ where: { ...owner, [field]: { not: null } }, data: { [field]: null } });
    }
    const unreferenced = Object.fromEntries(step.keepWhenReferenced.map((field) => [field, { none: {} }]));
    const { count } = await delegate.deleteMany({ where: { ...owner, ...unreferenced } });
    out.models[step.model] = (out.models[step.model] ?? 0) + count;
    out.categories[step.category] = (out.categories[step.category] ?? 0) + count;
  }

  await cancelPending(options.objectIds ?? []);

  const clear = [...new Set(options.clearUserFields ?? [])];
  if (clear.length > 0) {
    await tx.user.updateMany({ where: { id: userId }, data: Object.fromEntries(clear.map((field) => [field, null])) });
  }
  return out;
}

/**
 * What {@link deleteStorageObjects} did.
 *
 * @stability experimental
 */
export interface StorageDeletionCounts {
  /** Objects whose bytes and row were deleted. */
  storageObjectsDeleted: number;
  /** Objects the provider refused; their rows were kept. */
  storageObjectsFailed: number;
}

/**
 * Bytes first (aborting an unfinished multipart upload), then the row. A
 * provider failure keeps the row, is counted and logged under `context`, and
 * never throws.
 *
 * @param db - the bypass client (no transaction: storage is not transactional).
 * @param storage - the active storage provider.
 * @param logger - where failures are logged.
 * @param context - the log prefix (`user.data.purge job <id>`).
 * @param objectIds - the objects.
 * @param storageDelegate - the storage-object model's delegate name. Default `storageObject`.
 * @returns the counts.
 *
 * @stability experimental
 */
export async function deleteStorageObjects(
  db: any,
  storage: Pick<StorageProvider, 'delete' | 'abortMultipartUpload'>,
  logger: Pick<Logger, 'warn'>,
  context: string,
  objectIds: readonly string[],
  storageDelegate = 'storageObject',
): Promise<StorageDeletionCounts> {
  let storageObjectsDeleted = 0;
  let storageObjectsFailed = 0;
  const delegate = db[storageDelegate];

  for (const ids of chunk(objectIds)) {
    const objects: { id: string; storageKey: string; s3UploadId: string | null }[] = await delegate.findMany({
      where: { id: { in: ids } },
      select: { id: true, storageKey: true, s3UploadId: true },
    });
    for (const object of objects) {
      try {
        if (object.s3UploadId) await storage.abortMultipartUpload(object.storageKey, object.s3UploadId);
        await storage.delete(object.storageKey);
      } catch (error) {
        storageObjectsFailed += 1;
        logger.warn(`${context}: could not delete storage object ${object.id}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      // A row already gone (a concurrent delete) is fine.
      const { count } = await delegate.deleteMany({ where: { id: object.id } });
      storageObjectsDeleted += count;
    }
  }
  return { storageObjectsDeleted, storageObjectsFailed };
}

/**
 * Rows one user owns per category (and the stored bytes of the storage
 * model's category), for the Danger Zone summary. Read-only.
 *
 * @param db - a client.
 * @param plan - the purge plan.
 * @param userId - the user.
 * @returns counts per category id, and bytes per category id (storage only).
 *
 * @stability experimental
 */
export async function countUserData(
  db: any,
  plan: UserPurgePlan,
  userId: string,
): Promise<UserDataCounts> {
  const counts: Record<string, number> = {};
  const bytes: Record<string, number> = {};
  const all = [...plan.steps, ...plan.delegated, ...(plan.storage ? [plan.storage] : [])];
  for (const step of all) {
    const where = { [step.ownerField]: userId };
    counts[step.category] = (counts[step.category] ?? 0) + (await model(db, step).count({ where }));
  }
  if (plan.storage) {
    const sum = await model(db, plan.storage).aggregate({ where: { [plan.storage.ownerField]: userId }, _sum: { size: true } });
    const raw = sum?._sum?.size;
    bytes[plan.storage.category] = raw === null || raw === undefined ? 0 : Number(raw);
  }
  return { counts, bytes };
}
