// =============================================================================
// The onboarding slice's conformance suite (issue #745, PP-9.3)
// =============================================================================
//
// Importing `@marinoscar/platform-api/onboarding/testing` registers the
// `onboarding` suite with `runPlatformConformance()`. Checked against what the
// APP registered:
//
//   1. registry: every fact a step or ordering names is registered, and no
//      `required` step is skippable.
//   2. permissions: every step's `permission` is in the app's permission
//      registry, exactly.
//   3. facts-once: one derivation, for a caller holding every permission,
//      resolves each fact at most once.
//   4. no-io-in-evaluate: the evaluation phase makes no data-port call (the
//      cost of the endpoint is the facts', never a per-step query).
// =============================================================================

import { conformanceSuites } from '../../testing/index';
import type { ConformanceCase, ConformanceFinding, ConformanceReport, ConformanceSuite } from '../../testing/index';
import { evaluateOnboarding } from '../onboarding.engine';
import {
  factIdsOf,
  onboardingFactRegistry,
  onboardingOrderingRegistry,
  onboardingStepRegistry,
} from '../onboarding.registries';
import type { OnboardingFactDef, OnboardingRequestContext } from '../onboarding.types';
import type { OnboardingDataPort } from '../ports';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The onboarding slice's suite: its options, or `false` to opt out. Registered by importing `@marinoscar/platform-api/onboarding/testing`. */
    onboarding?: OnboardingConformanceOptions | false;
  }
}

/**
 * What the `onboarding` suite takes: the app's data, never its code.
 *
 * @stability experimental
 */
export interface OnboardingConformanceOptions {
  /** The app's permission registry (`id` of every permission). */
  readonly permissions: ReadonlyArray<{
    /** The permission id. */
    readonly id: string;
  }>;
  /** Values to use for facts instead of resolving them (an app fact that needs a provider). */
  readonly factSamples?: Readonly<Record<string, unknown>>;
  /** The fewest steps the app must have registered (a wiring check). Default 1. */
  readonly minSteps?: number;
}

/**
 * The registry and permission checks.
 *
 * @param options - the suite's options.
 * @returns one finding per problem.
 *
 * @stability experimental
 */
export function checkOnboardingRegistries(options: OnboardingConformanceOptions): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const permissions = new Set(options.permissions.map((p) => p.id));
  for (const step of onboardingStepRegistry.list()) {
    for (const id of factIdsOf(step)) {
      if (!onboardingFactRegistry.has(id)) findings.push({ file: `step:${step.id}`, message: `reads unknown fact "${id}"` });
    }
    if (step.tier === 'required' && step.skippable) findings.push({ file: `step:${step.id}`, message: 'is required and skippable' });
    if (step.permission !== undefined && !permissions.has(step.permission)) {
      findings.push({ file: `step:${step.id}`, message: `permission ${step.permission} is not a registered permission` });
    }
  }
  for (const ordering of onboardingOrderingRegistry.list()) {
    for (const id of ordering.facts) {
      if (!onboardingFactRegistry.has(id)) findings.push({ file: `ordering:${ordering.audience}`, message: `reads unknown fact "${id}"` });
    }
  }
  const minimum = options.minSteps ?? 1;
  if (onboardingStepRegistry.size < minimum) {
    findings.push({ file: 'registry', message: `${onboardingStepRegistry.size} step(s) registered, fewer than ${minimum}: did the app import its manifest?` });
  }
  return findings;
}

/**
 * What one spied derivation observed.
 *
 * @stability experimental
 */
export interface OnboardingDerivationProbe {
  /** How many times each fact was resolved. */
  resolutions: Record<string, number>;
  /** Data-port calls made during the evaluation phase. */
  evaluationCalls: string[];
  /** Every data-port call. */
  calls: string[];
}

/**
 * Derives the checklists once for a caller holding every permission, every
 * feature on, against a spied data port that answers "nothing yet".
 *
 * @param options - the suite's options.
 * @returns what the derivation did.
 *
 * @stability experimental
 */
