// =============================================================================
// Example: a GROUP-OWNED, link-shareable resource type, MemoriaHub-style
// (issue #732)
// =============================================================================
//
// Extension point: `registerResourceType` (rung 2), with group ownership.
//
// MemoriaHub's albums belong to a circle; a circle becomes a group (circles
// are sharing groups, not tenants: spec decision D6). Its roles map onto the
// group roles (`circle_admin` -> `admin`, `collaborator` -> `editor`,
// `viewer` -> `viewer`), and `groupRoleMap` turns each group role into the
// album role its members hold. `MediaShare` becomes a link grant
// (`grantable.link`), and a moderator permission reads any album
// (`bypassPermissions`).
//
// One call also registers the type as a group-owned resource
// (`registerGroupOwnedResource`, with its `countOwnedByGroup`), so deleting a
// group that still owns albums is refused with 409 `GROUP_OWNS_RESOURCES`.
// The example's albums are rows of the test-only `sharing_test_albums` table.
// Proven by ./group-owned-resource.example.db.spec.ts.
// =============================================================================

import { Prisma } from '@prisma/client';
import {
  registerResourceType,
  resourceTypeRegistry,
  type ResourceOwnerInfo,
  type ResourceTypeDef,
} from '@marinoscar/platform-api/sharing';

/** The resource type id: permanent once grants of it exist. */
export const ALBUM_TYPE = 'example_album';

/** A moderator permission that reads every album of the organization, whatever its group. */
export const ALBUMS_READ_ANY_PERMISSION = 'albums:read_any';

/** The album roles, weakest first. */
export type AlbumRole = 'viewer' | 'editor';

export const albumResourceType: ResourceTypeDef<AlbumRole> = {
  type: ALBUM_TYPE,
  roles: ['viewer', 'editor'],
  // `share_link`: who may mint and revoke links (MemoriaHub lets a collaborator share);
  // `share`: who may grant the album to people and groups (the group admins).
  actions: { read: 'viewer', write: 'editor', share_link: 'editor', share: 'owner', delete: 'owner' },
  bypassPermissions: { read: ALBUMS_READ_ANY_PERMISSION },
  ownership: 'group',
  // MemoriaHub's circle roles: circle_admin -> admin (owns it), collaborator -> editor, viewer -> viewer.
  groupRoleMap: { admin: 'owner', editor: 'editor', viewer: 'viewer' },
  // People outside the circle may only view; other groups may view or edit; a link only views.
  grantable: { user: ['viewer'], group: ['viewer', 'editor'], link: ['viewer'] },
  async loadOwners(ids, tx) {
    const rows = await (tx as Prisma.TransactionClient).$queryRaw<Array<{ id: string; org_id: string; owner_group_id: string }>>`
      SELECT id::text, org_id::text, owner_group_id::text FROM sharing_test_albums
      WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) AND owner_group_id IS NOT NULL`;
    return new Map<string, ResourceOwnerInfo>(rows.map((row) => [row.id, { orgId: row.org_id, owner: { kind: 'group', groupId: row.owner_group_id } }]));
  },
  // Feeds the group-deletion guard, inside the deleting transaction.
  async countOwnedByGroup(groupId, tx) {
    const rows = await (tx as Prisma.TransactionClient).$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM sharing_test_albums WHERE owner_group_id = ${groupId}::uuid`;
    return rows[0]?.n ?? 0;
  },
  async describe(ids, tx) {
    const rows = await (tx as Prisma.TransactionClient).$queryRaw<Array<{ id: string; title: string }>>`
      SELECT id::text, title FROM sharing_test_albums WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`;
    return new Map(rows.map((row) => [row.id, { title: row.title, path: `/albums/${row.id}` }]));
  },
};

/** The app's registration call. */
export function registerAlbumResourceType(): void {
  if (!resourceTypeRegistry.has(ALBUM_TYPE)) registerResourceType(albumResourceType);
}
