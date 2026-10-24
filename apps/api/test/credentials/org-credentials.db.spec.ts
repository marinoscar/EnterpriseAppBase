// =============================================================================
// Real Postgres: org_credentials (issue #735, PP-8.8)
// =============================================================================
//
// The REAL `OrgCredentialsService` over a database owned by an ordinary role
// that FORCEs row-level security (`createRlsDatabase`), so the policy is live:
// what only a real server can prove is that the composite unique
// (org_id, purpose, name) is a real constraint, that rows cascade with their
// organization (and only theirs), that one organization never sees or writes
// another's rows, and that a ciphertext moved between organizations by a raw
// SQL write fails to decrypt.
// A `*.db.spec.ts` file: skipped with a warning when no Postgres is reachable.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrgCredentialsService, credentialPurposeRegistry, registerCredentialPurpose } from '@marinoscar/platform-api/credentials';

import { PARTNER_API_CREDENTIAL_PURPOSE } from '../../src/platform-extensions/credentials/examples/partner-api-token.purpose';
import { createRlsDatabase, ORG_A, ORG_B, type RlsDatabase } from '../helpers/rls-database.helper';
import { resolveDbSuite } from '../jobs/db-test-support';
import { seedOrgs, seedUser } from '../sharing/sharing-db.helper';

const { describeWithDb } = resolveDbSuite('org-credentials.db.spec');

const ORIGINAL_KEY = process.env.SECRETS_ENCRYPTION_KEY;
const PURPOSE = PARTNER_API_CREDENTIAL_PURPOSE.purpose;

