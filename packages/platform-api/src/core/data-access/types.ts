// =============================================================================
// User-owned data: policy types (issue #688 PP-1.9, moved to core by #699)
// =============================================================================
//
// Schema-independent on purpose: a model is a string. An app narrows it to its
// own generated `Prisma.ModelName` with the type parameter, so a typo in a
// registration still fails its typecheck while the package never sees the
// app's generated types.
// =============================================================================

/**
 * What happens to a registered row when its user's data is purged.
 *
 * Each value names the database behaviour the relation's `onDelete` already
 * implements; the `userOwnedData` conformance suite checks the two agree.
 *
 * - `'delete'`: the row is deleted with the user's data (`onDelete: Cascade`).
 * - `'detach'`: the row survives and the user reference is nulled
 *   (`onDelete: SetNull`).
 * - `'retain'`: the row survives untouched and the user cannot be deleted
 *   while it exists (`onDelete: Restrict` or `NoAction`). Only for actor
 *   fields on rows another owner controls, and the rationale must say why.
 *
 * @stability experimental
 */
export type PurgePolicy = 'delete' | 'detach' | 'retain';

/**
 * Whether a user's data export includes the row.
 *
 * @stability experimental
 */
export type ExportPolicy = 'include' | 'exclude';

/**
 * One registered model: every model holding a foreign key to `User` has one,
 * naming the role of each such key, a purge and an export policy.
 *
 * @typeParam TModel - the model-name type. Apps pass their generated
 * `Prisma.ModelName` so a misspelt model fails to compile; the registry itself
 * stores plain strings.
 *
 * @stability experimental
 * @example
 * ```ts
 * const def: UserOwnedModelDef = {
 *   model: 'UserCredential',
 *   ownerField: 'userId',
 *   purge: 'delete',
 *   export: 'include',
 *   exportOmit: ['secret'],
 *   rationale: "A user's own encrypted key; the ciphertext never leaves the server.",
 * };
 * ```
 */
export interface UserOwnedModelDef<TModel extends string = string> {
  /** The Prisma model name, PascalCase, e.g. `'UserCredential'`. */
  readonly model: TModel;
  /**
   * The scalar foreign key naming the row's owner, e.g. `'userId'`. Absent for
   * actor-only models. A model with an owner field is what a scoped client
   * may read and write.
   */
  readonly ownerField?: string;
  /**
   * The relation field backing {@link UserOwnedModelDef.ownerField}, used when
   * a create passes the owner as `{ connect: { id } }` instead of the scalar.
   * Defaults to the owner field without its trailing `Id` (`userId` → `user`,
   * `createdById` → `createdBy`); the conformance suite checks it against the
   * schema.
   */
  readonly ownerRelation?: string;
  /** Scalar foreign keys to `User` that record who acted, not who owns. */
  readonly actorFields?: readonly string[];
  /**
   * Applies to the owner field, or to every actor field when there is no
   * owner. See {@link PurgePolicy}.
   */
  readonly purge: PurgePolicy;
  /** See {@link ExportPolicy}. */
  readonly export: ExportPolicy;
  /** Columns never exported even when `export` is `'include'` (secrets, hashes). */
  readonly exportOmit?: readonly string[];
  /** One or two sentences: why this role and these policies. Rendered in docs. */
  readonly rationale: string;
}

/**
 * The one capability a scoped client needs from a registry: look a model up.
 * {@link userOwnedModelRegistry} satisfies it; tests pass a fixture.
 *
 * @stability experimental
 */
export interface UserOwnedModelLookup {
  /** The registered definition of `model`, or `undefined`. */
  get(model: string): UserOwnedModelDef | undefined;
}
