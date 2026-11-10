// =============================================================================
// Example: an APP GROUP ROLE and a PERSISTED APP GRANTEE KIND (PP-14.15b)
// =============================================================================
//
// Extension points: `registerGroupRole` and `registerGranteeKind` (rung 2).
//
// An app adds a group role (`commenter`: reads, and comments in the app's own
// sense) and a grantee kind (`email-domain`: everyone at one domain) with no
// package edit and no migration: both are text in the database
// (migration 0037_open_sharing_vocabularies). A resource type decides what they
// mean for ITS records:
//
//   groupRoleMap  `commenter` members of the owning group hold `viewer`; a role
//                 the map does not name (`auditor` here) holds NOTHING;
//   grantable     `email-domain` grants may carry `viewer` only (an app kind is
//                 grantable to nothing until a type lists it).
//
// Register roles and kinds BEFORE the resource types that name them, at import
// time, before bootstrap. Proven by ./open-vocabularies.example.db.spec.ts.
// =============================================================================

import { registerGranteeKind, registerGroupRole, registerResourceType, granteeKindRegistry, groupRoleRegistry, resourceTypeRegistry } from '@marinoscar/platform-api/sharing';

import { emailDomainGranteeKind } from '../../../src/platform-extensions/sharing/email-domain.grantee-kind';
import { albumResourceType } from './group-owned-resource.example';

/** The resource type id of the example. */
export const OPEN_ALBUM_TYPE = 'example_open_album';

/** The app's own group roles. */
export const COMMENTER_ROLE = 'commenter';
export const AUDITOR_ROLE = 'auditor';

/** The app's registration call (idempotent here because each Jest file has its own module registry). */
export function registerOpenVocabularies(): void {
  if (!groupRoleRegistry.has(COMMENTER_ROLE)) {
    registerGroupRole({ id: COMMENTER_ROLE, label: 'Commenter', description: 'Read the group\'s records and comment on them.', actions: ['read', 'comment'] });
  }
  if (!groupRoleRegistry.has(AUDITOR_ROLE)) registerGroupRole({ id: AUDITOR_ROLE, label: 'Auditor', actions: ['audit'] });
  if (!granteeKindRegistry.has(emailDomainGranteeKind.kind)) registerGranteeKind(emailDomainGranteeKind);
  if (!resourceTypeRegistry.has(OPEN_ALBUM_TYPE)) {
    registerResourceType({
      ...albumResourceType,
      type: OPEN_ALBUM_TYPE,
      groupRoleMap: { admin: 'owner', editor: 'editor', viewer: 'viewer', [COMMENTER_ROLE]: 'viewer' },
      grantable: { user: ['viewer'], group: ['viewer', 'editor'], link: ['viewer'], 'email-domain': ['viewer'] },
    });
  }
}
