// =============================================================================
// The AI orchestration boundary, in the reference app (issue #739)
// =============================================================================
//
// CLAUDE.md AI rule 6, run through the packaged, parameterised suite of
// `@marinoscar/platform-api/ai/testing`. The base allows NO orchestration
// library anywhere (`allowedRoots: {}`); an app that adopts one (EvoPath:
// LangGraph under `training-agents/`) passes its allowed roots. Moving this
// into `runPlatformConformance()` is #742.
// =============================================================================

import { join } from 'node:path';

import { runOrchestrationBoundarySuite } from '@marinoscar/platform-api/ai/testing';

const REPO = join(__dirname, '..', '..', '..', '..');

runOrchestrationBoundarySuite({
  apiSourceRoots: [join(REPO, 'apps', 'api', 'src'), join(REPO, 'packages', 'platform-api', 'src')],
  webSourceRoots: [join(REPO, 'apps', 'web', 'src'), join(REPO, 'packages', 'platform-web', 'src')],
  packageJsonPaths: [
    join(REPO, 'package.json'),
    join(REPO, 'apps', 'api', 'package.json'),
    join(REPO, 'apps', 'web', 'package.json'),
    join(REPO, 'packages', 'platform-api', 'package.json'),
    join(REPO, 'packages', 'platform-web', 'package.json'),
    join(REPO, 'packages', 'platform-contract', 'package.json'),
  ],
  allowedRoots: {},
  minApiFiles: 200,
});
