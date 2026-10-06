// =============================================================================
// The ownership tripwire's checker (#688): registry vs schema
// =============================================================================
//
// Pure: given a datamodel (schema-datamodel.ts) and the registered
// definitions, returns one message per problem. user-owned-models.spec.ts
// runs it against the real schema and against synthetic datamodels, so each
// rule is proven to fire.
//
// NOT A `*.spec.ts` FILE, so Jest never runs it as a suite.
// =============================================================================

import type { UserOwnedModelDef } from '../../src/prisma/ownership';
import { ownerRelationOf } from '../../src/prisma/ownership';
import { effectiveOnDelete, type DatamodelField, type DatamodelModel } from './schema-datamodel';

export const PLATFORM_FILE = 'apps/api/src/prisma/ownership/platform-user-owned-models.ts';
export const APP_FILE = 'apps/api/src/app-registrations/user-owned-models.ts';

/** The `onDelete` values each purge policy accepts. */
export const PURGE_ON_DELETE: Readonly<Record<UserOwnedModelDef['purge'], readonly string[]>> = {
  delete: ['Cascade'],
  detach: ['SetNull'],
  retain: ['Restrict', 'NoAction'],
};

const registerHint = (model: string, field: string) =>
  `Register ${model}.${field} in ${PLATFORM_FILE} (platform) or ${APP_FILE} (app), with a purge and export policy.`;

/** Every `User` relation that holds the foreign key on this side, keyed by FK field name. */
function userForeignKeys(model: DatamodelModel, userModel: string): Map<string, DatamodelField> {
  const keys = new Map<string, DatamodelField>();
  for (const field of model.fields) {
    if (field.type !== userModel || !field.relation) continue;
    for (const fk of field.relation.fields) keys.set(fk, field);
  }
  return keys;
}

/**
 * Every disagreement between the registered definitions and the datamodel.
 * An empty array means the registry is complete and consistent.
 *
 * @param userModel - the model whose foreign keys are tracked (`'User'`).
 */
export function checkUserOwnedModels(
  datamodel: readonly DatamodelModel[],
  defs: readonly UserOwnedModelDef[],
  userModel = 'User',
): string[] {
  const problems: string[] = [];
  const models = new Map(datamodel.map((model) => [model.name, model]));
  const registered = new Map<string, UserOwnedModelDef>(defs.map((def) => [def.model, def]));

  // 1. Every User foreign key is registered.
  for (const model of datamodel) {
    for (const fk of userForeignKeys(model, userModel).keys()) {
      const def = registered.get(model.name);
      const fields = def ? [def.ownerField, ...(def.actorFields ?? [])] : [];
      if (!fields.includes(fk)) {
        problems.push(`${model.name}.${fk} is a foreign key to ${userModel} with no registry entry. ${registerHint(model.name, fk)}`);
      }
    }
  }

  // 2. Every registered model and field exists, and its policy matches onDelete.
  for (const def of defs) {
    const model = models.get(def.model);
    if (!model) {
      problems.push(`${def.model} is registered but schema.prisma has no such model. Remove or rename the entry.`);
      continue;
    }

    const scalars = new Set(model.fields.filter((field) => !field.relation).map((field) => field.name));
    const foreignKeys = userForeignKeys(model, userModel);

    const checkField = (field: string, role: 'owner' | 'actor'): DatamodelField | undefined => {
      if (!scalars.has(field)) {
        problems.push(`${def.model}.${field} is registered as the ${role} field but schema.prisma has no such column.`);
        return undefined;
      }
      const relation = foreignKeys.get(field);
      if (!relation) {
        problems.push(`${def.model}.${field} is registered as the ${role} field but is not a foreign key to ${userModel}.`);
      }
      return relation;
    };

    const checkPurge = (field: string, relation: DatamodelField) => {
      const onDelete = effectiveOnDelete(relation);
      const accepted = PURGE_ON_DELETE[def.purge];
      if (!accepted.includes(onDelete)) {
        problems.push(
          `${def.model}.${field}: purge '${def.purge}' requires onDelete ${accepted.join(' or ')}, but schema.prisma has ${onDelete} (relation ${relation.name}).`,
        );
      }
    };

    if (def.ownerField !== undefined) {
      const relation = checkField(def.ownerField, 'owner');
      if (relation) {
        checkPurge(def.ownerField, relation);
        const expected = ownerRelationOf(def);
        if (relation.name !== expected) {
          problems.push(
            `${def.model}.${def.ownerField}: the owner relation field is "${relation.name}", not "${expected}". Set ownerRelation: '${relation.name}'.`,
          );
        }
      }
    }

    for (const field of def.actorFields ?? []) {
      const relation = checkField(field, 'actor');
      if (!relation) continue;
      if (def.ownerField === undefined) {
        checkPurge(field, relation);
      } else if (effectiveOnDelete(relation) === 'Cascade') {
        problems.push(
          `${def.model}.${field}: an actor field on an owned model cannot be onDelete Cascade: deleting the actor would delete a row another user owns.`,
        );
      }
    }

    for (const column of def.exportOmit ?? []) {
      if (!scalars.has(column)) {
        problems.push(`${def.model}.exportOmit names "${column}", which schema.prisma does not have.`);
      }
    }
  }

  return problems;
}
