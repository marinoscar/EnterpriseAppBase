// =============================================================================
// Example: a group-owned table that is never shared (issue #732)
// =============================================================================
//
// Extension point: `registerGroupOwnedResource` (rung 2), used directly.
//
// Not every group-owned row is a shareable record. A group's own notes (a
// circle's pinned notes in MemoriaHub) are visible to its members through
// `ownedByMeOrMyGroups`, and never granted to anyone else, so they need no
// resource type. They still need the group-deletion guard: register the
// table's `countOwnedByGroup`, and `DELETE /api/groups/:id` answers 409
// `GROUP_OWNS_RESOURCES` with `details.counts` while any row remains, instead
// of orphaning them (the `owner_group_id` foreign key is `ON DELETE RESTRICT`
// as the second line of defence).
//
// A type registered with `registerResourceType` and group ownership is
// registered here automatically; never register it twice. Proven by
// ./group-owned-resource.example.db.spec.ts.
// =============================================================================

import type { Prisma } from '@prisma/client';
import { groupOwnedResourceRegistry, registerGroupOwnedResource } from '@marinoscar/platform-api/sharing';

/** The group-owned resource id (the key of `details.counts`). */
export const GROUP_NOTE_TYPE = 'example_group_note';

/** The app's registration call: group-owned rows of `sharing_test_docs`. */
export function registerGroupNotes(): void {
  if (groupOwnedResourceRegistry.has(GROUP_NOTE_TYPE)) return;
  registerGroupOwnedResource({
    type: GROUP_NOTE_TYPE,
    async countOwnedByGroup(groupId, tx) {
      const rows = await (tx as Prisma.TransactionClient).$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM sharing_test_docs WHERE owner_group_id = ${groupId}::uuid`;
      return rows[0]?.n ?? 0;
    },
  });
}
