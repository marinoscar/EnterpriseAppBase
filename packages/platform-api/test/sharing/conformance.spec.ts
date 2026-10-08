// The sharing conformance suite (issue #732) finds what it promises to: each
// check passes a compliant fixture and fails a planted violation with a
// message that names the file or model and the fix.
import 'reflect-metadata';

import { Controller, Get, Module, SetMetadata, UseGuards } from '@nestjs/common';

import { withTemporaryEntries } from '../../src/core/index';
import {
  LinkGrantGuard,
  LinkGrantResource,
  SharingModule,
  groupOwnedResourceRegistry,
  resourceTypeRegistry,
  type ResourceTypeDef,
} from '../../src/sharing/index';
import {
  checkGroupOwnershipRegistered,
  checkLinkRoutesGuarded,
  checkNoDirectSharingAccess,
  checkResourceTypeIdsStable,
  checkSharingRawSqlIndexes,
  discoverSharingRoutes,
  sharingConformanceSuite,
} from '../../src/sharing/testing/index';
import { conformanceSuites, runPlatformConformance } from '../../src/testing/index';
import { emptySourceRoot, outcome, recordingTestApi, removeSourceRoots, writeSource } from '../support/conformance-harness';
import { testHost } from './fakes';

afterAll(removeSourceRoots);

const IS_PUBLIC = 'fixture:isPublic';
const Public = () => SetMetadata(IS_PUBLIC, true);
const isPublic = (target: object): boolean => Reflect.getMetadata(IS_PUBLIC, target) === true;

const album: ResourceTypeDef = {
  type: 'album',
  roles: ['viewer', 'editor'],
  actions: { read: 'viewer', write: 'editor' },
  ownership: 'group',
  grantable: { link: ['viewer'] },
  loadOwners: async () => new Map(),
  countOwnedByGroup: async () => 0,
};
const albumOwned = { type: 'album', countOwnedByGroup: async () => 0 };

const ALBUM_SCHEMA = `
model Album {
  id           String  @id @db.Uuid
  ownerUserId  String? @map("owner_user_id") @db.Uuid
  ownerGroupId String? @map("owner_group_id") @db.Uuid // the group owner
  @@map("albums")
}

model Plain {
  id String @id
  // ownerGroupId String @map("owner_group_id")  (commented out: not a column)
}
`;

const INDEX_SQL = `
CREATE UNIQUE INDEX "grants_active_user_uniq_idx" ON "grants" ("resource_type", "resource_id", "grantee_user_id") WHERE "revoked_at" IS NULL;
CREATE UNIQUE INDEX "grants_active_group_uniq_idx" ON "grants" ("resource_type", "resource_id", "grantee_group_id") WHERE "revoked_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS group_invites_pending_uniq_idx ON group_invites (group_id, email) WHERE accepted_at IS NULL;
`;

function schemaAt(text: string): string {
  const root = emptySourceRoot();
  writeSource(root, 'schema/app.prisma', text);
  return `${root}/schema`;
}

function migrationsAt(sql: string): string {
  const root = emptySourceRoot();
  writeSource(root, 'migrations/20261008000859_add_grants/migration.sql', sql);
  return `${root}/migrations`;
}

