// =============================================================================
// The onboarding registries (issue #745, PP-9.3): steps, facts, orderings and
// activation milestones
// =============================================================================
//
// Rung 2: static registries (`defineRegistry`) filled at import time by the
// app's manifest (`apps/api/src/onboarding/onboarding.manifest.ts`) and frozen
// once the application has bootstrapped. Cross-registry rules (a step naming a
// fact nobody registered) are checked by `assertOnboardingRegistries`, which
// the service runs at bootstrap: registration order between the two
// registries does not matter, but a dangling id fails the boot.
// =============================================================================

import {
  ONBOARDING_AUDIENCES,
  ONBOARDING_METRICS_DAYS_MAX,
  ONBOARDING_STEP_ID_MAX,
  ONBOARDING_STEP_ID_PATTERN,
  ONBOARDING_TIERS,
} from '@marinoscar/platform-contract/onboarding';

import { defineRegistry } from '../core/index';
import type {
  ActivationMilestoneDef,
  OnboardingFactDef,
  OnboardingOrderingDef,
  OnboardingStepDef,
} from './onboarding.types';

/** The fact the `doctorChecks` sugar adds. */
export const DOCTOR_FACT_ID = 'doctor';

function nonEmpty(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required`);
}

function validateStep(step: OnboardingStepDef): void {
  if (step.id.length > ONBOARDING_STEP_ID_MAX) throw new Error(`id is longer than ${ONBOARDING_STEP_ID_MAX} characters`);
  if (!(ONBOARDING_AUDIENCES as readonly string[]).includes(step.audience)) {
    throw new Error(`audience must be one of ${ONBOARDING_AUDIENCES.join(', ')}`);
  }
  if (!(ONBOARDING_TIERS as readonly string[]).includes(step.tier)) {
    throw new Error(`tier must be one of ${ONBOARDING_TIERS.join(', ')}`);
  }
  if (typeof step.order !== 'number' || !Number.isFinite(step.order)) throw new Error('order must be a finite number');
  for (const field of ['title', 'description', 'actionLabel', 'href'] as const) nonEmpty(step[field], field);
  if (!step.href.startsWith('/')) throw new Error('href must be an app route starting with "/"');
  if (step.permission !== undefined) nonEmpty(step.permission, 'permission (when set)');
  if (step.feature !== undefined) nonEmpty(step.feature, 'feature (when set)');
  if (typeof step.skippable !== 'boolean') throw new Error('skippable must be a boolean');
  if (step.tier === 'required' && step.skippable) {
    throw new Error('a required step cannot be skippable: other people cannot succeed without it');
  }
  if (!Array.isArray(step.facts) || step.facts.some((id) => typeof id !== 'string' || id === '')) {
    throw new Error('facts must be an array of fact ids');
  }
  if (step.doctorChecks !== undefined) {
    if (!Array.isArray(step.doctorChecks) || step.doctorChecks.length === 0 || step.doctorChecks.some((id) => typeof id !== 'string' || id === '')) {
      throw new Error('doctorChecks must be a non-empty array of Doctor check ids when set');
    }
  }
  if (step.evaluate === undefined && step.doctorChecks === undefined) {
    throw new Error('evaluate is required unless doctorChecks is set');
  }
  if (step.evaluate !== undefined && typeof step.evaluate !== 'function') throw new Error('evaluate must be a function');
  if (step.applies !== undefined && typeof step.applies !== 'function') throw new Error('applies must be a function');
  if (step.funnelSql !== undefined) {
    nonEmpty(step.funnelSql, 'funnelSql (when set)');
    if (step.audience !== 'user') throw new Error('funnelSql is for user steps only (the funnel is over new users)');
    if (step.funnelSql.includes(';')) throw new Error('funnelSql must be one expression, without ";"');
  }
}

/**
 * Every onboarding step, in registration order (the response sorts by
 * `order`, then id).
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const onboardingStepRegistry = defineRegistry<OnboardingStepDef>({
  name: 'onboarding-steps',
  idOf: (step) => step.id,
  idPattern: ONBOARDING_STEP_ID_PATTERN,
  validate: (step) => validateStep(step),
  describeDuplicate: (_existing, incoming) =>
    `Onboarding step "${incoming.id}" is already registered. A step id is permanent (it is stored in users' skipped lists); pick another id.`,
});

