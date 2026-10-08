/**
 * The app's identity adapters (issue #727, PP-6.6): what the packaged identity
 * pages and hooks (`@marinoscar/platform-web/identity`) take from this app,
 * handed in through `IdentityWebAdaptersProvider` in `App.tsx`:
 *
 *   - `appName`: the product name the sign-in error copy names.
 *   - `Spinner`: `LoadingSpinner`, so loading states look like the rest of the app.
 *   - `api`: the identity calls, bound to this app's existing service
 *     functions (`services/api.ts`, `services/organizations.ts`), so their
 *     callers and tests keep one code path. The package's default,
 *     `createIdentityApi(appPlatformApi)`, sends the same requests; switching
 *     to it is PP-6.6 part 5.
 *
 * A module constant, like `appTelemetryAdapters`.
 */

import { APP_NAME } from '@app/shared';
import type { IdentityApi, IdentityWebAdapters } from '@marinoscar/platform-web/identity/headless';

import { LoadingSpinner } from '../components/common/LoadingSpinner';
import {
  addToAllowlist,
  authorizeDevice,
  createPersonalAccessToken,
  getAllowlist,
  getDeviceActivationInfo,
  getPersonalAccessTokens,
  getUsers,
  removeFromAllowlist,
  revokePersonalAccessToken,
  updateUser,
  updateUserRoles,
} from '../services/api';
import {
  createOrgInvite,
  createOrganization,
  getOrgInvites,
  getOrgMembers,
  getOrganizations,
  removeOrgMember,
  renameOrganization,
  revokeOrgInvite,
  updateOrgMember,
} from '../services/organizations';

/**
 * The identity calls over this app's service functions. Each member calls the
 * imported function at call time, so a test that mocks the service module
 * mocks what the packaged pages call.
 */
export const appIdentityApi: IdentityApi = Object.freeze<IdentityApi>({
  getUsers: (params) => getUsers(params),
  updateUser: (id, data) => updateUser(id, data),
  updateUserRoles: (id, roles) => updateUserRoles(id, roles),
  getAllowlist: (params) => getAllowlist(params),
  addToAllowlist: (email, notes) => addToAllowlist(email, notes),
  removeFromAllowlist: (id) => removeFromAllowlist(id),
  getDeviceActivationInfo: (userCode) => getDeviceActivationInfo(userCode),
  authorizeDevice: (userCode, approve) => authorizeDevice(userCode, approve),
  getPersonalAccessTokens: () => getPersonalAccessTokens(),
  createPersonalAccessToken: (data) => createPersonalAccessToken(data),
  revokePersonalAccessToken: (id) => revokePersonalAccessToken(id),
  getOrgMembers: (params) => getOrgMembers(params),
  updateOrgMember: (userId, data) => updateOrgMember(userId, data),
  removeOrgMember: (userId) => removeOrgMember(userId),
  getOrgInvites: (params) => getOrgInvites(params),
  createOrgInvite: (data) => createOrgInvite(data),
  revokeOrgInvite: (id) => revokeOrgInvite(id),
  getOrganizations: (params) => getOrganizations(params),
  createOrganization: (data) => createOrganization(data),
  renameOrganization: (id, name) => renameOrganization(id, name),
});

/** The adapters `App.tsx` hands the identity pages. */
export const appIdentityAdapters: IdentityWebAdapters = Object.freeze<IdentityWebAdapters>({
  appName: APP_NAME,
  Spinner: LoadingSpinner,
  api: appIdentityApi,
});
