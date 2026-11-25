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
import {
  FILE_DECISIONS,
  FILE_HINTS,
  FILE_PLAN,
  checkUserDataDecisions,
  checkUserDataHints,
  checkUserDataPlan,
} from '../registry-checks';
import { resolvedUserDataScopes, userDataModelRegistry } from '../user-data.registries';

export { checkUserDataDecisions, checkUserDataHints, checkUserDataPlan };

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
