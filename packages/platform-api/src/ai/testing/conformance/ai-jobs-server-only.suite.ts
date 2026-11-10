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
//
// #1083 AMENDMENT (opt-in provider-credential delivery, gated pending the rule
// amendment proposed in `docs/specs/worker-nodes.md`): an `ai.*` type MAY carry
// the two node members only when it declares `nodeCredentialPurposes` (each an
// `ai:<provider>` purpose) AND names the AI features it serves (`aiFeatures`),
// every one registered with `nodeCredentialDelivery: true`. Anything else that
// is node-eligible still fails. And whatever a type declares, with the
// deployment's defaults (delivery OFF) every `ai.*` type must be in
// `NodeOffloadService.serverOnlyRightNow()` — the claim-time answer — so no
// key can reach a node unless an administrator enabled delivery.
// =============================================================================

import { JobHandlerRegistry, NodeOffloadService } from '../../../jobs/index';
import { getAiFeature } from '../../features/ai-feature.registry';
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
 * The two members of a job handler that make it node-eligible.
 *
 * @stability experimental
 */
export interface JobHandlerView {
  /** Schema of the result a node returns; with `persistNodeResult`, makes the type node-eligible. */
  nodeResultSchema?: unknown;
  /** Persists a node's result; with `nodeResultSchema`, makes the type node-eligible. */
  persistNodeResult?: unknown;
  /** The provider-credential purposes the type declares (#1083). */
  nodeCredentialPurposes?: readonly string[];
  /** The AI feature ids the type serves (#1083); each must set `nodeCredentialDelivery: true` for a node-eligible type. */
  aiFeatures?: readonly string[];
}

/**
 * Whether a node-eligible `ai.*` handler satisfies the #1083 amendment: it
 * declares at least one `ai:` purpose, names at least one feature, and every
 * named feature is registered with `nodeCredentialDelivery: true`.
 *
 * @param handler - the handler, or a view of it.
 * @param isDeliveryFeature - whether a feature id opted in (default: the AI feature registry).
 * @returns why it does not comply, or `null` when it does.
 *
 * @stability experimental
 */
export function nodeDeliveryNonCompliance(
  handler: JobHandlerView,
  isDeliveryFeature: (id: string) => boolean = (id) => getAiFeature(id)?.nodeCredentialDelivery === true,
): string | null {
  const purposes = handler.nodeCredentialPurposes ?? [];
  if (purposes.length === 0) return 'declares no nodeCredentialPurposes';
  const notAi = purposes.filter((purpose) => !purpose.startsWith('ai:'));
  if (notAi.length > 0 && notAi.length === purposes.length) return 'declares no ai:<provider> purpose';
  const features = handler.aiFeatures ?? [];
  if (features.length === 0) return 'names no aiFeatures';
  const missing = features.filter((id) => !isDeliveryFeature(id));
  if (missing.length > 0) return `serves feature(s) without nodeCredentialDelivery: true (${missing.join(', ')})`;
  return null;
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
  get(type: string): JobHandlerView | undefined;
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

    if (handler.nodeResultSchema === undefined && handler.persistNodeResult === undefined) continue;

    // #1083: a type opted into node credential delivery is allowed the members.
    const nonCompliance = nodeDeliveryNonCompliance(handler);
    if (nonCompliance === null) continue;

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

  // A compliant node-delivery type (#1083) is structurally node-eligible; the
  // runtime check (`serverOnlyRightNow`) is what keeps it on the server while
  // delivery is off.
  return registry
    .types()
    .filter((type) => type.startsWith('ai.') && !serverOnly.has(type))
    .filter((type) => {
      const handler = registry.get(type);
      return handler === undefined || nodeDeliveryNonCompliance(handler) !== null;
    });
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

    it('with the deployment defaults (credential delivery OFF), every ai.* type is server-only at claim time (#1083)', async () => {
      const offload = context.app.get(NodeOffloadService) as NodeOffloadService;
      const serverNow = new Set(await offload.serverOnlyRightNow());
      expect(aiTypes.filter((type) => !serverNow.has(type))).toEqual([]);
    });

    it('a node-eligible ai.* type is accepted only with ai: purposes and every feature opted in (#1083)', () => {
      const members = { nodeResultSchema: {}, persistNodeResult: () => undefined };
      const optedIn = (id: string) => id === 'opted_in';
      expect(nodeDeliveryNonCompliance({ ...members }, optedIn)).toBe('declares no nodeCredentialPurposes');
      expect(nodeDeliveryNonCompliance({ ...members, nodeCredentialPurposes: ['geo:google'] }, optedIn)).toBe('declares no ai:<provider> purpose');
      expect(nodeDeliveryNonCompliance({ ...members, nodeCredentialPurposes: ['ai:openai'] }, optedIn)).toBe('names no aiFeatures');
      expect(nodeDeliveryNonCompliance({ ...members, nodeCredentialPurposes: ['ai:openai'], aiFeatures: ['opted_in', 'other'] }, optedIn)).toMatch(/other/);
      expect(nodeDeliveryNonCompliance({ ...members, nodeCredentialPurposes: ['ai:openai'], aiFeatures: ['opted_in'] }, optedIn)).toBeNull();
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
      const nodeEligible = (handler: JobHandlerView): boolean =>
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
    'Every ai.* job type has neither nodeResultSchema nor persistNodeResult and is in the registry’s server-only derivation (AI rule 3), unless it opted into node credential delivery (#1083: ai: purposes declared, every feature nodeCredentialDelivery); with the defaults every ai.* type is server-only at claim time.',
  register(_api, _context, options) {
    register(options);
  },
};
