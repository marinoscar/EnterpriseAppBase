// =============================================================================
// Example: a USER-OWNED shareable resource type, kvox-style (issue #732)
// =============================================================================
//
// Extension point: `registerResourceType` (rung 2 of the extension contract).
//
// kvox's `TranscriptShare` (a transcript shared with one user as `viewer` or
// `editor`) and its `TranscriptAccessService.require()` (404, never 403) are
// this one call. A real app passes its own table; the example's "notes" are
// rows of the test-only `sharing_test_docs` table, read with `$queryRaw`
// because that table has no Prisma model (a real app would write
// `tx.note.findMany({ where: { id: { in: ids } }, select: ... })`).
//
// Register it at import time, before bootstrap (the reference app's
// `src/app-registrations/` modules); the registry freezes afterwards.
// Proven by ./user-owned-resource.example.db.spec.ts.
// =============================================================================

import { Prisma } from '@prisma/client';
import {
  registerResourceType,
  resourceTypeRegistry,
  type ResourceDescription,
  type ResourceOwnerInfo,
  type ResourceTypeDef,
} from '@marinoscar/platform-api/sharing';

/** The resource type id: permanent once grants of it exist (like a job type string). */
export const NOTE_TYPE = 'example_note';

/** The RBAC permission `write` needs on top of the record role (kvox: `transcripts:write`). */
export const NOTES_WRITE_PERMISSION = 'notes:write';

/** The roles a note can be shared with, weakest first. `'owner'` is implicit. */
export type NoteRole = 'viewer' | 'editor';

/** The note type: viewer/editor grants to users and groups, owner-only sharing, 404 on denial. */
export const noteResourceType: ResourceTypeDef<NoteRole> = {
  type: NOTE_TYPE,
  roles: ['viewer', 'editor'],
  actions: { read: 'viewer', write: 'editor', share: 'owner', delete: 'owner' },
  // `write` ALSO needs the RBAC permission, even for the owner: a viewer-role
  // org member who owns a note still cannot edit it (403 naming the permission).
  actionPermissions: { write: NOTES_WRITE_PERMISSION },
  ownership: 'user',
  // A denial is the same 404 as a missing record (kvox and MemoriaHub both hide existence).
  denyAs: 'not_found',
  // ONE query for the whole batch, inside the transaction the slice opened (scoped to the caller's organization).
  async loadOwners(ids, tx) {
    const rows = await (tx as Prisma.TransactionClient).$queryRaw<Array<{ id: string; org_id: string; owner_user_id: string }>>`
      SELECT id::text, org_id::text, owner_user_id::text FROM sharing_test_docs
      WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) AND owner_user_id IS NOT NULL`;
    return new Map<string, ResourceOwnerInfo>(rows.map((row) => [row.id, { orgId: row.org_id, owner: { kind: 'user', userId: row.owner_user_id } }]));
  },
  // Optional: titles for "shared with me" and the share notification.
  async describe(ids, tx) {
    const rows = await (tx as Prisma.TransactionClient).$queryRaw<Array<{ id: string; title: string }>>`
      SELECT id::text, title FROM sharing_test_docs WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`;
    return new Map<string, ResourceDescription>(rows.map((row) => [row.id, { title: row.title, path: `/notes/${row.id}` }]));
  },
};

/** The app's registration call (idempotent here because each Jest file has its own module registry). */
export function registerNoteResourceType(): void {
  if (!resourceTypeRegistry.has(NOTE_TYPE)) registerResourceType(noteResourceType);
}
