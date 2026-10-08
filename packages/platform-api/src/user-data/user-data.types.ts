// =============================================================================
// The user-data slice's extension types (issue #743, PP-9.1)
// =============================================================================
//
// Framework-free, like every registry entry type: an app declares categories,
// scopes, model hints, factory reset steps and offboarding preconditions as
// data in a manifest, before bootstrap.
//
// The DECISION TABLE both source apps maintained by hand (EvoPath's
// `user-data-purge.ts`, kvox's `scopeIncludes()`) is split three ways:
//
//   - the user-owned data registry of `@marinoscar/platform-api/core` says
//     WHICH models hold a user's rows (`ownerField`);
//   - a model hint here says what a data reset does with them (`keep`, or
//     which `category` they are deleted in, plus the hints the purge needs);
//   - a scope says which categories one request deletes.
//
// The delete ORDER is never written down: the purge planner derives it from
// the schema's relations.
// =============================================================================

import type { UserDataScopeLayer } from '@marinoscar/platform-contract/user-data';

/**
 * A category of user data: the unit a scope selects and the Danger Zone counts.
 *
 * @stability experimental
 * @example
 * ```ts
 * const files: UserDataCategoryDef = {
 *   id: 'files',
 *   label: 'Files',
 *   description: 'Everything you uploaded, and its bytes in object storage.',
 *   content: true,
 * };
 * ```
 */
export interface UserDataCategoryDef {
  /** Stable id, kebab- or camel-case (`files`, `noteTemplates`). Permanent once a result carried it. */
  readonly id: string;
  /** Shown in the Danger Zone. */
  readonly label: string;
  /** One sentence: what is in it. */
  readonly description: string;
  /** Whether the built-in `content` scope deletes it (`false` for credentials and settings). */
  readonly content: boolean;
  /** Display order; lower first. Default 100, ties by id. */
  readonly order?: number;
  /**
   * Columns of the `User` row set to `null` when this category is deleted
   * (the platform's `settings` clears `displayName` and `profileImageUrl`).
   */
  readonly clearUserFields?: readonly string[];
}

/**
 * Which categories a scope deletes: a list of category ids, every category
 * marked `content: true`, or every category.
 *
 * @stability experimental
 */
export type UserDataScopeCategories = readonly string[] | 'content' | 'all';

/**
 * A deletion scope: what one `POST /api/user-data/deletions` deletes.
 *
 * @stability experimental
 * @example
 * ```ts
 * const transcripts: UserDataScopeDef = {
 *   id: 'transcripts',
 *   label: 'Delete my transcripts',
 *   description: 'Every transcript and its audio.',
 *   categories: ['transcripts'],
 *   confirmation: 'TRANSCRIPTS',
 *   layer: 'specific',
 * };
 * ```
 */
export interface UserDataScopeDef {
  /** Stable id. PERMANENT once a queued job carried it. */
  readonly id: string;
  /** The button and dialog title. */
  readonly label: string;
  /** One sentence shown under the label. */
  readonly description: string;
  /** See {@link UserDataScopeCategories}. */
  readonly categories: UserDataScopeCategories;
  /** The exact phrase the request must carry; the API checks it as a zod literal. */
  readonly confirmation: string;
  /** Which layer of the Danger Zone renders it. */
  readonly layer: UserDataScopeLayer;
  /** Display order within its layer; lower first. Default 100, ties by id. */
  readonly order?: number;
  /**
   * `true` to replace a built-in scope of the same id (`everything`,
   * `content`). Without it, registering a built-in id throws: a built-in is
   * never overridden silently.
   */
  readonly overrideBuiltIn?: boolean;
}

/**
 * A job another module runs instead of an inline `deleteMany` (kvox's
 * `kg.purge`, `transcript.purge`): the purge enqueues it, with subject
 * `user:<userId>`, after its own rows commit.
 *
 * @stability experimental
 */
export interface UserDataPurgeDelegate {
  /** The delegated job's type. */
  readonly jobType: string;
  /** The delegated job's payload for one user. */
  payload(userId: string): Record<string, unknown>;
}

/**
 * What a data reset does with one registered owner model. Every model the
 * user-owned registry gives an `ownerField` needs one (the `user-data`
 * conformance suite fails otherwise); a model without a hint is deleted in
 * the `other` category at run time.
 *
 * @typeParam TModel - the model-name type (an app passes `Prisma.ModelName`).
 *
 * @stability experimental
 * @example
 * ```ts
 * const hints: UserDataModelHint[] = [
 *   { model: 'Workout', category: 'workouts' },
 *   { model: 'Exercise', category: 'workouts', keepWhenReferenced: true },
 *   { model: 'UserIdentity', keep: 'Account state: the user keeps signing in with it.' },
 * ];
 * ```
 */
