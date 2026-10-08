// =============================================================================
// The platform's onboarding facts and steps (issue #745, PP-9.3)
// =============================================================================
//
// Domain-free. The admin steps are EvoPath's Setup guide merged with kvox's
// tiers: storage, email and access are `required`; AI, Web Push and backups
// `recommended`; the org invite exists only in multi-org mode. The user
// steps are the two every app has (a profile, notification preferences); an
// app adds its activation steps.
//
// The app registers these in its manifest, before its own:
//
//   registerOnboardingFact(...PLATFORM_ONBOARDING_FACTS);
//   registerOnboardingStep(...PLATFORM_ONBOARDING_STEPS);
// =============================================================================

import type { DoctorCheckReport } from '@marinoscar/platform-contract/doctor';

import { currentTenancyMode } from '../identity/index';
import type { OnboardingFactDef, OnboardingStepDef } from './onboarding.types';

/**
 * The built-in fact ids.
 *
 * @stability experimental
 */
export const ONBOARDING_FACTS = {
  /** `ReadonlyMap<checkId, DoctorCheckReport>` for every check the applicable steps reference. */
  DOCTOR: 'doctor',
  /** `boolean`: the `ai` feature is on. */
  AI_ENABLED: 'aiEnabled',
  /** `number`: allowlist entries other than `INITIAL_ADMIN_EMAIL`. */
  ALLOWLIST_NON_BOOTSTRAP_COUNT: 'allowlistNonBootstrapCount',
  /** {@link OnboardingPrincipalFact}: the caller's permissions, roles, active org and tenancy mode. */
  PRINCIPAL: 'principal',
  /** `Record<string, unknown> | null`: the caller's raw `user_settings.value` (read once; shared with the stored state). */
  USER_SETTINGS: 'userSettings',
  /** `boolean`: the caller has an active Web Push subscription. */
  PUSH_SUBSCRIBED: 'pushSubscribed',
  /** `{ otherMembers, pendingInvites }` in the caller's active organization. */
  ORG_INVITES: 'orgInvites',
} as const;

/**
 * The value of the `principal` fact.
 *
 * @stability experimental
 */
