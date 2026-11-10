// =============================================================================
// Real Postgres: the MemoriaHub-style examples, end to end (issue #732)
// =============================================================================
//
// Proves, over a database that enforces row-level security and the reference
// app's own sharing binding (./example-app.helper.ts):
//
//   ./group-owned-resource.example.ts      group ownership, `groupRoleMap`,
//                                          `bypassPermissions`, `grantable`
//   ./group-owned-count.example.ts         registerGroupOwnedResource: 409 while
//                                          a group owns rows
//   ./list-scope.example.ts                ownedByMeOrMyGroups (minGroupRole)
//   ./public-album.controller.example.ts   LinkGrantGuard, @LinkGrantResource,
//                                          @CurrentLinkGrant, withLinkScope over
//                                          HTTP: a presigned URL, never bytes
//   ./legacy-link-import.example.ts        importLegacyToken: old tokens resolve
// =============================================================================

import { randomBytes } from 'node:crypto';

// Must precede the first encrypt: the secret cipher caches its master key.
const ORIGINAL_KEY = process.env.SECRETS_ENCRYPTION_KEY;
process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

import type { Principal } from '@marinoscar/platform-api/core';

import { resolveDbSuite } from '../../jobs/db-test-support';
import { createRlsDatabase, ORG_A, ORG_B, type RlsDatabase } from '../../helpers/rls-database.helper';
import { principalOf, seedOrgs, seedUser } from '../../sharing/sharing-db.helper';
import { bootExampleApp, type ExampleApp } from './example-app.helper';
import { createAlbumsTable, createNotesTable, exampleDelegate, insertAlbum, insertNote } from './example-tables.helper';
import { GROUP_NOTE_TYPE, registerGroupNotes } from './group-owned-count.example';
import { ALBUMS_READ_ANY_PERMISSION, ALBUM_TYPE, registerAlbumResourceType } from './group-owned-resource.example';
import { importAlbumShares } from './legacy-link-import.example';
import { listMyAlbums } from './list-scope.example';
import { ALBUM_MEDIA_URLS, PublicAlbumController, PUBLIC_COVER_URL_TTL_SECONDS, type AlbumMediaUrls } from './public-album.controller.example';

const { describeWithDb } = resolveDbSuite('group-owned-resource.example.db.spec');

// Registered at import time, like the app's registrations.
registerAlbumResourceType();
registerGroupNotes();

/** The storage provider's presigned GET, faked: the URL names the key and its lifetime, and carries no link token. */
const presigned: Array<{ key: string; ttlSeconds: number }> = [];
const mediaUrls: AlbumMediaUrls = {
  presignedGetUrl: async (key, ttlSeconds) => {
    presigned.push({ key, ttlSeconds });
    return `https://storage.example.test/${key}?X-Amz-Expires=${ttlSeconds}&X-Amz-Signature=fake`;
  },
};

async function refusal(promise: Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await promise;
  } catch (error) {
    const http = error as { getStatus(): number; getResponse(): unknown };
    return { status: http.getStatus(), body: http.getResponse() };
  }
  throw new Error('expected a refusal');
}

