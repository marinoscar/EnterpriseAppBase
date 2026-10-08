// =============================================================================
// The user-data slice's registries (issue #743, PP-9.1)
// =============================================================================
//
// Five static registries, filled by the app's user-data manifest (platform
// entries first, then the app's) before bootstrap and frozen with every other
// `defineRegistry` registry by `RegistryFreezeService`:
//
//   categories       what the Danger Zone counts and a scope selects
//   scopes           what one deletion request deletes (+ two built-ins)
//   model hints      what a data reset does with each owner model
//   factory steps    app deployment-level work of the factory reset
//   preconditions    checks before an organization is offboarded
//
// THE BUILT-IN SCOPES are not registry entries: `resolvedUserDataScopes()`
// merges them under the registered ones. Registering `everything` or
// `content` without `overrideBuiltIn: true` throws (kvox re-registers
// `content` with its own phrase, explicitly).
// =============================================================================

import {
  USER_DATA_CONTENT_CONFIRMATION,
  USER_DATA_CONTENT_SCOPE,
  USER_DATA_EVERYTHING_CONFIRMATION,
  USER_DATA_EVERYTHING_SCOPE,
  USER_DATA_SCOPE_LAYERS,
} from '@marinoscar/platform-contract/user-data';

import { defineRegistry } from '../core/index';
import type {
  FactoryResetStepDef,
  OffboardingPreconditionDef,
  UserDataCategoryDef,
  UserDataModelHint,
  UserDataScopeDef,
} from './user-data.types';

/** Category and scope ids: a letter, then letters, digits, `-`, `_` or `.`. */
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;

/**
 * The category a model without a hint is deleted in.
 *
 * @stability experimental
 */
export const USER_DATA_OTHER_CATEGORY = 'other';

function nonEmpty(value: unknown, name: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} is required`);
}

/**
 * The registered user-data categories, in display order.
 *
 * @stability experimental
 */
export const userDataCategoryRegistry = defineRegistry<UserDataCategoryDef>({
  name: 'user-data-categories',
  idOf: (def) => def.id,
  idPattern: ID_PATTERN,
  order: (a, b) => (a.order ?? 100) - (b.order ?? 100) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  validate(def) {
    nonEmpty(def.label, 'label');
    nonEmpty(def.description, 'description');
    if (typeof def.content !== 'boolean') throw new Error('content must be a boolean');
    for (const field of def.clearUserFields ?? []) nonEmpty(field, 'clearUserFields[]');
  },
});

/**
 * Registers one user-data category.
 *
 * @param def - the category.
 * @throws RegistryError `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerUserDataCategory({ id: 'transcripts', label: 'Transcripts', description: 'Your transcripts and their audio.', content: true });
 * ```
 */
export function registerUserDataCategory(def: UserDataCategoryDef): void {
  userDataCategoryRegistry.register(def);
}

const BUILT_IN_SCOPE_IDS: readonly string[] = [USER_DATA_EVERYTHING_SCOPE, USER_DATA_CONTENT_SCOPE];

/**
 * The registered user-data scopes (built-ins excluded; see
 * {@link resolvedUserDataScopes}).
 *
 * @stability experimental
 */
export const userDataScopeRegistry = defineRegistry<UserDataScopeDef>({
  name: 'user-data-scopes',
  idOf: (def) => def.id,
  idPattern: ID_PATTERN,
  validate(def) {
    nonEmpty(def.label, 'label');
    nonEmpty(def.description, 'description');
    nonEmpty(def.confirmation, 'confirmation');
    if (!(USER_DATA_SCOPE_LAYERS as readonly string[]).includes(def.layer)) {
      throw new Error(`layer must be one of ${USER_DATA_SCOPE_LAYERS.join(', ')}`);
    }
    const cats = def.categories;
    if (cats !== 'all' && cats !== 'content') {
      if (!Array.isArray(cats) || cats.length === 0) throw new Error("categories must be 'all', 'content' or a non-empty list");
      for (const id of cats) nonEmpty(id, 'categories[]');
    }
    if (BUILT_IN_SCOPE_IDS.includes(def.id) && def.overrideBuiltIn !== true) {
      throw new Error(`"${def.id}" is a built-in scope; pass overrideBuiltIn: true to replace it`);
    }
    if (!BUILT_IN_SCOPE_IDS.includes(def.id) && def.overrideBuiltIn === true) {
      throw new Error(`overrideBuiltIn is only for a built-in scope (${BUILT_IN_SCOPE_IDS.join(', ')})`);
    }
  },
});

/**
 * Registers one deletion scope.
 *
 * @param def - the scope.
 * @throws RegistryError `INVALID_ENTRY` (a built-in id without `overrideBuiltIn`, a bad layer), `DUPLICATE_ID` or `FROZEN`.
 *
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerUserDataScope({
 *   id: 'transcripts', label: 'Delete my transcripts', description: 'Every transcript.',
 *   categories: ['transcripts'], confirmation: 'TRANSCRIPTS', layer: 'specific',
 * });
 * ```
 */
