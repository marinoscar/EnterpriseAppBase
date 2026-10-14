// =============================================================================
// The settings slice's host ports (issue #733, PP-8.1)
// =============================================================================
//
// Every capability settings needs from the application, as ONE injection
// token per capability. The slice injects these and never imports an app
// service; the app binds each token in a `@Global()` module of its own (the
// reference app: `apps/api/src/platform/settings/settings-host.module.ts`),
// passed to `SettingsModule.forRoot({ imports })`.
//
// The deployment-wide tables (`system_settings`, `user_settings`) go through
// the core port `PLATFORM_PRISMA`; the one org table (`org_settings`, FORCEd
// row-level security) only through `SETTINGS_DATA.runInOrg`, so a query can
// never run without an organization scope.
//
// The tokens are `Symbol.for(...)` keys, so two copies of this file agree.
// =============================================================================

import type { UserProfileSettingsValue } from '@marinoscar/platform-contract/settings';

import type { SettingsOrgTx } from './data/settings-db';

// ---- org-scoped data (the SETTINGS_DATA seam) ------------------------------------

/**
 * Injection token of the app's {@link SettingsDataPort}: how the slice opens a
 * transaction in one organization's row-level-security scope.
 *
 * @example
 * ```ts
 * // SettingsHostModule: { provide: SETTINGS_DATA, useClass: SettingsDataAdapter }
 * // runInOrg(scope, fn) => prisma.runInOrg(scope.orgId, (tx) => fn(tx), { userId: scope.userId })
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const SETTINGS_DATA: unique symbol = Symbol.for('@marinoscar/platform/settings/DATA');

/**
 * The app's org-scoped transactions, as the settings slice uses them.
 *
 * @stability experimental
 */
export interface SettingsDataPort {
  /**
   * Runs `fn` in ONE transaction whose first statement sets the organization
   * (and, when given, the user) scope transaction-locally, so row-level
   * security confines every `org_settings` query to `scope.orgId`. The
   * reference app binds it to `PrismaService.runInOrg`.
   *
   * @param scope - the organization, and the acting user when there is one.
   * @param fn - the work; receives the transaction client.
   */
  runInOrg<R>(scope: { orgId: string; userId?: string }, fn: (tx: SettingsOrgTx) => Promise<R>): Promise<R>;
}

// ---- profile images (the SETTINGS_PROFILE_IMAGES seam) ---------------------------

/**
 * Injection token of the app's {@link SettingsProfileImages}: the stored
 * profile's normalisation and the uploaded-avatar check, which need object
 * storage (a slice settings does not own; it moves with storage, #736).
 *
 * @extensionPoint token
 * @stability experimental
 */
export const SETTINGS_PROFILE_IMAGES: unique symbol = Symbol.for('@marinoscar/platform/settings/PROFILE_IMAGES');

/**
 * A stored `profile` read for a response: `imageObjectId` always present
 * (`null` when nothing is uploaded), legacy shapes rewritten.
 *
 * @stability experimental
 */
export type NormalizedProfileSettings = UserProfileSettingsValue & {
  /** The uploaded avatar's object id, or `null`. */
  imageObjectId: string | null;
};

/**
 * Profile pictures, as `UserSettingsService` checks and returns them.
 *
 * @stability experimental
 */
export interface SettingsProfileImages {
  /**
   * The stored `profile` (anything at all, including a legacy shape or
   * nothing) as a normalised profile.
   *
   * @param stored - the raw `profile` value of the settings row.
   */
  normalize(stored: unknown): NormalizedProfileSettings;
  /**
   * Whether `objectId` names a usable avatar `userId` uploaded through the
   * app's profile-image route (owned, written by that route, ready, and of a
   * validated image type).
   *
   * @param userId - the caller.
   * @param objectId - the object id the write would store.
   */
  isUploadedAvatar(userId: string, objectId: string): Promise<boolean>;
}
