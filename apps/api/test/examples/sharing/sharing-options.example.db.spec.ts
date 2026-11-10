// =============================================================================
// Real Postgres: the forRoot options of ./sharing-options.example.ts take
// effect (issue #732)
// =============================================================================
//
// Boots the slice with the photo app's options (the reference app's binding
// otherwise, ./example-app.helper.ts) and proves each override where it acts:
// an invite's expiry, a link's default and capped expiry, the group size cap
// and the prune job's retention window.
// =============================================================================

// Must precede the first encrypt: the secret cipher caches its master key.
const ORIGINAL_KEY = process.env.SECRETS_ENCRYPTION_KEY;
process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

import type { Principal } from '@marinoscar/platform-api/core';
import { SHARING_OPTIONS, type ResolvedSharingModuleOptions } from '@marinoscar/platform-api/sharing';

import { resolveDbSuite } from '../../jobs/db-test-support';
import { createRlsDatabase, ORG_A, type RlsDatabase } from '../../helpers/rls-database.helper';
import { principalOf, seedOrgs, seedUser } from '../../sharing/sharing-db.helper';
import { asSystem } from '../../sharing/sharing-test-docs.helper';
import { bootExampleApp, type ExampleApp } from './example-app.helper';
import { createAlbumsTable, createNotesTable, insertAlbum } from './example-tables.helper';
import { ALBUM_TYPE, registerAlbumResourceType } from './group-owned-resource.example';
import { photoAppSharingModule, photoAppSharingOptions } from './sharing-options.example';

const { describeWithDb } = resolveDbSuite('sharing-options.example.db.spec');
const DAY = 86_400_000;

registerAlbumResourceType();

describe('the photo app sharing module (sharing-options.example.ts)', () => {
  it('is a SharingModule with the overrides merged over the defaults, frozen', () => {
    const options = photoAppSharingModule.providers!.find((p) => (p as { provide?: unknown }).provide === SHARING_OPTIONS) as { useValue: ResolvedSharingModuleOptions };
    expect(options.useValue.groups).toMatchObject({ inviteTtlDays: 7, maxMembersPerGroup: 50, maxGroupsPerCreator: 100 });
    expect(options.useValue.links).toMatchObject({ defaultTtlDays: 7, maxTtlDays: 30, maxActivePerResource: 20 });
    expect(options.useValue.grants).toEqual({ retentionDays: 30 });
    expect(Object.isFrozen(options.useValue.groups)).toBe(true);
  });
});

describeWithDb('sharing options take effect (real Postgres)', () => {
  let db: RlsDatabase;
  let ex: ExampleApp;
  const u = { alice: '', bob: '' };
  let family = '';
  let album = '';
  const as = (name: keyof typeof u): Principal => principalOf(u[name], `${name}@example.test`, ORG_A, 'contributor');
  const near = (actual: string | Date | null, expectedMs: number) => expect(Math.abs(new Date(actual!).getTime() - expectedMs)).toBeLessThan(60_000);

  beforeAll(async () => {
    db = await createRlsDatabase('ex_options');
    await seedOrgs(db, [[ORG_A, 'org-a']]);
    u.alice = await seedUser(db, 'alice@example.test', [ORG_A]);
    u.bob = await seedUser(db, 'bob@example.test', [ORG_A]);
    await createNotesTable(db);
    await createAlbumsTable(db);
    ex = await bootExampleApp(db, { sharing: photoAppSharingOptions });
    family = (await ex.groups.create(as('alice'), { name: 'family' })).id;
    album = await insertAlbum(db, { orgId: ORG_A, ownerGroupId: family, title: 'summer' });
  }, 240_000);

  afterAll(async () => {
    await ex?.close();
    await db?.destroy();
    if (ORIGINAL_KEY === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = ORIGINAL_KEY;
  }, 60_000);

  it('groups.inviteTtlDays: an invite expires after 7 days', async () => {
    const invite = await ex.invites.create(as('alice'), family, { email: 'grandma@example.test', role: 'viewer' });
    near(invite.expiresAt, Date.now() + 7 * DAY);
  });

  it('links.defaultTtlDays and links.maxTtlDays: 7 days by default, never beyond 30', async () => {
    const byDefault = await ex.links.create(as('alice'), { resourceType: ALBUM_TYPE, resourceId: album });
    near(byDefault.grant.expiresAt, Date.now() + 7 * DAY);
    const tooLong = await ex.links.create(as('alice'), { resourceType: ALBUM_TYPE, resourceId: album, expiresAt: new Date(Date.now() + 90 * DAY).toISOString() });
    near(tooLong.grant.expiresAt, Date.now() + 30 * DAY);
  });

  it('grants.retentionDays: the prune job deletes grants revoked more than 30 days ago, and keeps newer ones', async () => {
    const old = await ex.grants.create(as('alice'), { resourceType: ALBUM_TYPE, resourceId: album, role: 'viewer', grantee: { kind: 'user', userId: u.bob } });
    await ex.grants.revoke(as('alice'), old.id);
    const recent = await ex.links.create(as('alice'), { resourceType: ALBUM_TYPE, resourceId: album });
    await ex.grants.revoke(as('alice'), recent.grant.id);
    await asSystem(db, async (tx) => {
      await tx.$executeRaw`UPDATE grants SET revoked_at = now() - interval '31 days' WHERE id = ${old.id}::uuid`;
      await tx.$executeRaw`UPDATE grants SET revoked_at = now() - interval '29 days' WHERE id = ${recent.grant.id}::uuid`;
    });
    await ex.prune.prune();
    const left = await asSystem(db, (tx) => tx.$queryRaw<Array<{ id: string }>>`SELECT id::text FROM grants WHERE id IN (${old.id}::uuid, ${recent.grant.id}::uuid)`);
    expect(left.map((row) => row.id)).toEqual([recent.grant.id]);
  });
});
