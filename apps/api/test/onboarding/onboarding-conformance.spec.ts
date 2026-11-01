import { runPlatformConformance } from '@marinoscar/platform-api/testing';
// Importing the testing entry REGISTERS the `onboarding` suite with the harness.
import '@marinoscar/platform-api/onboarding/testing';

// The app's steps and facts: the manifest fills the registries the suite reads.
import '../../src/onboarding/onboarding.manifest';
import { permissionRegistry } from '../../src/common/permissions';
import { API_SOURCE_ROOT } from '../jobs/cron-source-roots';

// =============================================================================
// The onboarding slice's conformance suite, run in the reference app (#745)
// =============================================================================
//
// The invariants of `@marinoscar/platform-api/onboarding` (its README,
// "Conformance suite"), checked against THIS application's registered steps:
// every fact registered, no required step skippable, every step permission
// exactly a registered permission, each fact resolved at most once per
// request and no data-port call while steps evaluate.
// =============================================================================

runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: {
    onboarding: {
      permissions: permissionRegistry.list(),
      minSteps: 9,
    },
  },
});
