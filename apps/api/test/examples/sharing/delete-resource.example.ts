// =============================================================================
// Example: deleting shared records without dangling grants (issue #732)
// =============================================================================
//
// Extension point: `GrantsService.deleteForResources` (rung 5).
//
// A grant names its record by `(resource_type, resource_id)` with no foreign
// key (the record lives in an app table the platform cannot reference), so
// deleting the record does not delete its grants. The app calls
// `deleteForResources` INSIDE the transaction that deletes the records: both
// commit or neither does. The daily `sharing.grants.prune` job is the safety
// net for a forgotten call, never the plan.
//
// The check runs in the same transaction (`requireIn`), so nothing can change
// between "may I delete it" and the delete. Proven by
// ./user-owned-resource.example.db.spec.ts.
// =============================================================================

import type { Principal } from '@marinoscar/platform-api/core';
import type { AccessPolicy, GrantsService } from '@marinoscar/platform-api/sharing';

import type { PrismaService } from '../../../src/prisma/prisma.service';
import { NOTE_TYPE } from './user-owned-resource.example';

/** `DELETE /notes/:id`: the owner only (`actions.delete: 'owner'`); 404 otherwise. Returns how many grants went with it. */
export async function deleteNote(
  deps: { prisma: PrismaService; access: AccessPolicy; grants: GrantsService },
  principal: Principal,
  id: string,
): Promise<{ grantsDeleted: number }> {
  return deps.prisma.runInOrg(principal.activeOrgId!, async (tx) => {
    await deps.access.requireIn(tx, principal, 'delete', { type: NOTE_TYPE, id });
    const grantsDeleted = await deps.grants.deleteForResources(tx, NOTE_TYPE, [id]);
    await tx.$executeRaw`DELETE FROM sharing_test_docs WHERE id = ${id}::uuid`;
    return { grantsDeleted };
  });
}
