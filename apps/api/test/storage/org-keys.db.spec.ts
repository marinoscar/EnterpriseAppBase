// =============================================================================
// Real-Postgres test: org-aware object keys, and legacy keys still work
// (issue #736, PP-8.3)
// =============================================================================
//
// New uploads of the org-scoped `uploads` prefix get `uploads/<orgId>/…`;
// objects written before keep their stored `uploads/<timestamp>/…` key, and
// reads, downloads and deletes use the STORED key, never a rebuilt one. The
// real `ObjectsService` over `PrismaService` as an ordinary role, against a
// database that forces row-level security (`createRlsDatabase`).
// A `*.db.spec.ts` file: skipped with a warning when no Postgres is reachable.
// =============================================================================

import { Readable } from 'node:stream';

import type { JobsService } from '@marinoscar/platform-api/jobs';
import {
  ObjectsService,
  allKeyPrefixes,
  isRegisteredStorageKey,
  orgKeyPrefixes,
  type ObjectProcessingService,
} from '@marinoscar/platform-api/storage';

import { resolveDbSuite } from '../jobs/db-test-support';
import { createRlsDatabase, rlsServices, seedTwoOrgs, ORG_A, type RlsDatabase, type TwoOrgFixture } from '../helpers/rls-database.helper';

const { describeWithDb } = resolveDbSuite('org-keys.db.spec');

const LEGACY_KEY = 'uploads/1700000000000/0b0c0d0e-0000-4000-8000-000000000001.pdf';

describeWithDb('org-aware object keys (real Postgres)', () => {
  let db: RlsDatabase;
  let fx: TwoOrgFixture;
  let services: ReturnType<typeof rlsServices>;
  let objects: ObjectsService;
  let legacyId: string;
  const uploaded: string[] = [];
  const signed: string[] = [];
  const deleted: string[] = [];

  beforeAll(async () => {
    db = await createRlsDatabase('okey');
    fx = await seedTwoOrgs(db, 1);
    services = rlsServices(db);

    const storage = {
      kind: 's3',
      upload: async (key: string, stream: Readable) => {
        stream.resume();
        uploaded.push(key);
        return { bucket: 'test-bucket' };
      },
      getSignedDownloadUrl: async (key: string) => {
        signed.push(key);
        return `https://storage.test/${key}`;
      },
      delete: async (key: string) => void deleted.push(key),
    };
    const config = { get: (_key: string, fallback?: unknown) => fallback };
    const processing = { appliesTo: () => false } as unknown as ObjectProcessingService;

    objects = new ObjectsService(services.prisma as never, storage as never, config as never, processing, {} as JobsService);

    // A pre-#736 object: its key has no organization segment.
    const legacy = await db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return tx.storageObject.create({
        data: {
          orgId: ORG_A,
          name: 'legacy.pdf',
          size: BigInt(3),
          mimeType: 'application/pdf',
          storageKey: LEGACY_KEY,
          storageProvider: 's3',
          bucket: 'test-bucket',
          status: 'ready',
          uploadedById: fx.userA,
        },
      });
    });
    legacyId = legacy.id;
  }, 120_000);

  afterAll(async () => {
    await services?.close();
    await db?.destroy();
  }, 60_000);

  it('a new upload is stored under uploads/<orgId>/, the active organization', async () => {
    const created = await objects.simpleUpload(
      { filename: 'new.txt', mimetype: 'text/plain', file: Readable.from(['hello']) } as never,
      fx.userA,
      ORG_A,
    );

    const row = await db.admin((client) => client.query<{ storage_key: string; org_id: string }>('SELECT storage_key, org_id FROM storage_objects WHERE id = $1', [created.id]));
    expect(row.rows[0].org_id).toBe(ORG_A);
    expect(row.rows[0].storage_key).toMatch(new RegExp(`^uploads/${ORG_A}/\\d+/[0-9a-f-]+\\.txt$`));
    expect(uploaded).toContain(row.rows[0].storage_key);
    // Under the org's offboarding prefix, and under the root a full purge lists.
    expect(orgKeyPrefixes(ORG_A).some((prefix) => row.rows[0].storage_key.startsWith(prefix))).toBe(true);
    expect(isRegisteredStorageKey(row.rows[0].storage_key)).toBe(true);
  });

  it('a legacy uploads/<timestamp>/ object still downloads through its STORED key', async () => {
    const issued = await objects.getDownloadUrl(legacyId, fx.userA, ORG_A);

    expect(issued.url).toBe(`https://storage.test/${LEGACY_KEY}`);
    expect(signed).toEqual([LEGACY_KEY]);
    // The full purge still reaches it: same root prefix.
    expect(allKeyPrefixes().some((prefix) => LEGACY_KEY.startsWith(prefix))).toBe(true);
  });

  it('a legacy object deletes through its STORED key, and its row goes', async () => {
    await objects.delete(legacyId, fx.userA, ORG_A);

    expect(deleted).toEqual([LEGACY_KEY]);
    const row = await db.admin((client) => client.query('SELECT 1 FROM storage_objects WHERE id = $1', [legacyId]));
    expect(row.rowCount).toBe(0);
  });
});