export function registerUserDataScope(def: UserDataScopeDef): void {
  userDataScopeRegistry.register(def);
}

/**
 * The two built-in scopes: `everything` (every category, `DELETE MY DATA`)
 * and `content` (categories marked `content`, `DELETE MY CONTENT`).
 *
 * @stability experimental
 */
export const BUILT_IN_USER_DATA_SCOPES: readonly UserDataScopeDef[] = Object.freeze([
  Object.freeze({
    id: USER_DATA_CONTENT_SCOPE,
    label: 'Delete my content',
    description: 'Everything you created, keeping your credentials and settings.',
    categories: 'content' as const,
    confirmation: USER_DATA_CONTENT_CONFIRMATION,
    layer: 'danger' as const,
    order: 10,
  }),
  Object.freeze({
    id: USER_DATA_EVERYTHING_SCOPE,
    label: 'Delete all my data',
    description: 'Everything you own, including access tokens and settings. Your account stays.',
    categories: 'all' as const,
    confirmation: USER_DATA_EVERYTHING_CONFIRMATION,
    layer: 'danger' as const,
    order: 20,
  }),
]);

/**
 * Every scope a request may name: the built-ins (unless overridden) and the
 * registered ones, sorted by layer (`specific` first), then order, then id.
 *
 * @returns a new array.
 *
 * @stability experimental
 */
