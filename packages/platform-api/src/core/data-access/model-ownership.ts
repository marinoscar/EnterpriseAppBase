// =============================================================================
// Model ownership kinds (issue #725 PP-6.5, extending the PP-1.9 registry)
// =============================================================================
//
// Every Prisma model is exactly one of four kinds. The kind decides who may see
// a row and which client reaches it:
//
//   org           Belongs to one organisation. Carries a NOT NULL `org_id`,
//                 has row-level security forced on it, and is reached through
//                 `forOrg` / `runInOrg` (the tenant pool) or the system client.
//   org-optional  Carries a NULLABLE `org_id` (system events have none) and, in
//                 this release, NO row-level security. Reached by any client.
//   user          Personal to one user (`forUser` scope). No organisation.
//   system        Deployment-wide. No organisation, no ownership.
//
// The registry is the single list the `rls-coverage` tripwire and the Doctor
// read: every model registered `org` must have `relrowsecurity`,
// `relforcerowsecurity` and a policy named in `RLS_POLICIES`, and no
// unregistered table may carry an `org_id` column.
//
// FRAMEWORK-FREE like the registry primitive and the user-owned registry, so
// seeds and standalone scripts can read it without a Nest container.
// =============================================================================

import { defineRegistry } from '../registry/registry';

/**
 * Who owns a model's rows. See the file header.
 *
 * @stability experimental
 */
export type OwnershipKind = 'org' | 'org-optional' | 'user' | 'system';

/**
 * One model's ownership classification.
 *
 * @typeParam TModel - the model-name type; an app passes its generated
 * `Prisma.ModelName` so a misspelt model fails to compile.
 *
 * @stability experimental
 * @example
 * ```ts
 * const def: ModelOwnershipDef = {
 *   model: 'StorageObject',
 *   kind: 'org',
 *   rationale: 'An uploaded file belongs to the organisation it was uploaded in.',
 * };
 * ```
 */
export interface ModelOwnershipDef<TModel extends string = string> {
  /** The Prisma model name, PascalCase. One entry per model. */
  readonly model: TModel;
  /** See {@link OwnershipKind}. */
  readonly kind: OwnershipKind;
  /**
   * The Prisma field holding the organisation id. Defaults to `'orgId'`; only
   * meaningful for `org` and `org-optional`.
   */
  readonly orgField?: string;
  /**
   * For a `user` or `system` model that nevertheless carries an `org_id` column
   * (an identity table: a membership, an invite, an org-bound credential): the
   * Prisma field holding it. The column is a REFERENCE, not an isolation key:
   * no row-level security, read across organisations at login and guarded by
   * service code. Declaring it keeps the coverage tripwire's rule ("no table
   * has `org_id` unless its model says why") honest.
   */
  readonly orgReference?: string;
  /** One sentence: why this kind. Rendered in docs and shown when a tripwire fails. */
  readonly rationale: string;
}

function validate(def: ModelOwnershipDef): void {
  if (!['org', 'org-optional', 'user', 'system'].includes(def.kind)) {
    throw new Error(`kind must be 'org', 'org-optional', 'user' or 'system', not ${JSON.stringify(def.kind)}`);
  }
  if (def.orgField !== undefined) {
    if (def.kind !== 'org' && def.kind !== 'org-optional') {
      throw new Error(`orgField is only for 'org' and 'org-optional' models, not '${def.kind}'`);
    }
    if (def.orgField.trim() === '') throw new Error('orgField must not be empty');
  }
  if (def.orgReference !== undefined) {
    if (def.kind !== 'user' && def.kind !== 'system') {
      throw new Error(`orgReference is only for 'user' and 'system' models, not '${def.kind}'`);
    }
    if (def.orgReference.trim() === '') throw new Error('orgReference must not be empty');
  }
  if (typeof def.rationale !== 'string' || def.rationale.trim() === '') {
    throw new Error('rationale is required');
  }
}

/**
 * The static registry of model ownership kinds, keyed by model name. One per
 * process: the app fills it from a manifest imported before bootstrap and
 * `RegistryFreezeService` freezes it with every other `defineRegistry` registry.
 *
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerModelOwnership(PLATFORM_MODEL_OWNERSHIP);
 * registerModelOwnership(APP_MODEL_OWNERSHIP);
 *
 * modelOwnershipRegistry.get('StorageObject')?.kind; // 'org'
 * ```
 */
export const modelOwnershipRegistry = defineRegistry<ModelOwnershipDef>({
  name: 'model-ownership',
  idOf: (def) => def.model,
  idPattern: /^[A-Z][A-Za-z0-9_]*$/,
  validate,
});

/**
 * Registers a batch of ownership definitions, all or nothing.
 *
 * @param defs - the definitions; an app may type them with its own model names.
 * @throws RegistryError `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @stability experimental
 * @example
 * ```ts
 * registerModelOwnership([{ model: 'Workout', kind: 'org', rationale: 'A workout belongs to its organisation.' }]);
 * ```
 */
export function registerModelOwnership<TModel extends string>(defs: readonly ModelOwnershipDef<TModel>[]): void {
  modelOwnershipRegistry.registerAll(defs);
}

/**
 * The models of a kind, in registration order.
 *
 * @param kind - the ownership kind.
 * @stability experimental
 * @example
 * ```ts
 * modelsOfKind('org').map((def) => def.model); // ['StorageObject', 'StorageObjectChunk', 'AiRun', 'AiUsageEvent']
 * ```
 */
export function modelsOfKind(kind: OwnershipKind): ModelOwnershipDef[] {
  return modelOwnershipRegistry.list().filter((def) => def.kind === kind);
}

/**
 * The field holding a model's organisation id, whether it isolates (`org`,
 * `org-optional`) or only references (`orgReference` on a `user` or `system`
 * model), or `undefined` for a model that has none.
 *
 * @param model - the Prisma model name.
 * @stability experimental
 * @example
 * ```ts
 * orgColumnOf('Membership'); // 'orgId' when registered with orgReference: 'orgId'
 * ```
 */
export function orgColumnOf(model: string): string | undefined {
  const def = modelOwnershipRegistry.get(model);
  if (def === undefined) return undefined;
  if (def.kind === 'org' || def.kind === 'org-optional') return def.orgField ?? 'orgId';
  return def.orgReference;
}

/**
 * The field holding an ISOLATING organisation id: `org` and `org-optional`
 * models only. `undefined` for a model that has none (`user`, `system`,
 * unregistered), including the identity tables that merely reference an
 * organisation.
 *
 * @param model - the Prisma model name.
 * @stability experimental
 * @example
 * ```ts
 * orgFieldOf('StorageObject'); // 'orgId'
 * ```
 */
export function orgFieldOf(model: string): string | undefined {
  const def = modelOwnershipRegistry.get(model);
  if (def === undefined || (def.kind !== 'org' && def.kind !== 'org-optional')) return undefined;
  return def.orgField ?? 'orgId';
}
