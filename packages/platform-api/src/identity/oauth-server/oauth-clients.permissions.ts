// =============================================================================
// OAuth client permissions (PP-15.5, docs/specs/oauth-server.md §3)
// =============================================================================
//
// Pure data, like `users/users.permissions.ts`: imports only types and has no
// side effect; the manifest slice (`registerPlatformPermissions()`) registers it.
// SYSTEM scope, held by `admin` only: which OAuth clients may exist is a
// deployment decision. After a change, run `npm run catalog:permissions
// --workspace=api` and commit the regenerated `prisma/catalog/permissions.json`.
// =============================================================================

import type { IdentityPermissionDeclaration as PermissionDeclaration } from '../identity.permissions';

/**
 * The permissions of OAuth clients: `oauth_clients:read` and `oauth_clients:write` (system, `admin`).
 *
 * @stability experimental
 */
export const OAUTH_CLIENTS_PERMISSIONS: {
  /** `oauth_clients:read`: list OAuth clients and the refused client hosts. */
  readonly OAUTH_CLIENTS_READ: PermissionDeclaration<'oauth_clients:read'>;
  /** `oauth_clients:write`: pre-register, edit, disable, rotate the secret of and delete OAuth clients. */
  readonly OAUTH_CLIENTS_WRITE: PermissionDeclaration<'oauth_clients:write'>;
} = {
  OAUTH_CLIENTS_READ: {
    id: 'oauth_clients:read',
    description: 'View OAuth clients',
    scope: 'system',
    defaultGrants: ['admin'],
  },
  OAUTH_CLIENTS_WRITE: {
    id: 'oauth_clients:write',
    description: 'Manage OAuth clients: pre-register, edit, disable, rotate secrets, delete',
    scope: 'system',
    defaultGrants: ['admin'],
  },
};
