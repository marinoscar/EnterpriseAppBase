// =============================================================================
// Example: `AccessPolicy.require` and `decideMany` in a controller (issue #732)
// =============================================================================
//
// Extension point: `AccessPolicy` (rung 5: inject the slice's service).
//
// Every route that acts on ONE record asks `require(principal, action, ref)`
// first: it answers the record's decision, or throws the type's refusal (404
// for `denyAs: 'not_found'`, the same body as a missing record; 403 naming the
// permission when an `actionPermissions` entry is missing). A route that
// shows a PAGE of records the caller already has ids for (a "recent" strip, a
// search hit list) asks `decideMany` once: one owner query and one grant query
// for the whole batch, never one per row.
//
// The routes are the reference app's ordinary `@Auth()` routes: the slice
// decides the record, the app's RBAC decides the route. Mounted by
// ./user-owned-resource.example.db.spec.ts.
// =============================================================================

import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import type { Principal } from '@marinoscar/platform-api/core';
import { Auth, CurrentPrincipal } from '@marinoscar/platform-api/identity';
import { AccessPolicy, resourceKey } from '@marinoscar/platform-api/sharing';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../src/prisma/prisma.service';
import { NOTE_TYPE } from './user-owned-resource.example';

/** One note as the API returns it, with the caller's effective role. */
export interface NoteView {
  id: string;
  title: string;
  role: string | null;
}

@Controller('example/notes')
export class NotesController {
  constructor(
    @Inject(AccessPolicy) private readonly access: AccessPolicy,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /** `GET /example/notes/:id`: 404 unless the caller may read it. */
  @Get(':id')
  @Auth()
  async get(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<NoteView> {
    const decision = await this.access.require(principal, 'read', { type: NOTE_TYPE, id });
    const [note] = await this.prisma.runInOrg(principal.activeOrgId!, (tx) => this.titles(tx, [id]));
    return { id, title: note?.title ?? '', role: decision.role };
  }

  /** `PATCH /example/notes/:id`: editor or owner, AND the `notes:write` permission. */
  @Patch(':id')
  @Auth()
  async rename(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: { title: string }): Promise<NoteView> {
    const decision = await this.access.require(principal, 'write', { type: NOTE_TYPE, id });
    await this.prisma.runInOrg(principal.activeOrgId!, (tx) => tx.$executeRaw`UPDATE sharing_test_docs SET title = ${body.title} WHERE id = ${id}::uuid`);
    return { id, title: body.title, role: decision.role };
  }

  /** `GET /example/notes?ids=a,b,c`: the readable subset of a page of ids, in ONE batched decision. */
  @Get()
  @Auth()
  async page(@CurrentPrincipal() principal: Principal, @Query('ids') ids = ''): Promise<NoteView[]> {
    const refs = ids.split(',').filter(Boolean).map((id) => ({ type: NOTE_TYPE, id }));
    const decisions = await this.access.decideMany(principal, 'read', refs);
    const readable = refs.filter((ref) => decisions.get(resourceKey(ref))?.allowed);
    if (readable.length === 0) return [];
    const rows = await this.prisma.runInOrg(principal.activeOrgId!, (tx) => this.titles(tx, readable.map((ref) => ref.id)));
    return rows.map((row) => ({ id: row.id, title: row.title, role: decisions.get(resourceKey({ type: NOTE_TYPE, id: row.id }))!.role }));
  }

  private titles(tx: Prisma.TransactionClient, ids: readonly string[]): Promise<Array<{ id: string; title: string }>> {
    return tx.$queryRaw<Array<{ id: string; title: string }>>`
      SELECT id::text, title FROM sharing_test_docs WHERE id = ANY(${[...ids]}::uuid[]) ORDER BY title`;
  }
}
