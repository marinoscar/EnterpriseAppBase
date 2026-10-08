/**
 * The notes module's permissions, as data (seeded by `prisma/seed.ts` through
 * `src/platform/permissions.ts`). The exact strings the controller enforces
 * and the web card declares.
 */
export const NOTES_PERMISSIONS = {
  NOTES_READ: {
    id: 'notes:read',
    description: 'Read own notes',
    scope: 'org',
    defaultGrants: ['contributor', 'viewer', 'org_admin'],
  },
  NOTES_WRITE: {
    id: 'notes:write',
    description: 'Create, edit and delete own notes',
    scope: 'org',
    defaultGrants: ['contributor', 'org_admin'],
  },
} as const;
