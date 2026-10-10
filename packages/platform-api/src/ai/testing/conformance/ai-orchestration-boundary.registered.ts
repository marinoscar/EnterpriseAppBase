// The orchestration boundary (CLAUDE.md AI rule 6) as a registered suite
// (issue #742). The scan itself is `orchestration-boundary.suite.ts` (#739);
// this only gives it a suite id so an app runs it through
// `runPlatformConformance()` like the rest.

import type { ConformanceAppSuite } from '../../../testing/index';
import { runOrchestrationBoundarySuite, type OrchestrationBoundaryOptions } from './orchestration-boundary.suite';

/**
 * The suite behind `runPlatformConformance({ suites: { aiOrchestrationBoundary } })`;
 * its options are those of {@link runOrchestrationBoundarySuite}.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const aiOrchestrationBoundarySuite: ConformanceAppSuite<OrchestrationBoundaryOptions> = {
  id: 'ai-orchestration-boundary',
  title: 'the AI orchestration boundary (CLAUDE.md AI rule 6)',
  description:
    'An orchestration library is imported only under the roots an app allows, never from a web source, and never declared by a banned manifest (AI rule 6).',
  register(_api, _context, options) {
    runOrchestrationBoundarySuite(options);
  },
};