export interface UserDataModelHint<TModel extends string = string> {
  /** The Prisma model name. */
  readonly model: TModel;
  /**
   * Kept by every data reset, with the reason (account, access, audit or
   * deployment state). Exclusive with `category`.
   */
  readonly keep?: string;
  /** The category the rows are deleted in. Default `'other'`. */
  readonly category?: string;
  /**
   * Columns naming `StorageObject` ids whose objects are deleted with the
   * rows. Collected into the job payload BEFORE the rows go (a link row that
   * names a file may cascade away with its parent).
   */
  readonly storageObjectColumns?: readonly string[];
  /**
   * EvoPath's "deleted unless in use": a row still referenced by any
   * back-relation (another owner's row) is kept rather than failing the
   * purge on its `Restrict`.
   */
  readonly keepWhenReferenced?: boolean;
  /** Enqueue another purge job instead of deleting the rows inline. */
  readonly delegate?: UserDataPurgeDelegate;
  /**
   * `true` for THE storage-object model: its rows are not deleted with the
   * others; their ids join the collected objects and the media step deletes
   * the bytes, then the row. A provider failure keeps the row.
   */
  readonly storageObjects?: boolean;
  /**
   * What the factory reset's organization-data step does with an `org`
   * model's rows (all of them, every organization): `'delete'` (default) or
   * `'keep'` (configuration, such as organization settings and credentials).
   */
  readonly factoryReset?: 'delete' | 'keep';
}

/**
 * The context a factory reset step runs with.
 *
 * @stability experimental
 */
export interface FactoryResetStepContext {
  /** The administrator who asked; always kept. */
  readonly actorUserId: string;
  /** The running job's id (never delete it). */
  readonly jobId: string;
}

/**
 * App-specific deployment-level work of the factory reset (EvoPath's custom
 * catalog rows). Runs in its own transaction on the bypass client and
 * returns counts, which accumulate across retries as `step.<id>.<key>`.
 * Must be idempotent: a retry runs it again.
 *
 * @stability experimental
 * @example
 * ```ts
 * registerFactoryResetStep({
 *   id: 'custom-catalog',
 *   phase: 'before-users',
 *   async run(tx: any) {
 *     return { exercises: (await tx.exercise.deleteMany({ where: { ownerUserId: { not: null } } })).count };
 *   },
 * });
 * ```
 */
export interface FactoryResetStepDef {
  /** Stable id (`custom-catalog`). */
  readonly id: string;
  /**
   * `'before-users'`: after every user's data is purged, before nodes are
   * reassigned and other users deleted. `'deployment'`: with the
   * deployment-wide leftovers, after the users are gone.
   */
  readonly phase: 'before-users' | 'deployment';
  /** One sentence for the runbook and logs. */
  readonly description?: string;
  /** The work. `tx` is the app's transaction client (bypass), untyped here. */
  run(tx: any, ctx: FactoryResetStepContext): Promise<Record<string, number>>;
}

/**
 * What an offboarding precondition decides about one organization.
 *
 * @stability experimental
 */
export interface OffboardingPreconditionVerdict {
  /** Whether offboarding may go ahead. */
  readonly passed: boolean;
  /** Why not, for the operator. */
  readonly message?: string;
}

/**
 * A check that must pass before an organization is offboarded, unless the
 * request skips it with a reason recorded in the audit event
 * (`skipExport.reason`). The data export slice (#744) registers "an org
 * export completed in the last 7 days".
 *
 * @stability experimental
 * @example
 * ```ts
 * registerOffboardingPrecondition({
 *   id: 'no-running-jobs',
 *   label: 'No job of the organization is running',
 *   async check({ orgId }, db: any) {
 *     const running = await db.job.count({ where: { orgId, status: 'running' } });
 *     return running === 0 ? { passed: true } : { passed: false, message: `${running} job(s) still running` };
 *   },
 * });
 * ```
 */
export interface OffboardingPreconditionDef {
  /** Stable id. */
  readonly id: string;
  /** Shown in the offboarding dialog. */
  readonly label: string;
  /** The check. `db` is the app's bypass client, untyped here. Read-only. */
  check(ctx: { readonly orgId: string }, db: any): Promise<OffboardingPreconditionVerdict>;
}

/**
 * A legacy job type an app queued before adopting the platform (a job type
 * is permanent once jobs exist): the module registers an alias handler that
 * maps the old payload and runs the platform's `user.data.purge`.
 *
 * @stability experimental
 * @example
 * ```ts
 * UserDataModule.forRoot({
 *   // ...
 *   legacyJobTypes: [{ type: 'user.data_reset', toPayload: (old) => ({ userId: String((old as { userId: string }).userId), scope: 'everything' }) }],
 * });
 * ```
 */
export interface LegacyUserDataJobType {
  /** The old job type (`user.data_reset`). */
  readonly type: string;
  /** Maps the old payload to the platform's `{ userId, scope }`. */
  toPayload(old: unknown): { userId: string; scope: string };
}

/**
 * Work that must run before a user ROW is deleted (the factory reset's other
 * users, offboarding's `userDisposition: 'purge'`), such as the sharing
 * slice's last-admin rule. Never runs for a data reset, which keeps the user.
 *
 * @stability experimental
 * @example
 * ```ts
 * const hook: UserRemovalHook<GroupMembershipPurge> = {
 *   id: 'sharing.group-memberships',
 *   inject: GroupMembershipPurge,
 *   run: async (purge, userId) => ({ ...(await purge.purgeUser(userId)) }),
 * };
 * ```
 */
export interface UserRemovalHook<T = any> {
  /** Stable id, for logs and counts. */
  readonly id: string;
  /** The provider to resolve (a class or token), looked up across modules. */
  readonly inject: unknown;
  /** The work for one user; its counts are summed into the result. */
  run(instance: T, userId: string): Promise<Record<string, number>>;
}
