// Shared fixtures for the OAuth server unit tests (PP-15.3). Not a spec file.
import { createHash } from 'node:crypto';

import type { OAuthProtectedResourceDefinition, OAuthScopeDefinition } from '../../../src/identity/index';

export const APP_URL = 'https://app.example.test';

export const NOTES_SCOPES: OAuthScopeDefinition[] = [
  { id: 'notes:read', title: 'Read notes', description: 'See notes.', permissions: ['notes:read'], risk: 'low', default: true },
  { id: 'notes:write', title: 'Change notes', description: 'Edit notes.', permissions: ['notes:write'], risk: 'elevated' },
];

export const NOTES_RESOURCE: OAuthProtectedResourceDefinition = {
  id: 'notes',
  path: '/api/notes-agent',
  routePrefixes: ['/api/notes-agent'],
  scopes: ['notes:read', 'notes:write'],
  name: 'Notes agent',
};

export const OTHER_RESOURCE: OAuthProtectedResourceDefinition = {
  id: 'other',
  path: '/api/other-agent',
  routePrefixes: ['/api/other-agent'],
  scopes: ['notes:read'],
  name: 'Other agent',
};

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export function permissionsGraph(...names: string[]) {
  return { role: { name: 'role', rolePermissions: names.map((name) => ({ permission: { name } })) } };
}

/** A loaded user graph: an org-role membership in ORG_ID holding `perms`, system roles `systemRoles`. */
export const ORG_ID = '00000000-0000-4000-8000-0000000000aa';
export function userGraph(perms: string[], options: { systemRoles?: Array<{ name: string; perms: string[] }>; isActive?: boolean; orgId?: string | null } = {}) {
  const orgId = options.orgId === undefined ? ORG_ID : options.orgId;
  return {
    id: 'user-1',
    email: 'user-1@example.test',
    isActive: options.isActive ?? true,
    userRoles: (options.systemRoles ?? []).map((r) => ({ role: { name: r.name, rolePermissions: r.perms.map((name) => ({ permission: { name } })) } })),
    memberships: orgId
      ? [{ orgId, status: 'active', lastActiveAt: null, org: { id: orgId, isDefault: false }, role: { name: 'contributor', rolePermissions: perms.map((name) => ({ permission: { name } })) } }]
      : [],
  };
}

/** A fully loaded `oauth_tokens` row as the resolver reads it. */
export function tokenRow(over: Record<string, unknown> = {}, grantOver: Record<string, unknown> = {}, user = userGraph(['notes:read', 'notes:write'])) {
  return {
    id: 'tok-1',
    kind: 'access',
    grantId: 'grant-1',
    scopes: ['notes:read'],
    expiresAt: new Date(Date.now() + 3_600_000),
    revokedAt: null,
    grant: {
      id: 'grant-1',
      orgId: ORG_ID,
      clientId: 'client-1',
      resource: `${APP_URL}/api/notes-agent`,
      scopes: ['notes:read', 'notes:write'],
      revokedAt: null,
      client: { id: 'client-1', disabledAt: null },
      user,
      ...grantOver,
    },
    ...over,
  };
}
