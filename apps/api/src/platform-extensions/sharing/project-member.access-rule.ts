// =============================================================================
// Example access rule: "members of the record's project may read it" (PP-14.16)
// =============================================================================
//
// Extension point: `registerAccessRule` (rung 2 of the extension contract).
//
// An app that has projects wants every member of a record's project to see the
// record without a grant per person. That is a rule, not a replacement of
// `AccessPolicy`: it ALLOWS (a `viewer` by default, or the `role` below) and the
// slice keeps owners, grants and the organization default as they were. It has
// two spellings of one predicate, and `describeAccessRuleConformance`
// (`@marinoscar/platform-api/sharing/testing`) proves they agree:
//
//   evaluate  the in-memory decision (`AccessPolicy.decide`), one cached
//             membership query per decision call, then a lookup of the record's
//             project;
//   sql       the "resources I can see" condition (`accessibleSql` /
//             `accessibleWhere`'s EXISTS form).
//
// SECURITY. Every value is a bind parameter. The two table names and the
// column name come from the app's configuration, not from a request, and are
// checked as plain identifiers before they reach `Prisma.raw`. Every query
// names the caller's organization (`ctx.resource.orgId` / `ctx.orgId`) as well
// as relying on row-level security, so a membership in another organization
// never counts, even for the same project id.
//
// Register it at import time, before bootstrap, from an app registration file
// (`app-registrations/`), AFTER the resource type it names:
//
//   registerAccessRule(createProjectMemberAccessRule({ resourceType: 'project_document', table: 'project_documents' }));
//
// The reference app has no project table, so nothing registers it here: the
// proof is apps/api/test/examples/sharing/project-member.example.db.spec.ts.
// =============================================================================

import type { AccessRuleDef } from '@marinoscar/platform-api/sharing';
import { Prisma } from '@prisma/client';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Where the rule finds the records and their projects.
 *
 * @stability experimental
 */
export interface ProjectMemberRuleConfig {
  /** The resource type the rule applies to (a registered `registerResourceType` id). */
  resourceType: string;
  /** The table of the records: `id`, `org_id` and the project column. */
  table: string;
  /** The record's project column. Default `project_id`. */
  projectColumn?: string;
  /** The membership table: `org_id`, `project_id`, `user_id`. Default `project_members`. */
  membersTable?: string;
  /** The role a membership confers. Default: the resource type's weakest role. */
  role?: string;
  /** The rule's id (`AccessDecision.via` of an allow). Default `project-member`. */
  id?: string;
}

function identifier(value: string, what: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`createProjectMemberAccessRule: ${what} must be a plain identifier, not ${JSON.stringify(value)}`);
  return value;
}

/**
 * Builds the project-member rule for one resource type.
 *
 * @param config - the resource type and its tables.
 * @returns the rule, ready for `registerAccessRule`.
 * @throws Error when a table or column name is not a plain identifier.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function createProjectMemberAccessRule(config: ProjectMemberRuleConfig): AccessRuleDef {
  const table = Prisma.raw(`"${identifier(config.table, 'table')}"`);
  const projectColumn = identifier(config.projectColumn ?? 'project_id', 'projectColumn');
  const projectColumnSql = Prisma.raw(`"${projectColumn}"`);
  const membersName = identifier(config.membersTable ?? 'project_members', 'membersTable');
  const members = Prisma.raw(`"${membersName}"`);

  return {
    id: config.id ?? 'project-member',
    position: 'before-grants',
    resourceTypes: [config.resourceType],
    ...(config.role ? { role: config.role } : {}),

    async evaluate(ctx) {
      const tx = ctx.tx as Prisma.TransactionClient;
      const orgId = ctx.resource.orgId;
      // One membership query per decision call, however many records it decides.
      const cacheKey = `project-member:${config.resourceType}:${ctx.principal.userId}`;
      let projects = ctx.cache.get(cacheKey) as Set<string> | undefined;
      if (!projects) {
        const rows = await tx.$queryRaw<Array<{ project_id: string }>>`
          SELECT project_id::text AS project_id FROM ${members}
          WHERE org_id = ${orgId}::uuid AND user_id = ${ctx.principal.userId}::uuid`;
        projects = new Set(rows.map((row) => row.project_id));
        ctx.cache.set(cacheKey, projects);
      }
      if (projects.size === 0) return 'abstain';
      const record = await tx.$queryRaw<Array<{ project_id: string | null }>>`
        SELECT ${projectColumnSql}::text AS project_id FROM ${table}
        WHERE id = ${ctx.resource.id}::uuid AND org_id = ${orgId}::uuid`;
      const project = record[0]?.project_id;
      return project && projects.has(project) ? 'allow' : 'abstain';
    },

    sql: (ctx) => ({
      allow: ctx.kit.sql`EXISTS (
        SELECT 1 FROM ${ctx.kit.raw(`"${membersName}"`)} pm
        WHERE pm.org_id = ${ctx.orgId}::uuid
          AND pm.user_id = ${ctx.principal.userId}::uuid
          AND pm.project_id = ${ctx.column(projectColumn)}
      )`,
    }),
  };
}
