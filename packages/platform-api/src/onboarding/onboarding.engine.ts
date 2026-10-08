// =============================================================================
// The onboarding engine (issue #745, PP-9.3): registry in, derived blocks out
// =============================================================================
//
// Framework-free so the conformance suite can drive it with a spied data port.
// Three phases, in this order, and the order is the cost bound:
//
//   1. CANDIDATES (no I/O but the feature gate): drop every step the caller
//      cannot act on: wrong audience, missing permission, feature off, a
//      Doctor check that is not registered. Omitted, never shown blocked.
//   2. FACTS: the union of the candidates' (and the orderings') facts, each
//      resolved ONCE, in parallel. A fact that rejects omits the steps that
//      need it (logged); it never fails the response.
//   3. EVALUATION, synchronous: `applies`, then `evaluate` (or the Doctor
//      mapping), then the ordering hook. Nothing here can await a query.
// =============================================================================

import type { DoctorCheckReport } from '@marinoscar/platform-contract/doctor';
import type { OnboardingAudience, OnboardingBlock, OnboardingStep } from '@marinoscar/platform-contract/onboarding';
import { ONBOARDING_STATUSES } from '@marinoscar/platform-contract/onboarding';

import { DOCTOR_FACT_ID, factIdsOf } from './onboarding.registries';
import type {
  OnboardingEvaluation,
  OnboardingFactDef,
  OnboardingFacts,
  OnboardingOrderableStep,
  OnboardingOrderingDef,
  OnboardingRequestContext,
  OnboardingStepDef,
} from './onboarding.types';

/**
 * What {@link evaluateOnboarding} takes.
 *
 * @stability experimental
 */
export interface OnboardingEngineInput {
  /** Every registered step. */
  steps: readonly OnboardingStepDef[];
  /** Every registered fact. */
  facts: readonly OnboardingFactDef[];
  /** The registered orderings. */
  orderings: readonly OnboardingOrderingDef[];
  /** Whether the caller gets the admin block. */
  includeAdmin: boolean;
  /** The step ids the user skipped (already reduced to skippable ones). */
  skipped: readonly string[];
  /** Builds the request context once the Doctor check union is known. */
  context(doctorCheckIds: readonly string[], fact: (id: string) => Promise<unknown>): OnboardingRequestContext;
  /** A warning (a fact rejected, an evaluate threw). */
  warn?(message: string): void;
  /** Facts already read by the caller (the service's one `userSettings` read): never resolved again. */
  seed?: ReadonlyMap<string, unknown>;
  /** Called between the fact phase and the evaluation phase (conformance spies). */
  onEvaluationPhase?(phase: 'start' | 'end'): void;
}

/**
 * What {@link evaluateOnboarding} returns.
 *
 * @stability experimental
 */
export interface OnboardingEngineResult {
  /** The user block. */
  user: OnboardingBlock;
  /** The admin block, or `null` when not included. */
  admin: OnboardingBlock | null;
}

/**
 * The Doctor mapping: `done` only when every mapped check is `pass` (a `skip`
 * is not a pass); otherwise `todo` with the first non-passing check's remedy,
 * falling back to its detail.
 *
 * @param checkIds - the step's check ids.
 * @param reports - the Doctor reports by id.
 * @returns the evaluation.
 *
 * @stability experimental
 */
export function evaluateDoctorChecks(
  checkIds: readonly string[],
  reports: ReadonlyMap<string, DoctorCheckReport> | undefined,
): OnboardingEvaluation {
  const found = checkIds.map((id) => reports?.get(id));
  if (found.every((report) => report?.status === 'pass')) return { status: 'done', detail: null };
  const blocking = found.find((report) => report !== undefined && report.status !== 'pass');
  return { status: 'todo', detail: blocking?.remedy ?? blocking?.detail ?? null };
}

/**
 * Sorts by `order`, then id.
 *
 * @param a - one step.
 * @param b - the other.
 * @returns the comparison.
 *
 * @stability experimental
 */
