// =============================================================================
// Example: "resources I can see" in a list endpoint (issue #732)
// =============================================================================
//
// Extension points: `accessibleWhere`, `accessibleSql` and
// `ownedByMeOrMyGroups` (rung 5: the slice's query helpers).
//
// A list asks the inverse of `AccessPolicy`: WHICH records may I see. Give
// every helper a principal `PrincipalGroupsProvider.enrich()` filled with its
// groups, and run it inside the caller's org-scoped transaction:
//
//   accessibleWhere   a Prisma `where` for `findMany`/`count`; above 1,000
//                     shared records it hands back `{ form: 'exists', sql }`
//                     instead of growing an id list, which the caller runs
//                     with `$queryRaw`
//   accessibleSql     the same condition for `$queryRaw` (paging in SQL); the
//                     only sanctioned raw-SQL path to `grants`
//   ownedByMeOrMyGroups  "mine or my groups'" without grants (MemoriaHub's
//                     circle-scoped lists)
//
// Scopes: `owned` (mine), `groups` (owned by a group I belong to), `shared`
// (an active grant to me or my groups, or the type's org default), `all`.
// Proven by ./user-owned-resource.example.db.spec.ts (notes) and
// ./group-owned-resource.example.db.spec.ts (albums).
// =============================================================================

import type { Principal } from '@marinoscar/platform-api/core';
import type { AccessScope } from '@marinoscar/platform-contract/sharing';
import { accessibleSql, accessibleWhere, ownedByMeOrMyGroups, type PrincipalGroupsProvider } from '@marinoscar/platform-api/sharing';
import { Prisma } from '@prisma/client';

import type { PrismaService } from '../../../src/prisma/prisma.service';
import { NOTE_TYPE } from './user-owned-resource.example';

/** What a list returns. */
export interface ListedRecord {
  id: string;
  title: string;
}

/** The model delegate a list reads with (`tx.note` in a real app). */
export interface RecordDelegate {
  findMany(args: { where: Record<string, unknown> }): Promise<ListedRecord[]>;
}

/**
 * `GET /notes?scope=owned|shared|all`, with Prisma: `accessibleWhere`, and the
 * EXISTS form when the caller has more than 1,000 shared notes.
 */
export async function listNotes(
  deps: { prisma: PrismaService; principalGroups: PrincipalGroupsProvider; notes: (tx: Prisma.TransactionClient) => RecordDelegate },
  principal: Principal,
  scope: AccessScope = 'all',
): Promise<ListedRecord[]> {
  const me = await deps.principalGroups.enrich(principal);
  return deps.prisma.runInOrg(me.activeOrgId!, async (tx) => {
    const access = await accessibleWhere(me, NOTE_TYPE, { tx, sqlKit: Prisma, scope });
    if (access.form === 'where') return deps.notes(tx).findMany({ where: access.where });
    return tx.$queryRaw<ListedRecord[]>`SELECT r.id::text, r.title FROM sharing_test_docs r WHERE ${access.sql} ORDER BY r.title`;
  });
}

/** The same list paged in SQL with `accessibleSql`: editable notes only (`minRole: 'editor'`). */
export async function pageEditableNotes(
  deps: { prisma: PrismaService; principalGroups: PrincipalGroupsProvider },
  principal: Principal,
  page: { limit: number; offset: number },
): Promise<ListedRecord[]> {
  const me = await deps.principalGroups.enrich(principal);
  return deps.prisma.runInOrg(me.activeOrgId!, (tx) => tx.$queryRaw<ListedRecord[]>`
    SELECT r.id::text, r.title FROM sharing_test_docs r
    WHERE ${accessibleSql(me, NOTE_TYPE, 'r', { sqlKit: Prisma, scope: 'all', minRole: 'editor' })}
    ORDER BY r.title LIMIT ${page.limit} OFFSET ${page.offset}`);
}

/**
 * MemoriaHub's circle-scoped list, without grants: albums owned by me or by a
 * group in which I hold at least `minGroupRole`.
 */
export async function listMyAlbums(
  deps: { prisma: PrismaService; principalGroups: PrincipalGroupsProvider; albums: (tx: Prisma.TransactionClient) => RecordDelegate },
  principal: Principal,
  minGroupRole?: 'admin' | 'editor' | 'viewer',
): Promise<ListedRecord[]> {
  const me = await deps.principalGroups.enrich(principal);
  const where = ownedByMeOrMyGroups(me, { ownerUserField: 'ownerUserId', ownerGroupField: 'ownerGroupId' }, minGroupRole ? { minGroupRole } : {});
  return deps.prisma.runInOrg(me.activeOrgId!, (tx) => deps.albums(tx).findMany({ where }));
}
