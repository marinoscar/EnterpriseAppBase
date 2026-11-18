// =============================================================================
// The registry checks of the user-data slice (issues #743, #880)
// =============================================================================
//
// Three pure checks over the app's own registries and schema. They run in two
// places: the `user-data` conformance suite (`./testing/conformance.ts`, in the
// app's CI) and the `user-data.registries` Doctor check (a running deployment).
// Kept here, free of the test harness, so production code can use them without
// registering the conformance suite as an import side effect.
// =============================================================================

import { userOwnedModelRegistry } from '../core/index';
import type { ConformanceFinding } from '../testing/index';
import type { PurgeDatamodel } from './purge/purge-planner';
import { planUserPurge } from './purge/user-purge';
import { categoriesOfScope, resolvedUserDataScopes, userDataCategoryRegistry, userDataModelRegistry } from './user-data.registries';

/** The `file` of the decisions findings.
 *
 * @stability experimental
 */
export const FILE_DECISIONS = 'user-data-decisions';
/** The `file` of the hints findings.
 *
 * @stability experimental
 */
export const FILE_HINTS = 'user-data-hints';
/** The `file` of the plan findings.
 *
 * @stability experimental
 */
export const FILE_PLAN = 'user-data-plan';

/**
 * Check 1: every owner model has an explicit keep-or-delete decision.
 *
 * @returns one finding per undecided model.
 *
 * @stability experimental
 */
export function checkUserDataDecisions(): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const categories = new Set(userDataCategoryRegistry.ids());
  for (const def of userOwnedModelRegistry.list()) {
    if (def.ownerField === undefined) continue;
    const hint = userDataModelRegistry.get(def.model);
    if (!hint) {
      findings.push({
        file: FILE_DECISIONS,
        message: `${def.model} (owner ${def.ownerField}) has no user-data decision: registerUserDataModels([{ model: '${def.model}', category: '...' }]) or { keep: '<why>' }`,
      });
    } else if (hint.keep === undefined && !categories.has(hint.category ?? 'other')) {
      findings.push({ file: FILE_DECISIONS, message: `${def.model} is deleted in category "${hint.category ?? 'other'}", which is not registered, so "everything" cannot reach it` });
    }
  }
  return findings;
}

/**
 * Check 2: hints and scopes name what exists.
 *
 * @param datamodel - the parsed schema.
 * @returns one finding per problem.
 *
 * @stability experimental
 */
export function checkUserDataHints(datamodel: PurgeDatamodel): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const categories = new Set(userDataCategoryRegistry.ids());
  for (const hint of userDataModelRegistry.list()) {
    const model = datamodel.find((entry) => entry.name === hint.model);
    if (!model) {
      findings.push({ file: FILE_HINTS, message: `hint for ${hint.model}: the schema has no such model` });
      continue;
    }
    if (hint.category !== undefined && !categories.has(hint.category)) {
      findings.push({ file: FILE_HINTS, message: `hint for ${hint.model}: category "${hint.category}" is not registered` });
    }
    for (const column of hint.storageObjectColumns ?? []) {
      if (!model.fields.some((field) => field.name === column)) {
        findings.push({ file: FILE_HINTS, message: `hint for ${hint.model}: storageObjectColumns names "${column}", which the model lacks` });
      }
    }
  }
  for (const scope of resolvedUserDataScopes()) {
    if (Array.isArray(scope.categories)) {
      for (const id of scope.categories) {
        if (!categories.has(id)) findings.push({ file: FILE_HINTS, message: `scope "${scope.id}" names category "${id}", which is not registered` });
      }
    }
    if (categoriesOfScope(scope).length === 0) findings.push({ file: FILE_HINTS, message: `scope "${scope.id}" resolves to no category` });
  }
  return findings;
}

/**
 * Check 3: the delete order exists.
 *
 * @param datamodel - the parsed schema.
 * @returns a finding when planning throws.
 *
 * @stability experimental
 */
export function checkUserDataPlan(datamodel: PurgeDatamodel): ConformanceFinding[] {
  try {
    planUserPurge({
      datamodel,
      owned: userOwnedModelRegistry.list(),
      hint: (model) => userDataModelRegistry.get(model),
      categories: userDataCategoryRegistry.list(),
    });
    return [];
  } catch (error) {
    return [{ file: FILE_PLAN, message: error instanceof Error ? error.message : String(error) }];
  }
}