export function compareSteps(a: OnboardingStepDef, b: OnboardingStepDef): number {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function summarize(steps: OnboardingStep[]): OnboardingBlock {
  return {
    steps,
    completed: steps.filter((step) => step.status === 'done').length,
    total: steps.length,
    requiredDone: steps.filter((step) => step.tier === 'required').every((step) => step.status === 'done'),
    allResolved: steps.every((step) => step.status === 'done' || step.skipped),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Derives the caller's checklists from the registries. Never writes; resolves
 * each needed fact at most once; omits what the caller cannot act on.
 *
 * @param input - the registries, the caller's context and the stored skips.
 * @returns the user block and, when included, the admin block.
 *
 * @stability experimental
 */
export async function evaluateOnboarding(input: OnboardingEngineInput): Promise<OnboardingEngineResult> {
  const warn = input.warn ?? (() => undefined);
  const factDefs = new Map(input.facts.map((fact) => [fact.id, fact]));
  const memo = new Map<string, Promise<unknown>>();
  let ctx: OnboardingRequestContext | null = null;
  for (const [id, value] of input.seed ?? []) memo.set(id, Promise.resolve(value));

  const fact = (id: string): Promise<unknown> => {
    let pending = memo.get(id);
    if (!pending) {
      const def = factDefs.get(id);
      pending = def
        ? Promise.resolve().then(() => def.resolve(ctx!))
        : Promise.reject(new Error(`unknown onboarding fact "${id}"`));
      // A rejection is observed by whoever awaits it; never unhandled.
      pending.catch(() => undefined);
      memo.set(id, pending);
    }
    return pending;
  };

  // Phase 1: candidates. The feature gate is the only read, and it is memoised.
  // The context is built with an empty check union first, for the gate only.
  const audiences: OnboardingAudience[] = input.includeAdmin ? ['user', 'admin'] : ['user'];
  const gateCtx = input.context([], fact);
  const byAudience = input.steps.filter((step) => audiences.includes(step.audience));
  const permitted = byAudience.filter(
    (step) => step.permission === undefined || gateCtx.caller.permissions.includes(step.permission),
  );
  const featureOn = await Promise.all(
    permitted.map((step) => (step.feature === undefined ? Promise.resolve(true) : gateCtx.isFeatureEnabled(step.feature).catch(() => false))),
  );
  const candidates = permitted.filter((step, index) => {
    if (!featureOn[index]) return false;
    if (step.doctorChecks !== undefined) {
      if (!gateCtx.doctor) return false;
      return step.doctorChecks.every((id) => gateCtx.doctor!.has(id));
    }
    return true;
  });

  const doctorCheckIds = [...new Set(candidates.flatMap((step) => step.doctorChecks ?? []))];
  ctx = input.context(doctorCheckIds, fact);

  // Phase 2: facts, each once.
  const orderings = input.orderings.filter((ordering) => audiences.includes(ordering.audience));
  const needed = new Set<string>([
    ...candidates.flatMap((step) => factIdsOf(step)),
    ...orderings.flatMap((ordering) => ordering.facts),
  ]);
  const settled = new Map<string, { ok: true; value: unknown } | { ok: false; error: unknown }>();
  await Promise.all(
    [...needed].map(async (id) => {
      try {
        settled.set(id, { ok: true, value: await fact(id) });
      } catch (error) {
        settled.set(id, { ok: false, error });
        warn(`Onboarding fact "${id}" failed; the steps that need it are omitted: ${messageOf(error)}`);
      }
    }),
  );

  const factsFor = (ids: readonly string[]): OnboardingFacts | null => {
    const out: Record<string, unknown> = {};
    for (const id of ids) {
      const result = settled.get(id);
      if (!result || !result.ok) return null;
      out[id] = result.value;
    }
    return Object.freeze(out);
  };

  // Phase 3: evaluation, synchronous.
  input.onEvaluationPhase?.('start');
  const skipped = new Set(input.skipped);
  const blocks: Record<OnboardingAudience, OnboardingOrderableStep[]> = { user: [], admin: [] };

  for (const def of [...candidates].sort(compareSteps)) {
    const facts = factsFor(factIdsOf(def));
    if (facts === null) continue;
    try {
      if (def.applies !== undefined && !def.applies(facts)) continue;
      const evaluation = def.evaluate
        ? def.evaluate(facts)
        : evaluateDoctorChecks(def.doctorChecks ?? [], facts[DOCTOR_FACT_ID] as ReadonlyMap<string, DoctorCheckReport>);
      if (!evaluation || !(ONBOARDING_STATUSES as readonly string[]).includes(evaluation.status)) {
        warn(`Onboarding step "${def.id}" returned an invalid status; it is omitted`);
        continue;
      }
      if (evaluation.status === 'blocked' && !(typeof evaluation.blockedReason === 'string' && evaluation.blockedReason.trim() !== '')) {
        warn(`Onboarding step "${def.id}" is blocked without a blockedReason; it is omitted`);
        continue;
      }
      blocks[def.audience].push({ def, evaluation });
    } catch (error) {
      warn(`Onboarding step "${def.id}" threw while evaluating; it is omitted: ${messageOf(error)}`);
    }
  }

  for (const ordering of orderings) {
    const facts = factsFor(ordering.facts);
    if (facts === null) continue;
    try {
      const members = new Set(blocks[ordering.audience]);
      blocks[ordering.audience] = [...ordering.order(blocks[ordering.audience], facts)].filter((step) => members.has(step));
    } catch (error) {
      warn(`The ${ordering.audience} onboarding ordering threw; the default order applies: ${messageOf(error)}`);
    }
  }
  input.onEvaluationPhase?.('end');

  const toStep = ({ def, evaluation }: OnboardingOrderableStep): OnboardingStep => ({
    id: def.id,
    audience: def.audience,
    tier: def.tier,
    status: evaluation.status,
    title: def.title,
    description: def.description,
    actionLabel: def.actionLabel,
    href: def.href,
    detail: evaluation.status === 'done' ? null : (evaluation.detail ?? null),
    blockedReason: evaluation.status === 'blocked' ? (evaluation.blockedReason ?? null) : null,
    skippable: def.skippable,
    skipped: def.skippable && skipped.has(def.id),
  });

  return {
    user: summarize(blocks.user.map(toStep)),
    admin: input.includeAdmin ? summarize(blocks.admin.map(toStep)) : null,
  };
}
