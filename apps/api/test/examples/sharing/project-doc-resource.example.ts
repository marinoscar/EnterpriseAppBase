// =============================================================================
// Example: the resource type the access-rule examples protect (PP-14.16)
// =============================================================================
//
// A user-owned "project document" over the test-only `sharing_test_project_docs`
// table, with the two access rules of `apps/api/src/platform-extensions/sharing/`
// registered against it: members of the record's project may read it
// (`project-member`) and a frozen record is closed to everyone but its owner
// (`frozen-record`). The rules take the table names as configuration, so a real
// app passes its own; nothing here is specific to the test tables but their names.
//
// Register at import time, before bootstrap (an app's `app-registrations/`).
// Proven by ./project-member.example.db.spec.ts.
// =============================================================================

import { Prisma } from '@prisma/client';
import { accessRuleRegistry, registerAccessRule, registerResourceType, resourceTypeRegistry, type ResourceOwnerInfo, type ResourceTypeDef } from '@marinoscar/platform-api/sharing';

import { createFrozenRecordAccessRule } from '../../../src/platform-extensions/sharing/frozen-record.access-rule';
import { createProjectMemberAccessRule } from '../../../src/platform-extensions/sharing/project-member.access-rule';

/** The resource type id. */
export const PROJECT_DOC_TYPE = 'example_project_doc';

/** The project document type: viewer/editor roles, owner-only sharing, 404 on denial. */
export const projectDocType: ResourceTypeDef<'viewer' | 'editor'> = {
  type: PROJECT_DOC_TYPE,
  roles: ['viewer', 'editor'],
  actions: { read: 'viewer', write: 'editor', share: 'owner', delete: 'owner' },
  ownership: 'user',
  denyAs: 'not_found',
  async loadOwners(ids, tx) {
    if (ids.length === 0) return new Map();
    const rows = await (tx as Prisma.TransactionClient).$queryRaw<Array<{ id: string; org_id: string; owner_user_id: string }>>`
      SELECT id::text, org_id::text, owner_user_id::text FROM sharing_test_project_docs
      WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`;
    return new Map<string, ResourceOwnerInfo>(rows.map((row) => [row.id, { orgId: row.org_id, owner: { kind: 'user', userId: row.owner_user_id } }]));
  },
};

/** The rules, built over the test tables. */
export const projectMemberRule = createProjectMemberAccessRule({
  resourceType: PROJECT_DOC_TYPE,
  table: 'sharing_test_project_docs',
  membersTable: 'sharing_test_project_members',
});
export const frozenRecordRule = createFrozenRecordAccessRule({ resourceType: PROJECT_DOC_TYPE, table: 'sharing_test_project_docs' });

/** The app's registration calls (idempotent: each Jest file has its own module registry). */
export function registerProjectDocExample(): void {
  if (!resourceTypeRegistry.has(PROJECT_DOC_TYPE)) registerResourceType(projectDocType);
  for (const rule of [projectMemberRule, frozenRecordRule]) if (!accessRuleRegistry.has(rule.id)) registerAccessRule(rule);
}
