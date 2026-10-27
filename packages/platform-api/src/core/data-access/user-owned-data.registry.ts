// =============================================================================
// User-owned data registry (issue #688 PP-1.9, moved to core by #699)
// =============================================================================
//
// Every Prisma model holding a foreign key to `User` is registered here, with
// the role of each such key (OWNER: the row belongs to the user; ACTOR: the
// row only names a user who acted), what happens to the row when the user's
// data is purged, and whether the user's data export includes it.
//
// Two things read it:
//
//   - the `userOwnedData` conformance suite (`@marinoscar/platform-api/testing`):
//     fails when a model gains a `User` relation without an entry, when an
//     entry names a model or field that does not exist, or when a purge policy
//     contradicts the relation's `onDelete`;
//   - the scoped client (./scoped-client.ts): confines a scoped client's
//     queries on a registered owner model to the scope's user, and refuses
//     every other model.
//
// ⚠ FRAMEWORK-FREE ON PURPOSE, like the registry primitive: seeds and
// standalone scripts may read it without a Nest container. The app fills it
// from one manifest (platform entries, then its own); a packaged slice
// registers its own models when it is extracted.
// =============================================================================

import { defineRegistry } from '../registry/registry';
import type { UserOwnedModelDef } from './types';

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
 * model name. One per process: the app fills it from a manifest imported
 * before bootstrap, and `RegistryFreezeService` freezes it with every other
 * `defineRegistry` registry.
 *
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * // apps/api/src/prisma/ownership/user-owned-model.manifest.ts
 * registerUserOwnedModels(PLATFORM_USER_OWNED_MODELS);
 * registerUserOwnedModels(APP_USER_OWNED_MODELS);
 *
 * userOwnedModelRegistry.get('UserCredential')?.ownerField; // 'userId'
 * ```
 */
export const userOwnedModelRegistry = defineRegistry<UserOwnedModelDef>({
  name: 'user-owned-models',
  idOf: (def) => def.model,
  // A Prisma model name: PascalCase identifier.
  idPattern: /^[A-Z][A-Za-z0-9_]*$/,
  validate,
});

/**
 * Registers a batch of definitions in {@link userOwnedModelRegistry}, all or
 * nothing.
 *
 * @param defs - the definitions; an app may type them with its own model names.
 * @throws RegistryError `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @stability experimental
 * @example
 * ```ts
 * registerUserOwnedModels([
 *   { model: 'Workout', ownerField: 'userId', purge: 'delete', export: 'include', rationale: "The user's own log." },
 * ]);
 * ```
 */
export function registerUserOwnedModels<TModel extends string>(defs: readonly UserOwnedModelDef<TModel>[]): void {
  userOwnedModelRegistry.registerAll(defs);
}

/**
 * The owner field of a registered model, or `undefined` (actor-only or
 * unregistered).
 *
 * @param model - the Prisma model name.
 * @stability experimental
 * @example
 * ```ts
 * ownerFieldOf('StorageObject'); // 'uploadedById'
 * ```
 */
export function ownerFieldOf(model: string): string | undefined {
  return userOwnedModelRegistry.get(model)?.ownerField;
}

/**
 * The relation field backing a definition's owner field: `ownerRelation`
 * when given, otherwise the owner field without its trailing `Id`.
 *
 * @param def - a registered (or candidate) definition.
 * @stability experimental
 * @example
 * ```ts
 * ownerRelationOf({ model: 'WorkerNode', ownerField: 'createdById', purge: 'delete', export: 'exclude', rationale: 'x' }); // 'createdBy'
 * ```
 */
export function ownerRelationOf(def: UserOwnedModelDef): string | undefined {
  if (def.ownerField === undefined) return undefined;
  return def.ownerRelation ?? def.ownerField.replace(/Id$/, '');
}
