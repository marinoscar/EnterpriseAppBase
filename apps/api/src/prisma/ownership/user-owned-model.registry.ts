// =============================================================================
// User-owned data registry (issue #688, PP-1.9)
// =============================================================================
//
// Every Prisma model holding a foreign key to `User` is registered here, with
// the role of each such key (OWNER: the row belongs to the user; ACTOR: the
// row only names a user who acted), what happens to the row when the user's
// data is purged, and whether the user's data export includes it.
//
// It replaces "read every model's block comment and `onDelete`" with one
// declarative list that two things check:
//
//   - test/prisma/user-owned-models.spec.ts: fails when a model gains a `User`
//     relation without an entry, when an entry names a model or field that
//     does not exist, or when a purge policy contradicts the relation's
//     `onDelete`.
//   - ScopedPrismaService (scoped-prisma.service.ts): confines a scoped
//     client's queries on a registered owner model to the scope's user, and
//     refuses every other model.
//
// ⚠ FRAMEWORK-FREE ON PURPOSE, like the registry primitive: the only import
// besides the primitive is the Prisma TYPE `Prisma.ModelName`. Seeds and
// standalone scripts may read it without a Nest container.
//
// Entries are registered by user-owned-model.manifest.ts (platform first, then
// app-registrations/user-owned-models.ts). Consumers import from `./index`.
// =============================================================================

import type { Prisma } from '@prisma/client';

import { defineRegistry } from '../../common/registry';

/**
 * What happens to a registered row when its user's data is purged.
 *
 * Each value names the database behaviour the relation's `onDelete` already
 * implements; the ownership tripwire checks the two agree.
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
 * One registered model.
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
export interface UserOwnedModelDef {
  /** The Prisma model name, PascalCase, e.g. `'UserCredential'`. */
  readonly model: Prisma.ModelName;
  /**
   * The scalar foreign key naming the row's owner, e.g. `'userId'`. Absent for
   * actor-only models. A model with an owner field is what a scoped client
   * may read and write.
   */
  readonly ownerField?: string;
  /**
   * The relation field backing {@link ownerField}, used when a create passes
   * the owner as `{ connect: { id } }` instead of the scalar. Defaults to the
   * owner field without its trailing `Id` (`userId` → `user`, `createdById` →
   * `createdBy`); the tripwire checks it against the schema.
   */
  readonly ownerRelation?: string;
  /** Scalar foreign keys to `User` that record who acted, not who owns. */
  readonly actorFields?: readonly string[];
  /**
   * Applies to {@link ownerField}, or to every actor field when there is no
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

function validate(def: UserOwnedModelDef): void {
  const actors = def.actorFields ?? [];
  if (def.ownerField === undefined && actors.length === 0) {
    throw new Error('declare an ownerField, actorFields, or both');
  }
  if (def.ownerField !== undefined && def.ownerField.trim() === '') {
    throw new Error('ownerField must not be empty');
  }
  if (actors.some((field) => typeof field !== 'string' || field.trim() === '')) {
    throw new Error('actorFields must be non-empty strings');
  }
  if (new Set(actors).size !== actors.length) {
    throw new Error('actorFields must not repeat a field');
  }
  if (def.ownerField !== undefined && actors.includes(def.ownerField)) {
    throw new Error(`"${def.ownerField}" cannot be both the ownerField and an actor field`);
  }
  if (def.ownerRelation !== undefined && def.ownerField === undefined) {
    throw new Error('ownerRelation requires an ownerField');
  }
  if (!['delete', 'detach', 'retain'].includes(def.purge)) {
    throw new Error(`purge must be 'delete', 'detach' or 'retain', not ${JSON.stringify(def.purge)}`);
  }
  if (def.purge === 'retain' && def.ownerField !== undefined) {
    throw new Error("purge 'retain' is only for actor-only models: a user's own rows are deleted or detached");
  }
  if (!['include', 'exclude'].includes(def.export)) {
    throw new Error(`export must be 'include' or 'exclude', not ${JSON.stringify(def.export)}`);
  }
  if (def.exportOmit !== undefined && def.export === 'exclude' && def.exportOmit.length > 0) {
    throw new Error("exportOmit is meaningless when export is 'exclude'");
  }
  if (typeof def.rationale !== 'string' || def.rationale.trim() === '') {
    throw new Error('rationale is required');
  }
}

/**
 * The static registry of models holding a foreign key to `User`, keyed by
 * model name. Filled by `user-owned-model.manifest.ts`; import it from
 * `./index` so it is filled.
 *
 * @stability experimental
 */
export const userOwnedModelRegistry = defineRegistry<UserOwnedModelDef>({
  name: 'user-owned-models',
  idOf: (def) => def.model,
  // A Prisma model name: PascalCase identifier.
  idPattern: /^[A-Z][A-Za-z0-9_]*$/,
  validate,
});

/**
 * Registers a batch of definitions, all or nothing.
 *
 * @throws RegistryError `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 */
export function registerUserOwnedModels(defs: readonly UserOwnedModelDef[]): void {
  userOwnedModelRegistry.registerAll(defs);
}

/** The owner field of a registered model, or `undefined` (actor-only or unregistered). */
export function ownerFieldOf(model: string): string | undefined {
  return userOwnedModelRegistry.get(model)?.ownerField;
}

/**
 * The relation field backing a definition's owner field: `ownerRelation`
 * when given, otherwise the owner field without its trailing `Id`.
 */
export function ownerRelationOf(def: UserOwnedModelDef): string | undefined {
  if (def.ownerField === undefined) return undefined;
  return def.ownerRelation ?? def.ownerField.replace(/Id$/, '');
}
