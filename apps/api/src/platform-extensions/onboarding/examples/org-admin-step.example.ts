// =============================================================================
// Reference example: a step for the organization's administrator (PP-14.20)
// =============================================================================
//
// The Setup guide (`audience: 'admin'`) is for the holder of the admin
// permission (`system_settings:read`), a SYSTEM administrator. In a multi-
// organization deployment the person who runs an organization is its
// `org_admin` member, who holds no system permission and so never saw a
// setup step. The built-in `org_admin` audience closes that: it matches a
// caller who holds the `org_admin` role of their active organization, and its
// steps come back under `audiences.org_admin` of `GET /api/onboarding`
// (`OnboardingChecklist` draws a block like any other).
//
// This step reuses the platform's `orgInvites` fact (the members and pending
// invitations of the caller's organization), so it costs no new read. The
// step's own `permission` still applies: an `org_admin` whose role was
// narrowed below `org_invites:write` does not see it.
//
// An app registers its own audiences (`registerOnboardingAudience`, BEFORE the
// steps that name them) for any other group; see `docs/EXTENDING.md`.
//
// Registered by a fork in `app-registrations/onboarding.ts`
// (`APP_ONBOARDING_STEPS`); the reference app's test registers it temporarily
// (`test/onboarding/onboarding-examples.spec.ts`).
// =============================================================================

import { ONBOARDING_FACTS, type OnboardingPrincipalFact, type OnboardingStepDef } from '@marinoscar/platform-api/onboarding';

/** The step: invite the first teammate. Recommended, skippable, multi-organization deployments only. */
export const ORG_INVITE_TEAM_STEP: OnboardingStepDef = {
  id: 'reference.org-invite-team',
  audience: 'org_admin',
  tier: 'recommended',
  order: 10,
  title: 'Invite your team',
  description: 'An organization becomes useful once someone else is in it.',
  actionLabel: 'Invite a member',
  href: '/admin/settings/organization',
  permission: 'org_invites:write',
  skippable: true,
  facts: [ONBOARDING_FACTS.PRINCIPAL, ONBOARDING_FACTS.ORG_INVITES],
  applies: (facts) => (facts[ONBOARDING_FACTS.PRINCIPAL] as OnboardingPrincipalFact).tenancyMode === 'multi',
  evaluate: (facts) => {
    const progress = facts[ONBOARDING_FACTS.ORG_INVITES] as { otherMembers: number; pendingInvites: number };
    if (progress.otherMembers > 0) return { status: 'done' };
    return progress.pendingInvites > 0
      ? { status: 'todo', detail: 'An invitation is pending; it completes when it is accepted.' }
      : { status: 'todo' };
  },
};
