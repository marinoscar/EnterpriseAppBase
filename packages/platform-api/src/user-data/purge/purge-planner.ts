// =============================================================================
// The purge planner: delete order from the schema (issue #743, PP-9.1)
// =============================================================================
//
// EvoPath ordered its ~25 deletes by hand ("children before the parents they
// RESTRICT"). Here the order is DERIVED from the schema's relations:
//
//   - every relation between two models of the purge set, whose `onDelete` is
//     `Restrict`, `NoAction` or `Cascade`, puts the child (the model holding
//     the foreign key) BEFORE the parent. Restrict/NoAction because the parent
//     cannot go first; Cascade because a child deleted by the cascade would go
//     UNCOUNTED (EvoPath's activity entries before workouts). `SetNull` puts no
//     constraint: the parent may go first and the child is detached, or the
//     child goes in its own step;
//   - ties break by model name, so the plan is the same on every boot;
//   - a cycle throws at bootstrap, naming the models in it;
//   - a SELF relation that restricts (a revision chain) is unlinked first when
//     the column is nullable (EvoPath's `measurement.supersedesId`), and is a
//     plan error when it is required.
//
// WHY THE SCHEMA FILE AND NOT `Prisma.dmmf`: Prisma 7's generated client still
// exports `Prisma.dmmf.datamodel`, but its relation fields carry no
// `relationFromFields` and no `relationOnDelete`. The parsed schema
// (`readSchemaDatamodel` of `@marinoscar/platform-api/testing`, shipped in the
// api image) has both. The planner takes it as structural data, so a test
// passes a hand-written model list.
// =============================================================================

import { effectiveOnDelete, type DatamodelField, type DatamodelModel } from '../../testing/index';

/**
 * The structural shape of a parsed schema the planner reads: models with
 * their fields and `@relation(...)` arguments.
 *
 * @stability experimental
 */
export type PurgeDatamodel = readonly DatamodelModel[];

/**
 * One foreign key between two models.
 *
 * @stability experimental
 */
export interface PurgeRelation {
  /** The model holding the foreign key. */
  readonly child: string;
  /** The referenced model. */
  readonly parent: string;
  /** The relation field on the child. */
  readonly field: string;
  /** The scalar foreign key fields on the child. */
  readonly fields: readonly string[];
  /** The effective referential action (`Cascade`, `Restrict`, `NoAction`, `SetNull`, `SetDefault`). */
  readonly onDelete: string;
  /** Whether the relation field is optional. */
  readonly optional: boolean;
}

/**
 * Thrown when no delete order exists (a cycle, a required self-restrict).
 *
 * @stability experimental
 */
export class UserDataPlanError extends Error {
  constructor(
    message: string,
    /** The models involved. */
    readonly models: readonly string[],
  ) {
    super(message);
    this.name = 'UserDataPlanError';
  }
}

/**
 * Every relation of the schema with its foreign key side, in schema order.
 *
 * @param datamodel - the parsed schema.
 * @returns one entry per relation field that declares `fields: [...]`.
 *
 * @stability experimental
 */
export function relationsOf(datamodel: PurgeDatamodel): PurgeRelation[] {
  const names = new Set(datamodel.map((model) => model.name));
  const out: PurgeRelation[] = [];
  for (const model of datamodel) {
    for (const field of model.fields) {
      if (!field.relation || field.relation.fields.length === 0 || !names.has(field.type)) continue;
      out.push({
        child: model.name,
        parent: field.type,
        field: field.name,
        fields: field.relation.fields,
        onDelete: effectiveOnDelete(field as DatamodelField),
        optional: field.isOptional,
      });
    }
  }
  return out;
}

const ORDERING_ACTIONS = new Set(['Cascade', 'Restrict', 'NoAction']);
const BLOCKING_ACTIONS = new Set(['Restrict', 'NoAction']);

/**
 * The delete order of a set of models: children before parents along every
 * `Cascade`, `Restrict` or `NoAction` relation inside the set, ties by name.
 *
 * @param models - the models to delete (duplicates ignored).
 * @param datamodel - the parsed schema.
 * @returns the models, in delete order.
 * @throws UserDataPlanError on a cycle (the message names its models) or a
 *   model the schema does not have.
 *
 * @stability experimental
 * @example
 * ```ts
 * orderForDeletion(['Workout', 'WorkoutSet'], datamodel); // ['WorkoutSet', 'Workout']
 * ```
 */