describeWithDb('org_credentials (real Postgres, ordinary role, row-level security)', () => {
  let db: RlsDatabase;
  let service: OrgCredentialsService;
  let admin: string;

  /** Runs `fn` on the system pool with the bypass flag, as a migration or the purge would. */
  const asSystem = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
    db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return fn(tx);
    });

  beforeAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString('base64');
    if (!credentialPurposeRegistry.has(PURPOSE)) registerCredentialPurpose(PARTNER_API_CREDENTIAL_PURPOSE);
    db = await createRlsDatabase('orgcred');
    await seedOrgs(db, [[ORG_A, 'org-a'], [ORG_B, 'org-b']]);
    admin = await seedUser(db, `admin-${randomUUID().slice(0, 8)}@example.test`, [ORG_A]);
    service = new OrgCredentialsService(db.tenant as never);
  }, 180_000);

  afterAll(async () => {
    await db?.destroy();
    if (ORIGINAL_KEY === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = ORIGINAL_KEY;
  }, 60_000);

  it('forces row-level security on org_credentials, with its isolation policy, for an ordinary role', async () => {
    const rel = await db.admin((c) =>
      c.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'org_credentials'"),
    );
    expect(rel.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const policies = await db.admin((c) => c.query("SELECT policyname FROM pg_policies WHERE tablename = 'org_credentials'"));
    expect(policies.rows).toEqual([{ policyname: 'org_credentials_org_isolation' }]);
    const role = await db.admin((c) => c.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1', [db.role]));
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('stores, describes, lists and deletes in one organization, storing ciphertext only', async () => {
    const info = await service.setSecret(ORG_A, PURPOSE, 'default', 'acme-partner-token-4321', { label: 'Partner', updatedByUserId: admin });
    expect(info).toMatchObject({ purpose: PURPOSE, name: 'default', hint: '••••4321', label: 'Partner', updatedByUserId: admin });

    const raw = await asSystem((tx) => tx.orgCredential.findUniqueOrThrow({ where: { orgId_purpose_name: { orgId: ORG_A, purpose: PURPOSE, name: 'default' } } }));
    expect(raw.secret).not.toContain('acme-partner-token-4321');

    await expect(service.getSecret(ORG_A, PURPOSE, 'default')).resolves.toBe('acme-partner-token-4321');
    await expect(service.describe(ORG_A, PURPOSE, 'default')).resolves.toMatchObject({ label: 'Partner' });
    await service.setSecret(ORG_A, PURPOSE, 'secondary', 'acme-second-token-0000');
    await expect(service.list(ORG_A, PURPOSE)).resolves.toEqual([
      expect.objectContaining({ name: 'default' }),
      expect.objectContaining({ name: 'secondary' }),
    ]);

    await service.deleteSecret(ORG_A, PURPOSE, 'secondary');
    await expect(service.describe(ORG_A, PURPOSE, 'secondary')).resolves.toBeNull();
  });

  it("isolates organizations: B sees none of A's rows, and an unscoped client sees nothing at all", async () => {
    await service.setSecret(ORG_A, PURPOSE, 'isolated', 'only-for-org-a-1234');
    await expect(service.getSecret(ORG_B, PURPOSE, 'isolated')).resolves.toBeNull();
    await expect(service.list(ORG_B)).resolves.toEqual([]);
    await expect(db.tenant.orgCredential.count()).resolves.toBe(0);
  });

  it("refuses, in the database, a row for another organization written inside one organization's scope", async () => {
    const write = db.tenant.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${ORG_A}, true)`;
      return tx.orgCredential.create({ data: { orgId: ORG_B, purpose: PURPOSE, name: 'smuggled', secret: 'x' } });
    });
    await expect(write).rejects.toThrow(/row-level security/);
  });

  it('enforces (org_id, purpose, name) uniqueness, and allows the same address in two organizations', async () => {
    const row = { orgId: ORG_B, purpose: PURPOSE, name: 'unique', secret: 'x' };
    await asSystem((tx) => tx.orgCredential.create({ data: row }));
    const error = await asSystem((tx) => tx.orgCredential.create({ data: row })).catch((e) => e);
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
    await expect(asSystem((tx) => tx.orgCredential.create({ data: { ...row, orgId: ORG_A } }))).resolves.toBeTruthy();
  });

  it("rejects A's ciphertext copied into B's row by a raw SQL write", async () => {
    await service.setSecret(ORG_A, PURPOSE, 'copied', 'org-a-copied-secret');
    await service.setSecret(ORG_B, PURPOSE, 'copied', 'org-b-copied-secret');
    await db.admin((c) =>
      c.query(
        `UPDATE org_credentials SET secret = (SELECT secret FROM org_credentials WHERE org_id = $1 AND purpose = $3 AND name = 'copied')
          WHERE org_id = $2 AND purpose = $3 AND name = 'copied'`,
        [ORG_A, ORG_B, PURPOSE],
      ),
    );
    await expect(service.getSecret(ORG_B, PURPOSE, 'copied')).rejects.toThrow(InternalServerErrorException);
    await expect(service.getSecret(ORG_A, PURPOSE, 'copied')).resolves.toBe('org-a-copied-secret');
  });

  it("detaches the last editor when that user is deleted (SetNull)", async () => {
    const editor = await seedUser(db, `editor-${randomUUID().slice(0, 8)}@example.test`, [ORG_A]);
    await service.setSecret(ORG_A, PURPOSE, 'edited', 'edited-secret-5678', { updatedByUserId: editor });
    await asSystem((tx) => tx.user.delete({ where: { id: editor } }));
    await expect(service.describe(ORG_A, PURPOSE, 'edited')).resolves.toMatchObject({ updatedByUserId: null, hint: '••••5678' });
  });

  it('cascades with the organization, and only that organization', async () => {
    const doomed = randomUUID();
    await seedOrgs(db, [[doomed, `doomed-${doomed.slice(0, 8)}`]]);
    await service.setSecret(doomed, PURPOSE, 'default', 'doomed-secret-1111');
    await service.setSecret(ORG_A, PURPOSE, 'survivor', 'survivor-secret-2222');

    await asSystem((tx) => tx.organization.delete({ where: { id: doomed } }));

    await expect(asSystem((tx) => tx.orgCredential.count({ where: { orgId: doomed } }))).resolves.toBe(0);
    await expect(service.getSecret(ORG_A, PURPOSE, 'survivor')).resolves.toBe('survivor-secret-2222');
  });
});