describeWithDb('sharing examples: a group-owned resource type (real Postgres)', () => {
  let db: RlsDatabase;
  let ex: ExampleApp;
  const u = { alice: '', bob: '', carol: '', erin: '', dave: '' };
  const g = { family: '', club: '', foreign: '' };
  const albums: Record<string, string> = {};

  const as = (name: keyof typeof u, extra: string[] = []): Principal => {
    const base = principalOf(u[name], `${name}@example.test`, name === 'dave' ? ORG_B : ORG_A, 'contributor');
    return { ...base, permissions: [...base.permissions, ...extra] };
  };
  const album = (key: string) => ({ type: ALBUM_TYPE, id: albums[key]! });
  const albumsDeps = () => ({ prisma: ex.prisma, principalGroups: ex.principalGroups, albums: (tx: unknown) => exampleDelegate(tx, 'sharing_test_albums') });
  const open = (token: string) => ex.http().get('/public/albums/current').set('X-Link-Token', token);

  beforeAll(async () => {
    db = await createRlsDatabase('ex_albums');
    await seedOrgs(db, [
      [ORG_A, 'org-a'],
      [ORG_B, 'org-b'],
    ]);
    for (const name of ['alice', 'bob', 'carol', 'erin'] as const) u[name] = await seedUser(db, `${name}@example.test`, [ORG_A]);
    u.dave = await seedUser(db, 'dave@example.test', [ORG_B]);
    await createNotesTable(db);
    await createAlbumsTable(db);
    ex = await bootExampleApp(db, { controllers: [PublicAlbumController], providers: [{ provide: ALBUM_MEDIA_URLS, useValue: mediaUrls }] });

    // MemoriaHub's circle: Alice is its circle_admin (admin), Bob a collaborator (editor), Carol a viewer.
    g.family = (await ex.groups.create(as('alice'), { name: 'family' })).id;
    await ex.members.add(as('alice'), g.family, { userId: u.bob, role: 'editor' });
    await ex.members.add(as('alice'), g.family, { userId: u.carol, role: 'viewer' });
    g.club = (await ex.groups.create(as('erin'), { name: 'book club' })).id;
    g.foreign = (await ex.groups.create(as('dave'), { name: 'foreign' })).id;

    albums.summer = await insertAlbum(db, { orgId: ORG_A, ownerGroupId: g.family, title: 'summer', coverKey: 'covers/summer.jpg' });
    albums.winter = await insertAlbum(db, { orgId: ORG_A, ownerGroupId: g.family, title: 'winter' });
    albums.foreign = await insertAlbum(db, { orgId: ORG_B, ownerGroupId: g.foreign, title: 'foreign' });
  }, 240_000);

  afterAll(async () => {
    await ex?.close();
    await db?.destroy();
    if (ORIGINAL_KEY === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = ORIGINAL_KEY;
  }, 60_000);

  describe('group ownership and groupRoleMap (group-owned-resource.example.ts)', () => {
    it("gives each member the role its group role maps to, and outsiders nothing", async () => {
      expect(await ex.access.roleFor(as('alice'), album('summer'))).toBe('owner');
      expect(await ex.access.roleFor(as('bob'), album('summer'))).toBe('editor');
      expect(await ex.access.roleFor(as('carol'), album('summer'))).toBe('viewer');
      expect(await ex.access.roleFor(as('erin'), album('summer'))).toBeNull();
      expect(await ex.access.decide(as('bob'), 'write', album('summer'))).toEqual({ allowed: true, role: 'editor', via: 'group_owner' });
      expect(await ex.access.can(as('carol'), 'write', album('summer'))).toBe(false);
      expect(await ex.access.can(as('dave'), 'read', album('summer'))).toBe(false);
    });

    it('lets the bypass permission read any album of the organization, and nothing more', async () => {
      const moderator = as('erin', [ALBUMS_READ_ANY_PERMISSION]);
      expect(await ex.access.decide(moderator, 'read', album('winter'))).toMatchObject({ allowed: true, via: 'bypass' });
      expect(await ex.access.can(moderator, 'write', album('winter'))).toBe(false);
      expect(await ex.access.can(as('dave', [ALBUMS_READ_ANY_PERMISSION]), 'read', album('summer'))).toBe(false);
    });

    it('grants only the roles `grantable` lists for each grantee kind', async () => {
      const editor = await refusal(ex.grants.create(as('alice'), { resourceType: ALBUM_TYPE, resourceId: albums.winter!, role: 'editor', grantee: { kind: 'user', userId: u.erin } }));
      expect(editor).toMatchObject({ status: 422, body: { details: { reason: 'ROLE_NOT_GRANTABLE' } } });
      await ex.grants.create(as('alice'), { resourceType: ALBUM_TYPE, resourceId: albums.winter!, role: 'viewer', grantee: { kind: 'user', userId: u.erin } });
      expect(await ex.access.decide(as('erin'), 'read', album('winter'))).toEqual({ allowed: true, role: 'viewer', via: 'user_grant' });
      // `share` is the owners' (the group admins'): a collaborator may not grant people.
      expect(await refusal(ex.grants.create(as('bob'), { resourceType: ALBUM_TYPE, resourceId: albums.winter!, role: 'viewer', grantee: { kind: 'user', userId: u.carol } }))).toMatchObject({ status: 404 });
    });
  });

  describe('ownedByMeOrMyGroups (list-scope.example.ts)', () => {
    const titles = (rows: Array<{ title: string }>) => rows.map((row) => row.title).sort();

    it("lists the albums of the caller's groups, optionally from a minimum group role", async () => {
      expect(titles(await listMyAlbums(albumsDeps(), as('carol')))).toEqual(['summer', 'winter']);
      expect(await listMyAlbums(albumsDeps(), as('carol'), 'editor')).toEqual([]);
      expect(titles(await listMyAlbums(albumsDeps(), as('bob'), 'editor'))).toEqual(['summer', 'winter']);
      // A grant is not ownership: Erin's viewer grant on "winter" does not list it here.
      expect(await listMyAlbums(albumsDeps(), as('erin'))).toEqual([]);
      expect(titles(await listMyAlbums(albumsDeps(), as('dave')))).toEqual(['foreign']);
    });
  });

  describe('a public route behind LinkGrantGuard (public-album.controller.example.ts)', () => {
    it('serves the album a link opens, with a presigned cover URL and never the bytes', async () => {
      // `share_link` is `editor`: a collaborator may mint a link.
      const issued = await ex.links.create(as('bob'), { resourceType: ALBUM_TYPE, resourceId: albums.summer! });
      expect(issued.url).toBe(`https://app.example.test/s#${issued.token}`);
      presigned.length = 0;
      const res = await open(issued.token).expect(200);
      expect(res.body).toEqual({
        id: albums.summer,
        title: 'summer',
        role: 'viewer',
        expiresAt: issued.grant.expiresAt,
        coverUrl: `https://storage.example.test/covers/summer.jpg?X-Amz-Expires=${PUBLIC_COVER_URL_TTL_SECONDS}&X-Amz-Signature=fake`,
      });
      expect(presigned).toEqual([{ key: 'covers/summer.jpg', ttlSeconds: PUBLIC_COVER_URL_TTL_SECONDS }]);
      expect(res.body.coverUrl).not.toContain(issued.token);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
    });

    it('answers unknown, revoked and query-string tokens with the identical 404; a viewer cannot mint', async () => {
      const unknown = await open(`lnk_${randomBytes(32).toString('base64url')}`).expect(404);
      const revoked = await ex.links.create(as('alice'), { resourceType: ALBUM_TYPE, resourceId: albums.winter! });
      await ex.grants.revoke(as('alice'), revoked.grant.id);
      expect((await open(revoked.token).expect(404)).body).toEqual(unknown.body);
      const inQuery = await ex.http().get('/public/albums/current').query({ token: revoked.token }).expect(404);
      expect(inQuery.body).toEqual(unknown.body);
      expect(await refusal(ex.links.create(as('carol'), { resourceType: ALBUM_TYPE, resourceId: albums.summer! }))).toMatchObject({ status: 404 });
    });
  });

  describe('importLegacyToken (legacy-link-import.example.ts)', () => {
    it('imports old share tokens as link grants that resolve as lnk_<old token>', async () => {
      const live = randomBytes(32).toString('base64url');
      const gone = randomBytes(32).toString('base64url');
      const tokens = await importAlbumShares(ex.system, [
        { orgId: ORG_A, albumId: albums.winter!, token: live, createdById: u.alice, createdAt: new Date('2025-01-02T03:04:05Z'), expiresAt: null, revokedAt: null },
        { orgId: ORG_A, albumId: albums.summer!, token: gone, createdById: u.alice, createdAt: new Date('2025-01-02T03:04:05Z'), expiresAt: null, revokedAt: new Date('2025-02-01T00:00:00Z') },
      ]);
      expect(tokens.get(live)).toBe(`lnk_${live}`);
      await open(`lnk_${live}`).expect(200).expect((res) => expect(res.body).toMatchObject({ id: albums.winter, title: 'winter', role: 'viewer' }));
      await open(`lnk_${gone}`).expect(404);
      // The sharer sees it like any link, with its old creation date.
      const listed = await ex.links.list(as('alice'), { resourceType: ALBUM_TYPE, resourceId: albums.winter!, page: 1, pageSize: 20 });
      expect(listed.items.find((link) => link.url?.endsWith(`#lnk_${live}`))).toMatchObject({ createdAt: '2025-01-02T03:04:05.000Z' });
    });
  });

  describe('registerGroupOwnedResource (group-owned-count.example.ts)', () => {
    it('refuses to delete a group while it owns rows, with the counts per type', async () => {
      const note = await insertNote(db, { orgId: ORG_A, ownerGroupId: g.club, title: 'reading list' });
      expect(await refusal(ex.groups.delete(as('erin'), g.club))).toMatchObject({
        status: 409,
        body: { details: { reason: 'GROUP_OWNS_RESOURCES', counts: { [GROUP_NOTE_TYPE]: 1 } } },
      });
      // The album type registered itself as group-owned too.
      expect(await refusal(ex.groups.delete(as('alice'), g.family))).toMatchObject({ status: 409, body: { details: { counts: { [ALBUM_TYPE]: 2 } } } });

      await db.system.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
        await tx.$executeRaw`DELETE FROM sharing_test_docs WHERE id = ${note}::uuid`;
      });
      await ex.groups.delete(as('erin'), g.club);
    });
  });
});