export function orderForDeletion(models: readonly string[], datamodel: PurgeDatamodel): string[] {
  const set = new Set(models);
  const known = new Set(datamodel.map((model) => model.name));
  const missing = [...set].filter((name) => !known.has(name)).sort();
  if (missing.length > 0) {
    throw new UserDataPlanError(`the schema has no model ${missing.join(', ')}`, missing);
  }

  // pendingChildren[parent] = children in the set that must go first.
  const pendingChildren = new Map<string, Set<string>>([...set].map((name) => [name, new Set<string>()]));
  const parentsOf = new Map<string, Set<string>>([...set].map((name) => [name, new Set<string>()]));
  for (const relation of relationsOf(datamodel)) {
    if (relation.child === relation.parent) continue;
    if (!set.has(relation.child) || !set.has(relation.parent)) continue;
    if (!ORDERING_ACTIONS.has(relation.onDelete)) continue;
    pendingChildren.get(relation.parent)!.add(relation.child);
    parentsOf.get(relation.child)!.add(relation.parent);
  }

  const order: string[] = [];
  const ready = [...set].filter((name) => pendingChildren.get(name)!.size === 0).sort();
  while (ready.length > 0) {
    const next = ready.shift()!;
    order.push(next);
    for (const parent of [...parentsOf.get(next)!].sort()) {
      const children = pendingChildren.get(parent)!;
      children.delete(next);
      if (children.size === 0) {
        ready.push(parent);
        ready.sort();
      }
    }
  }

  if (order.length !== set.size) {
    const stuck = [...set].filter((name) => !order.includes(name)).sort();
    throw new UserDataPlanError(
      `the delete order has a cycle among ${stuck.join(', ')}: break it with a SetNull relation, or delete one of them in a custom step`,
      stuck,
    );
  }
  return order;
}

/**
 * The nullable self-relation foreign keys of a model that block its own
 * deletion (`Restrict`/`NoAction`): set to `null` before the rows go.
 *
 * @param model - the model.
 * @param datamodel - the parsed schema.
 * @returns the scalar fields to null.
 * @throws UserDataPlanError for a REQUIRED self-restrict, which no delete order satisfies.
 *
 * @stability experimental
 */
export function selfUnlinkFields(model: string, datamodel: PurgeDatamodel): string[] {
  const out: string[] = [];
  for (const relation of relationsOf(datamodel)) {
    if (relation.child !== model || relation.parent !== model || !BLOCKING_ACTIONS.has(relation.onDelete)) continue;
    if (!relation.optional) {
      throw new UserDataPlanError(`${model}.${relation.field} is a required self-relation with onDelete ${relation.onDelete}`, [model]);
    }
    out.push(...relation.fields);
  }
  return out;
}

/**
 * The list back-relation fields of a model (other rows that reference it),
 * for `keepWhenReferenced`: a row is deleted only when every one is empty.
 *
 * @param model - the model.
 * @param datamodel - the parsed schema.
 * @returns the relation field names on `model`.
 *
 * @stability experimental
 */
export function backRelationFields(model: string, datamodel: PurgeDatamodel): string[] {
  const def = datamodel.find((entry) => entry.name === model);
  const names = new Set(datamodel.map((entry) => entry.name));
  if (!def) return [];
  return def.fields
    .filter((field) => field.isList && names.has(field.type) && (!field.relation || field.relation.fields.length === 0))
    .map((field) => field.name);
}

/**
 * Whether a model has a scalar field of this name.
 *
 * @param model - the model.
 * @param field - the field.
 * @param datamodel - the parsed schema.
 *
 * @stability experimental
 */
export function hasField(model: string, field: string, datamodel: PurgeDatamodel): boolean {
  return datamodel.find((entry) => entry.name === model)?.fields.some((entry) => entry.name === field) ?? false;
}

/**
 * The Prisma client delegate name of a model (`AiRun` → `aiRun`).
 *
 * @param model - the model name.
 * @stability experimental
 */
export function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}
