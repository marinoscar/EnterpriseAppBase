// =============================================================================
// The platform's own user-data declarations (issue #743, PP-9.1)
// =============================================================================
//
// Pure data for the five registries, covering the PLATFORM's models only: the
// categories the Danger Zone shows on a fresh install, a keep-or-delete hint
// for every platform model with an owner column, and the deployment-wide
// leftovers of the factory reset. An app registers these first, then its own
// (`registerPlatformUserData()` in its manifest).
//
// Kept by every data reset (EvoPath's rule, plus the tenancy tables): the
// account (`UserIdentity`, `UserRole`), the session (`RefreshToken`, so the
// user stays signed in to read the result), memberships of organizations and
// groups, shares granted to the user, and the deployment's worker nodes and
// their credentials. `User`, `AllowedEmail` and `AuditEvent` have no owner
// column and are never touched by a user purge.
// =============================================================================

import type { FactoryResetStepDef, UserDataCategoryDef, UserDataModelHint } from './user-data.types';
import {
  USER_DATA_OTHER_CATEGORY,
  factoryResetStepRegistry,
  registerFactoryResetStep,
  registerUserDataCategory,
  registerUserDataModels,
  userDataCategoryRegistry,
  userDataModelRegistry,
} from './user-data.registries';

/**
 * The platform's categories, in display order: `files`, `notifications`,
 * `ai`, `credentials` and `settings` (the last two `content: false`), and
 * `other`, where a model without a hint lands.
 *
 * @stability experimental
 */
export const PLATFORM_USER_DATA_CATEGORIES: readonly UserDataCategoryDef[] = Object.freeze([
  { id: 'files', label: 'Files', description: 'Everything you uploaded, and its bytes in object storage.', content: true, order: 10 },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'Your inbox, the record of what was sent to you, and your browser push subscriptions.',
    content: true,
    order: 20,
  },
  { id: 'ai', label: 'AI history and keys', description: 'Your AI runs, their usage records and your own provider keys.', content: true, order: 30 },
  {
    id: 'credentials',
    label: 'Access tokens and credentials',
    description: 'Personal access tokens, pending device logins and your stored credentials. Scripts using a token stop working.',
    content: false,
    order: 40,
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Your preferences, display name and profile image. They return to the defaults.',
    content: false,
    order: 50,
    clearUserFields: ['displayName', 'profileImageUrl'],
  },
  { id: USER_DATA_OTHER_CATEGORY, label: 'Other data', description: 'Anything else you own in this application.', content: true, order: 90 },
]);

/**
 * A keep-or-delete hint for every platform model with an owner column, plus
 * the factory reset decision for the platform's configuration tables.
 *
 * @stability experimental
 */
export const PLATFORM_USER_DATA_MODELS: readonly UserDataModelHint[] = Object.freeze([
  { model: 'StorageObject', category: 'files', storageObjects: true },
  { model: 'Notification', category: 'notifications' },
  { model: 'NotificationDelivery', category: 'notifications' },
  { model: 'PushSubscription', category: 'notifications' },
  { model: 'AiRun', category: 'ai' },
  { model: 'AiUsageEvent', category: 'ai' },
  { model: 'UserAiKey', category: 'ai' },
  { model: 'PersonalAccessToken', category: 'credentials' },
  { model: 'DeviceCode', category: 'credentials' },
  { model: 'UserCredential', category: 'credentials' },
  { model: 'UserSettings', category: 'settings' },
  { model: 'UserIdentity', keep: 'Account state: the user keeps signing in with it.' },
  { model: 'UserRole', keep: "Access model: the user keeps their role." },
  { model: 'RefreshToken', keep: 'The session survives, so the user can read the result.' },
  { model: 'Membership', keep: "Tenancy: a data reset never removes the user from an organization." },
  { model: 'GroupMember', keep: 'Access model: group memberships are removed only with the user row (GroupMembershipPurge).' },
  { model: 'Grant', keep: 'Access model: a share belongs to the record owner, not to the grantee.' },
  { model: 'WorkerNode', keep: 'Deployment infrastructure; the factory reset reassigns nodes to the administrator.' },
  { model: 'NodeCredential', keep: 'A worker node identity, deployment infrastructure.' },
  { model: 'OrgSettings', factoryReset: 'keep' },
  { model: 'OrgCredential', factoryReset: 'keep' },
]);

/** A delegate of the app's client, or `undefined` when the schema has no such model. */
function delegate(tx: any, name: string): any {
  return tx?.[name];
}

/**
 * The platform's deployment-wide factory reset leftovers (phase
 * `deployment`): broadcasts, every remaining device code, the job statistics
 * rollup, and the allowlist except the administrator's own entry.
 *
 * @stability experimental
 */
export const PLATFORM_FACTORY_RESET_STEPS: readonly FactoryResetStepDef[] = Object.freeze<FactoryResetStepDef[]>([
  {
    id: 'platform.broadcasts',
    phase: 'deployment' as const,
    description: 'Every notification broadcast.',
    async run(tx: any): Promise<Record<string, number>> {
      const model = delegate(tx, 'notificationBroadcast');
      return model ? { broadcasts: (await model.deleteMany({})).count } : {};
    },
  },
  {
    id: 'platform.device-codes',
    phase: 'deployment' as const,
    description: 'Every remaining device code (device logins in flight are lost).',
    async run(tx: any): Promise<Record<string, number>> {
      const model = delegate(tx, 'deviceCode');
      return model ? { deviceCodes: (await model.deleteMany({})).count } : {};
    },
  },
  {
    id: 'platform.job-stats',
    phase: 'deployment' as const,
    description: 'The job statistics rollup.',
    async run(tx: any): Promise<Record<string, number>> {
      const model = delegate(tx, 'jobStatsRollup');
      return model ? { rollups: (await model.deleteMany({})).count } : {};
    },
  },
  {
    id: 'platform.allowlist',
    phase: 'deployment' as const,
    description: "Every allowlist entry except the administrator's own.",
    async run(tx: any, ctx): Promise<Record<string, number>> {
      const model = delegate(tx, 'allowedEmail');
      if (!model) return {};
      const actor = await tx.user.findUnique({ where: { id: ctx.actorUserId }, select: { email: true } });
      const keep: Record<string, unknown>[] = [{ claimedById: ctx.actorUserId }];
      if (actor?.email) keep.push({ email: { equals: actor.email, mode: 'insensitive' } });
      return { allowlistEntries: (await model.deleteMany({ where: { NOT: { OR: keep } } })).count };
    },
  },
]);

/**
 * Registers {@link PLATFORM_USER_DATA_CATEGORIES},
 * {@link PLATFORM_USER_DATA_MODELS} and {@link PLATFORM_FACTORY_RESET_STEPS}.
 * Idempotent: an entry already registered is skipped. Call it first in the
 * app's user-data manifest, before the app's own entries.
 *
 * @stability experimental
 * @example
 * ```ts
 * registerPlatformUserData();
 * registerUserDataModels(APP_USER_DATA_MODELS);
 * ```
 */
export function registerPlatformUserData(): void {
  for (const def of PLATFORM_USER_DATA_CATEGORIES) {
    if (!userDataCategoryRegistry.has(def.id)) registerUserDataCategory(def);
  }
  registerUserDataModels(PLATFORM_USER_DATA_MODELS.filter((def) => !userDataModelRegistry.has(def.model)));
  for (const step of PLATFORM_FACTORY_RESET_STEPS) {
    if (!factoryResetStepRegistry.has(step.id)) registerFactoryResetStep(step);
  }
}
