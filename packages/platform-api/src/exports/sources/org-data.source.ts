// =============================================================================
// The `org-data` export source: "give us our organization's data" (issue #744)
// =============================================================================
//
// Driven by the model-ownership registry (#725) and the user-owned registry
// (#688): every model of kind `org`, in registry order, filtered on its
// organization field, unless the user-owned registry marks the model
// `export: 'exclude'` (an org's encrypted credentials), with that entry's
// `exportOmit` and the default redaction rule. Plus:
//
//   - `organization`: the organization row itself;
//   - `members`: the membership list (user id, email, role, status, joined).
//
// Admin only: the permission is the org-admin read permission
// (`org_members:read`, held through `org_admin`), and a system administrator's
// `organizations:read` lets them name another organization. Read through the
// bypass client with an EXPLICIT `orgId` filter on every query, so row-level
// security on `org_id` neither hides this organization's rows nor shows
// another's: the filter is the boundary, and the db spec proves it with two
// organizations.
//
// The first step of offboarding ("export, then purge the org").
// =============================================================================

import { z } from 'zod';

import { modelOwnershipRegistry, orgFieldOf, userOwnedModelRegistry } from '../../core/index';
import type { ExportDatamodelModel } from '../datamodel';
import type { ExportContext, ExportRow, ExportSource, ExportTable } from '../export.types';
import { modelTable } from './model-table';

/**
 * The source id. PERMANENT once jobs carry it.
 *
 * @stability experimental
 */
export const ORG_DATA_EXPORT_SOURCE_ID = 'org-data';

/**
 * The permission the `org-data` source requires for the caller's active
 * organization: `org_members:read` (the `org_admin` membership role).
 *
 * @stability experimental
 */
export const ORG_DATA_EXPORT_PERMISSION = 'org_members:read';

/**
 * The permission that lets a caller export ANOTHER organization:
 * `organizations:read` (the system `admin` role).
 *
 * @stability experimental
 */
export const ORG_DATA_CROSS_ORG_PERMISSION = 'organizations:read';

function modelOf(ctx: ExportContext, name: string): ExportDatamodelModel | undefined {
  return ctx.datamodel.models.find((model) => model.name === name);
}

/** The membership list: who is in the organization, with which role, since when. */
function membersTable(ctx: ExportContext): ExportTable {
  const delegate = ctx.db.membership as { findMany(args: Record<string, unknown>): Promise<Array<Record<string, any>>> };
  const orgId = ctx.subjectId;
  const pageSize = ctx.pageSize;
  async function* rows(): AsyncGenerator<ExportRow> {
    let after: string | undefined;
    for (;;) {
      const page = await delegate.findMany({
        where: after === undefined ? { orgId } : { orgId, id: { gt: after } },
        select: {
          id: true,
          userId: true,
          status: true,
          createdAt: true,
          user: { select: { email: true } },
          role: { select: { name: true } },
        },
        orderBy: { id: 'asc' },
        take: pageSize,
      });
      for (const member of page) {
        yield {
          user_id: member.userId,
          email: member.user?.email ?? null,
          role: member.role?.name ?? null,
          status: typeof member.status === 'string' ? member.status : null,
          joined_at: member.createdAt instanceof Date ? member.createdAt.toISOString() : null,
        };
      }
      if (page.length < pageSize) return;
      after = page[page.length - 1]!.id as string;
    }
  }
  return {
    dataset: 'members',
    title: 'Members',
    columns: [
      { key: 'user_id', label: 'User id', type: 'string' },
      { key: 'email', label: 'Email', type: 'string' },
      { key: 'role', label: 'Role', type: 'string' },
      { key: 'status', label: 'Status', type: 'string' },
      { key: 'joined_at', label: 'Joined at', type: 'datetime' },
    ],
    rows: rows(),
  };
}

/**
 * The datasets of one organization's export, in order. Exposed for the
 * conformance suite and for an app source that wraps it.
 *
 * @param ctx - the export context (`subjectId` is the organization).
 * @returns the datasets.
 *
 * @stability experimental
 */
export async function* orgDataTables(ctx: ExportContext): AsyncGenerator<ExportTable> {
  const organization = modelOf(ctx, 'Organization');
  if (organization) {
    yield modelTable(ctx, { model: organization, where: { id: ctx.subjectId }, dataset: 'organization', title: 'Organization' });
  }
  if (modelOf(ctx, 'Membership') && typeof ctx.db.membership?.findMany === 'function') yield membersTable(ctx);

  for (const def of modelOwnershipRegistry.list()) {
    if (def.kind !== 'org') continue;
    const owned = userOwnedModelRegistry.get(def.model);
    if (owned?.export === 'exclude') continue;
    const model = modelOf(ctx, def.model);
    const orgField = orgFieldOf(def.model);
    if (!model || orgField === undefined) continue;
    yield modelTable(ctx, { model, where: { [orgField]: ctx.subjectId }, omit: owned?.exportOmit ?? [] });
  }
}

/**
 * The platform's `org-data` source: an organization's org-owned rows and its
 * membership list. Admin only (see the constants above). No request options;
 * the organization is `POST /exports`' `orgId` (default: the active one).
 *
 * @stability experimental
 */
export const ORG_DATA_EXPORT_SOURCE: ExportSource<Record<string, never>> = {
  id: ORG_DATA_EXPORT_SOURCE_ID,
  scope: 'org',
  label: 'Organization data',
  description: "Everything this application stores for the organization: its members, files list, groups, shares, settings and AI usage. Use it before an organization leaves.",
  permission: ORG_DATA_EXPORT_PERMISSION,
  crossOrgPermission: ORG_DATA_CROSS_ORG_PERMISSION,
  requestSchema: z.object({}).strict() as z.ZodType<Record<string, never>>,
  formats: ['json', 'csv', 'xlsx'],
  collect: (ctx) => orgDataTables(ctx),
};
