// =============================================================================
// The onboarding audience registry (PP-14.20)
// =============================================================================
//
// An AUDIENCE is a named group of steps and the rule that decides who sees
// them. The platform registers three: `user` (Get started, everyone),
// `admin` (the Setup guide, the holder of the admin permission) and
// `org_admin` (the holder of the `org_admin` role of their active
// organization). An app adds its own (`coaches`, `reviewers`) with
// `registerOnboardingAudience`, BEFORE the steps that name it.
//
// The built-ins are registered here, at import, through the same function an
// app uses (no private fast path), so a step can name `org_admin` however the
// app orders its manifest. They are the only entries the registry starts with.
//
// A rule decides WHICH BLOCK a step lands in, never whether a step's own
// `permission` or `feature` gate applies: those still run for every audience,
// and `user` and `admin` keep exactly the rules they always had.
// =============================================================================

import {
  BUILTIN_ONBOARDING_AUDIENCES,
  ONBOARDING_AUDIENCE_ID_PATTERN,
  ONBOARDING_ORG_ADMIN_ROLE,
} from '@marinoscar/platform-contract/onboarding';

import { defineRegistry } from '../core/index';
import type { OnboardingAudienceDef } from './onboarding.types';

const platformAudiences: OnboardingAudienceDef[] = [
  {
    id: 'user',
    label: 'Get started',
    matches: () => true,
  },
  {
    id: 'admin',
    label: 'Setup guide',
    matches: (principal, ctx) => principal.permissions.includes(ctx.adminPermission),
  },
  {
    id: 'org_admin',
    label: 'Organization setup',
    matches: (principal) => principal.activeOrgId !== null && principal.roles.includes(ONBOARDING_ORG_ADMIN_ROLE),
  },
];

/**
 * The platform's audiences: `user`, `admin` and `org_admin`. Already
 * registered; exported for tests and for an app that wraps one.
 *
 * | Audience | Block of the response | Matches when |
 * |---|---|---|
 * | `user` | `user` | always |
 * | `admin` | `admin` | the caller holds the module's `adminPermission` |
 * | `org_admin` | `audiences.org_admin` | the caller holds the `org_admin` role of an active organization |
 *
 * @stability experimental
 */
export const PLATFORM_ONBOARDING_AUDIENCES: readonly OnboardingAudienceDef[] = Object.freeze(platformAudiences);

function validateAudience(audience: OnboardingAudienceDef): void {
  if (typeof audience.label !== 'string' || audience.label.trim() === '') throw new Error('label is required');
  if (typeof audience.matches !== 'function') throw new Error('matches must be a function');
}

/**
 * Every onboarding audience, in registration order (the platform's first).
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const onboardingAudienceRegistry = defineRegistry<OnboardingAudienceDef>({
  name: 'onboarding-audiences',
  idOf: (audience) => audience.id,
  idPattern: ONBOARDING_AUDIENCE_ID_PATTERN,
  validate: (audience) => validateAudience(audience),
  describeDuplicate: (_existing, incoming) =>
    `Onboarding audience "${incoming.id}" is already registered. An audience id is permanent (steps and stored responses name it); pick another id.`,
});

/**
 * Registers onboarding audiences, all or nothing. Register an audience before
 * the steps that name it. Re-registering the same object is a no-op.
 *
 * @param audiences - the audiences.
 * @throws RegistryError naming the audience when one is invalid or a different entry already uses its id.
 *
 * @example
 * ```ts
 * registerOnboardingAudience({
 *   id: 'coaches', label: 'Coach setup',
 *   matches: (principal) => principal.roles.includes('coach'),
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerOnboardingAudience(...audiences: OnboardingAudienceDef[]): void {
  const fresh = audiences.filter((audience) => onboardingAudienceRegistry.get(audience.id) !== audience);
  onboardingAudienceRegistry.registerAll(fresh);
}

// The built-ins register themselves through the public function.
registerOnboardingAudience(...PLATFORM_ONBOARDING_AUDIENCES);

/**
 * Whether `id` is one of the audiences the platform registers.
 *
 * @param id - the audience id.
 * @returns `true` for `admin`, `user` and `org_admin`.
 *
 * @stability experimental
 */
export function isBuiltinOnboardingAudience(id: string): boolean {
  return (BUILTIN_ONBOARDING_AUDIENCES as readonly string[]).includes(id);
}
