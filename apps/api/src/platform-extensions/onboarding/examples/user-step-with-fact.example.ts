// =============================================================================
// Reference example: an app user step backed by an app fact (#745)
// =============================================================================
//
// A step never queries: it names the facts it reads, and the slice resolves
// each fact ONCE per request (and only when a step that applies needs it). The
// fact reaches the app's own services through `ctx.get(token)`. Here: "Create
// a personal access token", done once the caller holds an unrevoked one.
//
// Registered by a fork in `app-registrations/onboarding.ts`
// (`APP_ONBOARDING_FACTS`, `APP_ONBOARDING_STEPS`); the reference app's test
// registers it temporarily (`test/onboarding/onboarding-examples.spec.ts`).
// =============================================================================

import type { OnboardingFactDef, OnboardingStepDef } from '@marinoscar/platform-api/onboarding';

import { PrismaService } from '../../../prisma/prisma.service';

/** The fact: how many unrevoked personal access tokens the caller holds. */
export const PERSONAL_TOKEN_COUNT_FACT: OnboardingFactDef<number> = {
  id: 'reference.personalTokenCount',
  resolve: (ctx) =>
    ctx.get(PrismaService).personalAccessToken.count({ where: { userId: ctx.caller.id, revokedAt: null } }),
};

/** The step: a recommended, skippable user step over that fact, counted in the funnel. */
export const FIRST_TOKEN_STEP: OnboardingStepDef = {
  id: 'reference.first-token',
  audience: 'user',
  tier: 'recommended',
  order: 30,
  title: 'Create a personal access token',
  description: 'Scripts and the command line sign in with a token instead of your browser session.',
  actionLabel: 'Create a token',
  href: '/settings/tokens',
  skippable: true,
  facts: [PERSONAL_TOKEN_COUNT_FACT.id],
  funnelSql: 'EXISTS (SELECT 1 FROM personal_access_tokens t WHERE t.user_id = c.id)',
  evaluate: (facts) => ({ status: (facts[PERSONAL_TOKEN_COUNT_FACT.id] as number) > 0 ? 'done' : 'todo' }),
};
