// =============================================================================
// The `user-data` conformance suite (issue #743, PP-9.1)
// =============================================================================
//
// Replaces EvoPath's admission that "no test discovers a new model, so the
// decision is manual". Against the app's own registries and schema:
//
//   decisions  every model the user-owned registry gives an owner column has
//              an explicit decision: kept (with a reason) or deleted in a
//              REGISTERED category, which `everything` therefore reaches;
//   hints      every hint names a model of the schema, a registered category,
//              and columns the model has; every scope names registered
//              categories and resolves to at least one;
//   plan       the delete order exists (no cycle, no required self-restrict).
//
// The web counterpart (Danger Zone groups last) is
// `dangerZoneLastViolations` of `@marinoscar/platform-web/user-data/headless`.
// =============================================================================

import { userOwnedModelRegistry } from '../../core/index';
import { conformanceSuites } from '../../testing/index';
import type { ConformanceCase, ConformanceFinding, ConformanceReport, ConformanceSuite } from '../../testing/index';
import type { PurgeDatamodel } from '../purge/purge-planner';
import { planUserPurge } from '../purge/user-purge';
import { categoriesOfScope, resolvedUserDataScopes, userDataCategoryRegistry, userDataModelRegistry } from '../user-data.registries';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The user-data slice's suite: its options, or `false` to opt out. Registered by importing `@marinoscar/platform-api/user-data/testing`. */
    userData?: UserDataConformanceOptions | false;
  }
}

/**
 * Options of the `user-data` suite.
 *
 * @stability experimental
 */
export interface UserDataConformanceOptions {
  /** The app's parsed schema (`readSchemaDatamodel`). */
  readonly datamodel: PurgeDatamodel;
}

const FILE_DECISIONS = 'user-data-decisions';
const FILE_HINTS = 'user-data-hints';
const FILE_PLAN = 'user-data-plan';

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

/**
 * The `user-data` conformance suite. Registered when
 * `@marinoscar/platform-api/user-data/testing` is imported.
 *
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * import '@marinoscar/platform-api/user-data/testing';
 * runPlatformConformance({ sourceRoots: [API_SOURCE_ROOT], suites: { userData: { datamodel } } });
 * ```
 */
export const userDataConformanceSuite: ConformanceSuite<UserDataConformanceOptions> = {
  id: 'user-data',
  title: 'the user-data slice decides every owner model',
  description:
    'Every model with an owner column is kept with a reason or deleted in a registered category the everything scope reaches, hints and scopes name what exists, and a delete order exists.',
  check(_context, options): ConformanceReport {
    const owned = userOwnedModelRegistry.list().filter((def) => def.ownerField !== undefined);
    return {
      scanned: { ownerModels: owned.length, hints: userDataModelRegistry.list().length, scopes: resolvedUserDataScopes().length },
      scannedFiles: { ownerModels: owned.map((def) => def.model) },
      findings: [...checkUserDataDecisions(), ...checkUserDataHints(options.datamodel), ...checkUserDataPlan(options.datamodel)],
    };
  },
  cases(): ConformanceCase[] {
    return [
      {
        name: 'decisions: every owner model is kept with a reason or deleted in a category "everything" reaches',
        run: (report, expect) => {
          expect(report.scanned.ownerModels).toBeGreaterThanOrEqual(1);
          expect(report.findings.filter((finding) => finding.file === FILE_DECISIONS)).toEqual([]);
        },
      },
      {
        name: 'hints: every hint and scope names a model, column and category that exist',
        run: (report, expect) => {
          expect(report.scanned.scopes).toBeGreaterThanOrEqual(2);
          expect(report.findings.filter((finding) => finding.file === FILE_HINTS)).toEqual([]);
        },
      },
      {
        name: 'plan: a delete order exists for the owner models (no cycle)',
        run: (report, expect) => {
          expect(report.findings.filter((finding) => finding.file === FILE_PLAN)).toEqual([]);
        },
      },
    ];
  },
};

if (!conformanceSuites.has(userDataConformanceSuite.id)) conformanceSuites.register(userDataConformanceSuite);