export function resolvedUserDataScopes(): UserDataScopeDef[] {
  const registered = userDataScopeRegistry.list();
  const ids = new Set(registered.map((def) => def.id));
  const all = [...BUILT_IN_USER_DATA_SCOPES.filter((def) => !ids.has(def.id)), ...registered];
  const layerIndex = (def: UserDataScopeDef) => USER_DATA_SCOPE_LAYERS.indexOf(def.layer);
  return all.sort(
    (a, b) => layerIndex(a) - layerIndex(b) || (a.order ?? 100) - (b.order ?? 100) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * The scope a request names, or `undefined`.
 *
 * @param id - the scope id.
 * @stability experimental
 */
export function findUserDataScope(id: string): UserDataScopeDef | undefined {
  return resolvedUserDataScopes().find((def) => def.id === id);
}

/**
 * The category ids a scope deletes, resolved against the registered
 * categories (unknown ids are dropped; the conformance suite reports them).
 *
 * @param scope - the scope.
 * @returns category ids, in category display order.
 *
 * @stability experimental
 */
export function categoriesOfScope(scope: Pick<UserDataScopeDef, 'categories'>): string[] {
  const all = userDataCategoryRegistry.list();
  if (scope.categories === 'all') return all.map((def) => def.id);
  if (scope.categories === 'content') return all.filter((def) => def.content).map((def) => def.id);
  const wanted = new Set(scope.categories);
  return all.filter((def) => wanted.has(def.id)).map((def) => def.id);
}

/**
 * The registered model hints, keyed by model name.
 *
 * @stability experimental
 * @extensionPoint registry
 */
export const userDataModelRegistry = defineRegistry<UserDataModelHint>({
  name: 'user-data-models',
  idOf: (def) => def.model,
  idPattern: /^[A-Z][A-Za-z0-9_]*$/,
  validate(def) {
    if (def.keep !== undefined) {
      nonEmpty(def.keep, 'keep (the reason)');
      if (def.category !== undefined || def.storageObjectColumns || def.keepWhenReferenced || def.delegate || def.storageObjects) {
        throw new Error('a kept model takes no category, storageObjectColumns, keepWhenReferenced, delegate or storageObjects');
      }
    }
    if (def.category !== undefined && !ID_PATTERN.test(def.category)) throw new Error(`category "${def.category}" is not a valid id`);
    for (const column of def.storageObjectColumns ?? []) nonEmpty(column, 'storageObjectColumns[]');
    if (def.delegate !== undefined) {
      nonEmpty(def.delegate.jobType, 'delegate.jobType');
      if (typeof def.delegate.payload !== 'function') throw new Error('delegate.payload must be a function');
      if (def.keepWhenReferenced || def.storageObjects) throw new Error('a delegated model takes no keepWhenReferenced or storageObjects');
    }
    if (def.factoryReset !== undefined && def.factoryReset !== 'delete' && def.factoryReset !== 'keep') {
      throw new Error("factoryReset must be 'delete' or 'keep'");
    }
  },
});

/**
 * Registers a batch of model hints, all or nothing. Also refuses a second
 * `storageObjects: true` model.
 *
 * @param defs - the hints; an app may type them with its own model names.
 * @throws RegistryError `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerUserDataModels([{ model: 'Transcript', category: 'transcripts', storageObjectColumns: ['audioObjectId'] }]);
 * ```
 */
export function registerUserDataModels<TModel extends string>(defs: readonly UserDataModelHint<TModel>[]): void {
  const storage = [...userDataModelRegistry.list(), ...defs].filter((def) => def.storageObjects === true);
  if (storage.length > 1) {
    throw new Error(`registerUserDataModels: only one model may carry storageObjects: true (${storage.map((d) => d.model).join(', ')})`);
  }
  userDataModelRegistry.registerAll(defs);
}

/**
 * The model flagged `storageObjects: true`, or `undefined`.
 *
 * @stability experimental
 */
export function storageObjectModelHint(): UserDataModelHint | undefined {
  return userDataModelRegistry.list().find((def) => def.storageObjects === true);
}

/**
 * The registered factory reset steps, in registration order.
 *
 * @stability experimental
 */
export const factoryResetStepRegistry = defineRegistry<FactoryResetStepDef>({
  name: 'factory-reset-steps',
  idOf: (def) => def.id,
  idPattern: ID_PATTERN,
  validate(def) {
    if (def.phase !== 'before-users' && def.phase !== 'deployment') throw new Error("phase must be 'before-users' or 'deployment'");
    if (typeof def.run !== 'function') throw new Error('run must be a function');
  },
});

/**
 * Registers one factory reset step.
 *
 * @param def - the step.
 * @throws RegistryError `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerFactoryResetStep({ id: 'custom-catalog', phase: 'before-users', run: async (tx: any) => ({ rows: (await tx.exercise.deleteMany({ where: { ownerUserId: { not: null } } })).count }) });
 * ```
 */
export function registerFactoryResetStep(def: FactoryResetStepDef): void {
  factoryResetStepRegistry.register(def);
}

/**
 * The registered offboarding preconditions, in registration order.
 *
 * @stability experimental
 */
export const offboardingPreconditionRegistry = defineRegistry<OffboardingPreconditionDef>({
  name: 'offboarding-preconditions',
  idOf: (def) => def.id,
  idPattern: ID_PATTERN,
  validate(def) {
    nonEmpty(def.label, 'label');
    if (typeof def.check !== 'function') throw new Error('check must be a function');
  },
});

/**
 * Registers one offboarding precondition.
 *
 * @param def - the precondition.
 * @throws RegistryError `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerOffboardingPrecondition({ id: 'recent-export', label: 'An export completed in the last 7 days', check: async () => ({ passed: true }) });
 * ```
 */
export function registerOffboardingPrecondition(def: OffboardingPreconditionDef): void {
  offboardingPreconditionRegistry.register(def);
}