/**
 * Registers onboarding steps, all or nothing.
 *
 * @param steps - the steps.
 * @throws RegistryError naming the step when one is invalid: a duplicate or
 *   malformed id, a `required` step marked `skippable`, no `evaluate` and no
 *   `doctorChecks`, a `funnelSql` on an admin step.
 *
 * @example
 * ```ts
 * registerOnboardingStep({
 *   id: 'app.first-project', audience: 'user', tier: 'recommended', order: 30,
 *   title: 'Create your first project', description: 'Projects hold your work.',
 *   actionLabel: 'New project', href: '/projects/new', permission: 'projects:write',
 *   skippable: true, facts: ['app.projectCount'],
 *   evaluate: (facts) => ({ status: (facts['app.projectCount'] as number) > 0 ? 'done' : 'todo' }),
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerOnboardingStep(...steps: OnboardingStepDef[]): void {
  onboardingStepRegistry.registerAll(steps);
}

/**
 * Every onboarding fact.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const onboardingFactRegistry = defineRegistry<OnboardingFactDef>({
  name: 'onboarding-facts',
  idOf: (fact) => fact.id,
  validate: (fact) => {
    if (typeof fact.resolve !== 'function') throw new Error('resolve must be a function');
  },
  describeDuplicate: (_existing, incoming) => `Onboarding fact "${incoming.id}" is already registered.`,
});

/**
 * Registers onboarding facts, all or nothing.
 *
 * @param facts - the facts.
 * @throws RegistryError on a duplicate id or a missing `resolve`.
 *
 * @example
 * ```ts
 * registerOnboardingFact({
 *   id: 'app.projectCount',
 *   resolve: (ctx) => ctx.get(ProjectsService).countFor(ctx.caller.id),
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerOnboardingFact(...facts: OnboardingFactDef[]): void {
  onboardingFactRegistry.registerAll(facts);
}

/**
 * The ordering hooks, at most one per audience.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const onboardingOrderingRegistry = defineRegistry<OnboardingOrderingDef>({
  name: 'onboarding-orderings',
  idOf: (ordering) => ordering.audience,
  validate: (ordering) => {
    if (!(ONBOARDING_AUDIENCES as readonly string[]).includes(ordering.audience)) {
      throw new Error(`audience must be one of ${ONBOARDING_AUDIENCES.join(', ')}`);
    }
    if (typeof ordering.order !== 'function') throw new Error('order must be a function');
    if (!Array.isArray(ordering.facts)) throw new Error('facts must be an array of fact ids');
  },
  describeDuplicate: (_existing, incoming) =>
    `An onboarding ordering for the "${incoming.audience}" audience is already registered; there is at most one per audience.`,
});

/**
 * Registers an audience's ordering hook (one per audience).
 *
 * @param ordering - the hook.
 * @throws RegistryError when the audience already has one.
 *
 * @example
 * ```ts
 * registerOnboardingOrdering({
 *   audience: 'user',
 *   facts: ['userSettings'],
 *   order: (steps) => [...steps].sort((a, b) => Number(a.evaluation.status === 'done') - Number(b.evaluation.status === 'done')),
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerOnboardingOrdering(ordering: OnboardingOrderingDef): void {
  onboardingOrderingRegistry.register(ordering);
}

/**
 * The activation milestones the metrics aggregate.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const activationMilestoneRegistry = defineRegistry<ActivationMilestoneDef>({
  name: 'onboarding-activation-milestones',
  idOf: (milestone) => milestone.id,
  idPattern: /^[a-z][a-z0-9_]*$/,
  validate: (milestone) => {
    nonEmpty(milestone.label, 'label');
    nonEmpty(milestone.firstReachedAtSql, 'firstReachedAtSql');
    if (milestone.firstReachedAtSql.includes(';')) throw new Error('firstReachedAtSql must be one expression, without ";"');
    if (!Number.isInteger(milestone.windowDays) || milestone.windowDays < 1 || milestone.windowDays > ONBOARDING_METRICS_DAYS_MAX) {
      throw new Error(`windowDays must be an integer from 1 to ${ONBOARDING_METRICS_DAYS_MAX}`);
    }
  },
  describeDuplicate: (_existing, incoming) => `Activation milestone "${incoming.id}" is already registered.`,
});

/**
 * Registers an activation milestone.
 *
 * @param milestone - the milestone.
 * @throws RegistryError on a duplicate or malformed id, a `windowDays` out of
 *   range, or an SQL expression containing `;`.
 *
 * @example
 * ```ts
 * registerActivationMilestone({
 *   id: 'first_project', label: 'First project created', windowDays: 7,
 *   firstReachedAtSql: '(SELECT MIN(p.created_at) FROM projects p WHERE p.owner_id = c.id)',
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerActivationMilestone(milestone: ActivationMilestoneDef): void {
  activationMilestoneRegistry.register(milestone);
}

/**
 * The fact ids a step reads: its own, plus `doctor` when it declares
 * `doctorChecks`.
 *
 * @param step - the step.
 * @returns the ids, without duplicates.
 *
 * @stability experimental
 */
export function factIdsOf(step: OnboardingStepDef): string[] {
  const ids = new Set(step.facts);
  if (step.doctorChecks !== undefined) ids.add(DOCTOR_FACT_ID);
  return [...ids];
}

/**
 * Fails when a step or an ordering names a fact no one registered. The
 * service runs it at bootstrap.
 *
 * @throws Error listing every dangling fact id with the step that names it.
 *
 * @stability experimental
 */
export function assertOnboardingRegistries(): void {
  const problems: string[] = [];
  for (const step of onboardingStepRegistry.list()) {
    for (const id of factIdsOf(step)) {
      if (!onboardingFactRegistry.has(id)) problems.push(`step "${step.id}" reads unknown fact "${id}"`);
    }
  }
  for (const ordering of onboardingOrderingRegistry.list()) {
    for (const id of ordering.facts) {
      if (!onboardingFactRegistry.has(id)) problems.push(`the ${ordering.audience} ordering reads unknown fact "${id}"`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Onboarding registries are inconsistent: ${problems.join('; ')}. Register the facts (registerOnboardingFact) before the app boots.`);
  }
}
