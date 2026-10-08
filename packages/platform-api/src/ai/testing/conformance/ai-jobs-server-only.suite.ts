// =============================================================================
// Suite: AI job types are server-only, permanently (issues #435, #742)
// =============================================================================
//
// A user's or the deployment's provider key must never leave the server
// (CLAUDE.md MANDATORY queue rule 3, AI rule 3). For the AI platform that
// guarantee has a precise, structural form: every job type whose work would
// touch a provider key is registered with NEITHER `nodeResultSchema` nor
// `persistNodeResult`, the two members that, together, are the ONLY thing that
// makes a job type node-eligible (`jobs/job-handler.interface.ts`'s own
// header). A handler carrying exactly one of the two is still server-only, by
// the same derivation; there is no `nodeEligible` flag anywhere to disagree
// with the two members, so this is a fact about the registry, not about what
// any one handler file claims about itself.
//
// TYPES ARE DISCOVERED, NEVER HAND-LISTED: `JobHandlerRegistry.types()`,
// filtered to the `ai.` prefix. A fourth `ai.*` handler added later is covered
// with no edit, and `JobHandlerRegistry.serverOnlyTypes()`, read here and never
// recomputed, is the same derivation every other consumer (the `system` worker
// mode, the node claim endpoint) relies on.
//
// Moved from the reference app's `apps/api/test/ai/ai-jobs-server-only.spec.ts`
// with the same four cases; the app now supplies how it boots (the fixture).
// =============================================================================

import { JobHandlerRegistry } from '../../../jobs/index';
import type { ConformanceAppSuite } from '../../../testing/index';
import type { AiConformanceFixture } from './ai-conformance-fixture';

/**
 * How an app configures the `ai-jobs-server-only` suite.
 *
 * @example
 * ```ts
 * runPlatformConformance({
 *   sourceRoots: [API_SOURCE_ROOT],
 *   suites: { aiJobsServerOnly: { fixture: aiConformanceFixture } },
 * });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface AiJobsServerOnlyOptions {
  /** How the app boots; see {@link AiConformanceFixture}. */
  fixture: AiConformanceFixture;
  /** Vacuity guard: at least this many `ai.*` job types must be found (default 3, the platform's own). */
  minAiJobTypes?: number;
}

/**
 * The slice of a job handler registry the suite reads.
 *
 * @stability experimental
 */
export interface JobRegistryView {
  /** Every registered job type. */
  types(): string[];
  /** The handler of a type, when registered. */
  get(type: string): { nodeResultSchema?: unknown; persistNodeResult?: unknown } | undefined;
  /** The types the registry derives as server-only. */
  serverOnlyTypes(): string[];
}

/**
 * The `ai.*` job types that carry `nodeResultSchema` or `persistNodeResult`,
 * as one message per offender. Pure, so the rule is tested against a broken
 * registry as well as the real one.
 *
 * @param registry - the handler registry, or a view of it.
 * @returns the offenders; empty when every `ai.*` type is server-only.
 *
 * @stability experimental
 */
export function findNodeEligibleAiJobs(registry: JobRegistryView): string[] {
  const offenders: string[] = [];

  for (const type of registry.types().filter((candidate) => candidate.startsWith('ai.'))) {
    const handler = registry.get(type);

    if (!handler) {
      offenders.push(`${type}: registered in types() but get() returned nothing`);
      continue;
    }

    if (handler.nodeResultSchema !== undefined) {
      offenders.push(`${type}: carries nodeResultSchema — a user's/admin's provider key must never reach a node`);
    }

    if (handler.persistNodeResult !== undefined) {
      offenders.push(`${type}: carries persistNodeResult — a user's/admin's provider key must never reach a node`);
    }
  }

  return offenders;
}

/**
 * The `ai.*` job types the registry does NOT list as server-only.
 *
 * @param registry - the handler registry, or a view of it.
 * @returns the missing types; empty when the derivation covers them all.
 *
 * @stability experimental
 */
export function findAiJobsMissingFromServerOnly(registry: JobRegistryView): string[] {
  const serverOnly = new Set(registry.serverOnlyTypes());

  return registry.types().filter((type) => type.startsWith('ai.') && !serverOnly.has(type));
}

/** Registers the suite's `describe` tree on the runner's globals. */
function register(options: AiJobsServerOnlyOptions): void {
  describe('AI job types are server-only, permanently (#435)', () => {
    let context: Awaited<ReturnType<AiConformanceFixture['createContext']>>;
    let registry: JobHandlerRegistry;
    let aiTypes: string[];

    beforeAll(async () => {
      context = await options.fixture.createContext();
      registry = context.app.get(JobHandlerRegistry);
      aiTypes = registry.types().filter((type) => type.startsWith('ai.'));
    }, 60_000);

    afterAll(async () => {
      await options.fixture.closeContext(context);
    });

    it('finds the ai.* job types at all, so a broken discovery cannot pass vacuously', () => {
      // The platform registers more than three today; this is a floor, not a
      // pin, so one added later does not need this number bumped.
      expect(aiTypes.length).toBeGreaterThanOrEqual(options.minAiJobTypes ?? 3);
    });

    describe('every discovered ai.* type', () => {
      it('carries neither nodeResultSchema nor persistNodeResult, and is server-only', () => {
        expect(findNodeEligibleAiJobs(registry)).toEqual([]);
      });

      it('is included in JobHandlerRegistry.serverOnlyTypes() — the same derivation the node claim endpoint reads', () => {
        expect(findAiJobsMissingFromServerOnly(registry)).toEqual([]);
      });
    });

    it('a handler carrying exactly one of the two members would still be caught (derivation, not a flag)', () => {
      // A structural proof that the check has the same "both or neither" shape
      // `JobHandlerRegistry.serverOnlyTypes()` does: a future ai.* handler that
      // accidentally implements only one of the pair is reported as an
      // offender, not silently treated as node-eligible.
      const half: JobRegistryView = {
        types: () => ['ai.half.done'],
        get: () => ({ nodeResultSchema: {} }),
        serverOnlyTypes: () => ['ai.half.done'],
      };
      const nodeEligible = (handler: { nodeResultSchema?: unknown; persistNodeResult?: unknown }): boolean =>
        handler.nodeResultSchema !== undefined && typeof handler.persistNodeResult === 'function';

      expect(nodeEligible(half.get('ai.half.done')!)).toBe(false);
      expect(findNodeEligibleAiJobs(half)).toEqual([
        "ai.half.done: carries nodeResultSchema — a user's/admin's provider key must never reach a node",
      ]);
    });
  });
}

/**
 * The suite behind `runPlatformConformance({ suites: { aiJobsServerOnly } })`.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const aiJobsServerOnlySuite: ConformanceAppSuite<AiJobsServerOnlyOptions> = {
  id: 'ai-jobs-server-only',
  title: 'AI job types are server-only, permanently (#435)',
  description:
    'Every ai.* job type has neither nodeResultSchema nor persistNodeResult and is in the registry’s server-only derivation (AI rule 3).',
  register(_api, _context, options) {
    register(options);
  },
};