export async function probeOnboardingDerivation(options: OnboardingConformanceOptions): Promise<OnboardingDerivationProbe> {
  const calls: string[] = [];
  const evaluationCalls: string[] = [];
  let evaluating = false;
  const record = (name: string): void => {
    calls.push(name);
    if (evaluating) evaluationCalls.push(name);
  };
  const data: OnboardingDataPort = {
    readUserSettingsValue: async () => (record('readUserSettingsValue'), null),
    countAllowlistEntriesExcept: async () => (record('countAllowlistEntriesExcept'), 0),
    hasPushSubscription: async () => (record('hasPushSubscription'), false),
    orgInviteProgress: async () => (record('orgInviteProgress'), { otherMembers: 0, pendingInvites: 0 }),
    queryAggregate: async () => (record('queryAggregate'), []),
  };
  const resolutions: Record<string, number> = {};
  const samples = options.factSamples ?? {};
  const facts: OnboardingFactDef[] = onboardingFactRegistry.list().map((fact) => ({
    id: fact.id,
    resolve: (ctx: OnboardingRequestContext) => {
      resolutions[fact.id] = (resolutions[fact.id] ?? 0) + 1;
      return Object.prototype.hasOwnProperty.call(samples, fact.id) ? Promise.resolve(samples[fact.id]) : fact.resolve(ctx);
    },
  }));

  await evaluateOnboarding({
    steps: onboardingStepRegistry.list(),
    facts,
    orderings: onboardingOrderingRegistry.list(),
    includeAdmin: true,
    skipped: [],
    onEvaluationPhase: (phase) => {
      evaluating = phase === 'start';
    },
    context: (doctorCheckIds, fact) => ({
      caller: {
        id: '00000000-0000-4000-8000-000000000000',
        permissions: options.permissions.map((p) => p.id),
        roles: [],
        activeOrgId: '00000000-0000-4000-8000-000000000001',
      },
      refresh: false,
      data,
      doctor: { has: () => true, reports: async () => (record('doctor.reports'), new Map()) },
      doctorCheckIds,
      initialAdminEmail: null,
      isFeatureEnabled: async () => true,
      fact: <T>(id: string) => fact(id) as Promise<T>,
      get: () => {
        throw new Error('no app providers in the conformance probe; pass factSamples for this fact');
      },
    }),
  });

  return { resolutions, evaluationCalls, calls };
}

/**
 * The `onboarding` conformance suite. Registered when
 * `@marinoscar/platform-api/onboarding/testing` is imported.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const onboardingConformanceSuite: ConformanceSuite<OnboardingConformanceOptions> = {
  id: 'onboarding',
  title: 'the onboarding slice keeps its invariants',
  description:
    'Every step reads registered facts and names a registered permission, required steps are never skippable, facts resolve at most once per request and step evaluation does no I/O.',
  check(_context, options): ConformanceReport {
    const steps = onboardingStepRegistry.list();
    return {
      scanned: { steps: steps.length, facts: onboardingFactRegistry.size, orderings: onboardingOrderingRegistry.size },
      scannedFiles: { steps: steps.map((step) => step.id) },
      findings: checkOnboardingRegistries(options),
    };
  },
  cases(options): ConformanceCase[] {
    return [
      {
        name: 'registry: every fact a step names is registered, no required step is skippable, and the app registered its steps',
        run: (report, expect) => {
          expect(report.findings.filter((f) => /unknown fact|required and skippable|fewer than/.test(f.message))).toEqual([]);
        },
      },
      {
        name: 'permissions: every step permission is exactly a registered permission',
        run: (report, expect) => {
          expect(report.findings.filter((f) => /not a registered permission/.test(f.message))).toEqual([]);
        },
      },
      {
        name: 'facts-once: one derivation resolves each fact at most once',
        run: async (_report, expect) => {
          const probe = await probeOnboardingDerivation(options);
          expect(Object.entries(probe.resolutions).filter(([, count]) => count > 1)).toEqual([]);
        },
      },
      {
        name: 'no-io-in-evaluate: step evaluation makes no data-port call',
        run: async (_report, expect) => {
          const probe = await probeOnboardingDerivation(options);
          expect(probe.evaluationCalls).toEqual([]);
        },
      },
    ];
  },
};

if (!conformanceSuites.has(onboardingConformanceSuite.id)) conformanceSuites.register(onboardingConformanceSuite);
