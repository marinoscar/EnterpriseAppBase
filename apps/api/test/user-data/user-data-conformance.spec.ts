import { readSchemaDatamodel, runPlatformConformance } from '@marinoscar/platform-api/testing';
// Importing the testing entry REGISTERS the `user-data` suite with the harness.
import '@marinoscar/platform-api/user-data/testing';

import { API_SOURCE_ROOT } from '../jobs/cron-source-roots';
// The app's registries, as the running app fills them.
import '../../src/prisma/ownership/user-owned-model.manifest';
import '../../src/platform/user-data/user-data.manifest';
import { appSchemaPath } from '../../src/platform/user-data/user-data.config';

// =============================================================================
// The user-data slice's conformance suite, run in the reference app (#743)
// =============================================================================
//
// Every model the user-owned registry gives an owner column has an explicit
// keep-or-delete decision that the `everything` scope reaches, every hint and
// scope names what exists, and a delete order exists for this schema. This is
// the test EvoPath's spec said did not exist ("no test discovers a new model").
// =============================================================================

runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: { userData: { datamodel: readSchemaDatamodel(appSchemaPath()) } },
});