describe('sharing conformance suite', () => {
  it('registers itself with the harness on import', () => {
    expect(conformanceSuites.has('sharing')).toBe(true);
    expect(sharingConformanceSuite.id).toBe('sharing');
  });

  describe('1. no-direct-access', () => {
    it('passes services and accessibleSql, and ignores comments and prose', () => {
      const root = emptySourceRoot();
      writeSource(
        root,
        'notes/notes.service.ts',
        [
          '// prisma.grant.findMany() in a comment is not a use',
          "const label = 'remove them from groups';",
          'export const list = (tx, me) => tx.$queryRaw`SELECT n.id FROM notes n WHERE ${accessibleSql(me, "note", "n", { sqlKit })}`;',
          'export const notSql = `copy them into groups later`;',
          'export const share = (grants, me, input) => grants.create(me, input);',
        ].join('\n'),
      );
      expect(checkNoDirectSharingAccess([root])).toEqual({ findings: [], files: 1 });
    });

    it('fails a direct prisma.grant use and raw SQL on group_members, naming the file, the line and the fix', () => {
      const root = emptySourceRoot();
      writeSource(root, 'notes/notes.service.ts', 'export async function leak(prisma) {\n  return prisma.grant.findMany({ where: {} });\n}\n');
      writeSource(root, 'groups/report.ts', 'export const n = (tx) => tx.$queryRaw`SELECT count(*) FROM "group_members"`;\nexport const m = (tx) => tx.$executeRawUnsafe("DELETE FROM grants");\n');
      writeSource(root, 'notes/notes.service.spec.ts', 'prisma.grant.findMany();\n');
      const { findings, files } = checkNoDirectSharingAccess([root]);
      expect(files).toBe(2);
      expect(findings.map((f) => f.file).sort()).toEqual(['groups/report.ts', 'notes/notes.service.ts']);
      const grant = findings.find((f) => f.file === 'notes/notes.service.ts')!;
      expect(grant.message).toContain('line 2: `.grant.findMany()`');
      expect(grant.message).toContain('AccessPolicy');
      const raw = findings.find((f) => f.file === 'groups/report.ts')!.message;
      expect(raw).toContain('line 1: raw SQL on `group_members`');
      expect(raw).toContain('line 2: raw SQL on `grants`');
    });

    it('lets an exempt file through and flags a stale exemption', () => {
      const root = emptySourceRoot();
      writeSource(root, 'migrate/import.ts', 'await tx.groupMember.createMany({ data });\n');
      expect(checkNoDirectSharingAccess([root], { 'migrate/import.ts': 'one-off data migration' }).findings).toEqual([]);
      const stale = checkNoDirectSharingAccess([root], { 'migrate/import.ts': 'x', 'gone.ts': 'y' }).findings;
      expect(stale).toEqual([expect.objectContaining({ file: 'gone.ts', message: expect.stringContaining('stale') })]);
    });
  });

  describe('2. group-ownership-registered', () => {
    it('passes a mapped, registered owner_group_id model', () =>
      withTemporaryEntries(groupOwnedResourceRegistry, [albumOwned], () => {
        const result = checkGroupOwnershipRegistered(schemaAt(ALBUM_SCHEMA), { Album: 'album' });
        expect(result).toEqual({ findings: [], models: 2, withColumn: 1 });
      }));

    it('fails an unregistered owner_group_id model, naming the model and the fix', () => {
      const unmapped = checkGroupOwnershipRegistered(schemaAt(ALBUM_SCHEMA), {}, []);
      expect(unmapped.findings).toEqual([
        expect.objectContaining({ file: 'model Album', message: expect.stringContaining('registerGroupOwnedResource') }),
      ]);
      expect(unmapped.findings[0]!.message).toContain('orphan');
      const unregistered = checkGroupOwnershipRegistered(schemaAt(ALBUM_SCHEMA), { Album: 'album' }, []);
      expect(unregistered.findings[0]).toMatchObject({ file: 'model Album', message: expect.stringContaining('"album", which is not registered') });
    });

    it('flags stale map entries', () => {
      const { findings } = checkGroupOwnershipRegistered(schemaAt(ALBUM_SCHEMA), { Album: 'album', Plain: 'plain', Gone: 'gone' }, ['album']);
      expect(findings.map((f) => f.file)).toEqual(['model Plain', 'model Gone']);
    });
  });

  describe('3. link-routes-guarded', () => {
    @Controller('public/albums')
    @Public()
    @UseGuards(LinkGrantGuard)
    class GuardedAlbumsController {
      @Get()
      @LinkGrantResource('album', { action: 'read' })
      get(): void {}
    }

    @Controller('public/leaky')
    @Public()
    class UnguardedAlbumsController {
      @Get()
      @LinkGrantResource('album')
      get(): void {}
    }

    @Controller('public/undeclared')
    @UseGuards(LinkGrantGuard)
    class UndeclaredController {
      @Get()
      get(): void {}
    }

    it('passes a guarded, public link route and the slice own routes', () =>
      withTemporaryEntries(resourceTypeRegistry, [album], () => {
        @Module({ imports: [SharingModule.forRoot({ host: { ...testHost, access: { ...testHost.access, allowPublic: Public } } })], controllers: [GuardedAlbumsController] })
        class AppModule {}
        const routes = discoverSharingRoutes(AppModule, isPublic);
        expect(routes.length).toBeGreaterThan(20);
        expect(routes.filter((r) => r.linkGuarded).map((r) => r.id).sort()).toEqual(['GuardedAlbumsController#get', 'PublicLinksController#current']);
        expect(checkLinkRoutesGuarded(routes)).toEqual([]);
      }));

    it('fails a link route without the guard, and a guarded route without the declaration, naming the route and the fix', () =>
      withTemporaryEntries(resourceTypeRegistry, [album], () => {
        @Module({ controllers: [UnguardedAlbumsController, UndeclaredController] })
        class AppModule {}
        const findings = checkLinkRoutesGuarded(discoverSharingRoutes(AppModule, isPublic));
        expect(findings.map((f) => f.file)).toEqual(['UnguardedAlbumsController#get', 'UndeclaredController#get', 'UndeclaredController#get']);
        expect(findings[0]!.message).toContain('Add @UseGuards(LinkGrantGuard)');
        expect(findings[1]!.message).toContain('@LinkGrantResource(type');
        expect(findings[2]!.message).toContain("add the app's @Public()");
      }));

    it('fails a link route for a type that is unregistered or grants no link role', async () => {
      @Module({ controllers: [GuardedAlbumsController] })
      class AppModule {}
      expect(checkLinkRoutesGuarded(discoverSharingRoutes(AppModule))[0]!.message).toContain('not a registered resource type');
      await withTemporaryEntries(resourceTypeRegistry, [{ ...album, grantable: {} }], () => {
        expect(checkLinkRoutesGuarded(discoverSharingRoutes(AppModule))[0]!.message).toContain('grantable.link');
      });
    });
  });

  describe('4. raw-sql-indexes', () => {
    it('passes when the three indexes are in the migration SQL', () => {
      expect(checkSharingRawSqlIndexes(migrationsAt(INDEX_SQL))).toEqual({ findings: [], files: 1 });
    });

    it('fails a missing index, naming it and the fix', () => {
      const { findings } = checkSharingRawSqlIndexes(migrationsAt(INDEX_SQL.replace(/.*grants_active_group_uniq_idx.*\n/, '')));
      expect(findings).toEqual([expect.objectContaining({ file: 'index grants_active_group_uniq_idx', message: expect.stringContaining('npm run db:sync') })]);
      expect(findings[0]!.message).toContain('never replace it with @@unique');
    });
  });

  describe('5. resource-type-ids-stable', () => {
    it('passes a matching snapshot', () => {
      expect(checkResourceTypeIdsStable(['album'], ['album'])).toEqual([]);
    });

    it('fails a removed id as a breaking change, and an unsnapshotted one', () => {
      const findings = checkResourceTypeIdsStable(['album', 'transcript'], ['album', 'note']);
      expect(findings.map((f) => f.file)).toEqual(['resource type transcript', 'resource type note']);
      expect(findings[0]!.message).toContain('like a job type string');
      expect(findings[0]!.message).toContain('breaking change');
      expect(findings[1]!.message).toContain('add it to resourceTypeIds');
    });
  });

  it('runs as five cases through runPlatformConformance, each failing only on its own check', async () => {
    const root = emptySourceRoot();
    writeSource(root, 'leak.ts', 'export const leak = (prisma) => prisma.groupInvite.count();\n');
    @Module({ controllers: [UnguardedAlbumsControllerForRun] })
    class AppModule {}
    const { api, tests } = recordingTestApi();
    await withTemporaryEntries(groupOwnedResourceRegistry, [albumOwned], () => withTemporaryEntries(resourceTypeRegistry, [album], async () => {
      runPlatformConformance({
        sourceRoots: [root],
        suites: {
          sharing: {
            schemaPath: schemaAt(ALBUM_SCHEMA),
            migrationsDir: migrationsAt(INDEX_SQL),
            rootModule: AppModule,
            groupOwnedModels: { Album: 'album' },
            resourceTypeIds: ['album'],
          },
        },
        testApi: api,
      });
      const outcomes: Record<string, boolean> = {};
      for (const test of tests) outcomes[test.name.split(' > ')[1]!.split(':')[0]!] = (await outcome(test)) === null;
      expect(outcomes).toEqual({
        'no-direct-access': false,
        'group-ownership-registered': true,
        'link-routes-guarded': false,
        'raw-sql-indexes': true,
        'resource-type-ids-stable': true,
      });
    }));
  });
});

@Controller('public/run')
@UseGuards(LinkGrantGuard)
class UnguardedAlbumsControllerForRun {
  @Get()
  get(): void {}
}