export interface OnboardingPrincipalFact {
  /** Effective permissions. */
  permissions: readonly string[];
  /** System roles plus the active org role. */
  roles: readonly string[];
  /** The active organization, or `null`. */
  activeOrgId: string | null;
  /** `single` or `multi`. */
  tenancyMode: 'single' | 'multi';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The platform's facts. Register them before any step that reads them.
 *
 * @stability experimental
 */
export const PLATFORM_ONBOARDING_FACTS: readonly OnboardingFactDef[] = [
  {
    id: ONBOARDING_FACTS.DOCTOR,
    resolve: async (ctx): Promise<ReadonlyMap<string, DoctorCheckReport>> =>
      ctx.doctor ? ctx.doctor.reports(ctx.doctorCheckIds, ctx.refresh) : new Map(),
  },
  {
    id: ONBOARDING_FACTS.AI_ENABLED,
    resolve: (ctx) => ctx.isFeatureEnabled('ai'),
  },
  {
    id: ONBOARDING_FACTS.ALLOWLIST_NON_BOOTSTRAP_COUNT,
    resolve: (ctx) => ctx.data.countAllowlistEntriesExcept(ctx.initialAdminEmail),
  },
  {
    id: ONBOARDING_FACTS.PRINCIPAL,
    resolve: async (ctx): Promise<OnboardingPrincipalFact> => ({
      permissions: ctx.caller.permissions,
      roles: ctx.caller.roles,
      activeOrgId: ctx.caller.activeOrgId,
      tenancyMode: currentTenancyMode(),
    }),
  },
  {
    id: ONBOARDING_FACTS.USER_SETTINGS,
    resolve: async (ctx) => asRecord(await ctx.data.readUserSettingsValue(ctx.caller.id)),
  },
  {
    id: ONBOARDING_FACTS.PUSH_SUBSCRIBED,
    resolve: async (ctx) => (ctx.data.hasPushSubscription ? ctx.data.hasPushSubscription(ctx.caller.id) : false),
  },
  {
    id: ONBOARDING_FACTS.ORG_INVITES,
    resolve: async (ctx) => {
      if (!ctx.data.orgInviteProgress) throw new Error('the app binds no orgInviteProgress');
      if (!ctx.caller.activeOrgId) throw new Error('the credential carries no active organization');
      return ctx.data.orgInviteProgress(ctx.caller.activeOrgId, ctx.caller.id);
    },
  },
];

/**
 * The platform's step ids.
 *
 * @stability experimental
 */
export const ONBOARDING_STEP_IDS = {
  STORAGE: 'admin.storage',
  EMAIL: 'admin.email',
  ACCESS: 'admin.access',
  AI: 'admin.ai',
  PUSH: 'admin.push',
  BACKUP: 'admin.backup',
  ORG_INVITE: 'admin.org-invite',
  PROFILE: 'user.profile',
  NOTIFICATIONS: 'user.notifications',
} as const;

/** Whether a user's stored profile names them or carries an uploaded picture. */
function profileSet(settings: Record<string, unknown> | null): boolean {
  const profile = asRecord(settings?.['profile']);
  const name = profile?.['displayName'];
  const image = profile?.['imageObjectId'];
  return (typeof name === 'string' && name.trim() !== '') || (typeof image === 'string' && image !== '');
}

/**
 * The platform's steps: six Doctor-backed or counted admin steps, the
 * multi-org invite step and two user steps.
 *
 * | Step | Tier | Backed by |
 * |---|---|---|
 * | `admin.storage` | required | `storage.config`, `storage.bucket` |
 * | `admin.email` | required | `email.config` |
 * | `admin.access` | required | `allowlistNonBootstrapCount` |
 * | `admin.ai` | recommended | `ai.enabled`, `ai.providers` |
 * | `admin.push` | recommended | `push.vapid` |
 * | `admin.backup` | recommended | `backup.schedule` |
 * | `admin.org-invite` | recommended | `orgInvites` (multi-org only) |
 * | `user.profile` | optional | `userSettings` (`profile.displayName` or an uploaded picture) |
 * | `user.notifications` | optional | `userSettings` (`notifications` saved) or `pushSubscribed` |
 *
 * @stability experimental
 */
export const PLATFORM_ONBOARDING_STEPS: readonly OnboardingStepDef[] = [
  {
    id: ONBOARDING_STEP_IDS.STORAGE,
    audience: 'admin',
    tier: 'required',
    order: 10,
    title: 'Connect object storage',
    description: 'Uploads, profile pictures, job files and backups all need an object store.',
    actionLabel: 'Configure storage',
    href: '/admin/settings/storage',
    permission: 'storage_config:read',
    skippable: false,
    facts: [],
    doctorChecks: ['storage.config', 'storage.bucket'],
  },
  {
    id: ONBOARDING_STEP_IDS.EMAIL,
    audience: 'admin',
    tier: 'required',
    order: 20,
    title: 'Set up email delivery',
    description: 'Invitations and notifications are sent by email.',
    actionLabel: 'Configure email',
    href: '/admin/settings/email',
    permission: 'system_settings:read',
    skippable: false,
    facts: [],
    doctorChecks: ['email.config'],
  },
  {
    id: ONBOARDING_STEP_IDS.ACCESS,
    audience: 'admin',
    tier: 'required',
    order: 30,
    title: 'Invite your first users',
    description: 'Only addresses on the allowlist can sign in; add the people who should.',
    actionLabel: 'Open the allowlist',
    href: '/admin/settings/users',
    permission: 'allowlist:read',
    skippable: false,
    facts: [ONBOARDING_FACTS.ALLOWLIST_NON_BOOTSTRAP_COUNT],
    evaluate: (facts) =>
      (facts[ONBOARDING_FACTS.ALLOWLIST_NON_BOOTSTRAP_COUNT] as number) > 0
        ? { status: 'done' }
        : { status: 'todo', detail: 'Add at least one address other than the initial administrator to the allowlist.' },
  },
  {
    id: ONBOARDING_STEP_IDS.AI,
    audience: 'admin',
    tier: 'recommended',
    order: 40,
    title: 'Turn on AI',
    description: 'Enable a provider so AI features become available.',
    actionLabel: 'Configure AI',
    href: '/admin/settings/ai',
    permission: 'ai_config:read',
    skippable: true,
    facts: [],
    doctorChecks: ['ai.enabled', 'ai.providers'],
  },
  {
    id: ONBOARDING_STEP_IDS.PUSH,
    audience: 'admin',
    tier: 'recommended',
    order: 50,
    title: 'Enable Web Push',
    description: 'Generate the key pair browsers need to receive notifications.',
    actionLabel: 'Configure Web Push',
    href: '/admin/settings/push',
    permission: 'push:read',
    skippable: true,
    facts: [],
    doctorChecks: ['push.vapid'],
  },
  {
    id: ONBOARDING_STEP_IDS.BACKUP,
    audience: 'admin',
    tier: 'recommended',
    order: 60,
    title: 'Schedule database backups',
    description: 'A nightly backup is the difference between an incident and a loss.',
    actionLabel: 'Configure backups',
    href: '/admin/settings/db-backup',
    permission: 'db_backup:read',
    skippable: true,
    facts: [],
    doctorChecks: ['backup.schedule'],
  },
  {
    id: ONBOARDING_STEP_IDS.ORG_INVITE,
    audience: 'admin',
    tier: 'recommended',
    order: 70,
    title: 'Invite the first member to your organization',
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
  },
  {
    id: ONBOARDING_STEP_IDS.PROFILE,
    audience: 'user',
    tier: 'optional',
    order: 10,
    title: 'Complete your profile',
    description: 'Choose the name and picture other people see.',
    actionLabel: 'Edit profile',
    href: '/settings/profile',
    skippable: true,
    facts: [ONBOARDING_FACTS.USER_SETTINGS],
    funnelSql:
      "EXISTS (SELECT 1 FROM user_settings us WHERE us.user_id = c.id AND (COALESCE(btrim(us.value -> 'profile' ->> 'displayName'), '') <> '' OR COALESCE(us.value -> 'profile' ->> 'imageObjectId', '') <> ''))",
    evaluate: (facts) => ({
      status: profileSet(facts[ONBOARDING_FACTS.USER_SETTINGS] as Record<string, unknown> | null) ? 'done' : 'todo',
    }),
  },
  {
    id: ONBOARDING_STEP_IDS.NOTIFICATIONS,
    audience: 'user',
    tier: 'optional',
    order: 20,
    title: 'Choose your notifications',
    description: 'Decide which events reach you, and whether by email or in your browser.',
    actionLabel: 'Notification settings',
    href: '/settings/notifications',
    skippable: true,
    facts: [ONBOARDING_FACTS.USER_SETTINGS, ONBOARDING_FACTS.PUSH_SUBSCRIBED],
    funnelSql:
      "(EXISTS (SELECT 1 FROM user_settings us WHERE us.user_id = c.id AND jsonb_typeof(us.value -> 'notifications') = 'object') OR EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = c.id))",
    evaluate: (facts) => {
      const settings = facts[ONBOARDING_FACTS.USER_SETTINGS] as Record<string, unknown> | null;
      const saved = asRecord(settings?.['notifications']) !== null;
      return { status: saved || facts[ONBOARDING_FACTS.PUSH_SUBSCRIBED] === true ? 'done' : 'todo' };
    },
  },
];
