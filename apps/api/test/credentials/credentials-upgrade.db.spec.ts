// =============================================================================
// Real Postgres: credentials stored before the move still decrypt (#735)
// =============================================================================
//
// The two ciphertexts below were produced by the PRE-MOVE code (origin/main's
// `encryptSecret` before PP-8.8: the app's `CredentialsService` encrypting
// under the bare purpose, and `UserCredentialsService` under
// `user:<userId>:<purpose>`), with the fixed test key below. They are seeded
// as raw rows, exactly as an existing deployment holds them, and read back
// through `@marinoscar/platform-api/credentials`. A change to the HKDF label
// (`SUBKEY_LABEL_PREFIX`, on the do-not-rename list), to a domain or to the
// payload layout fails here.
// A `*.db.spec.ts` file: skipped with a warning when no Postgres is reachable.
// =============================================================================

import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { CredentialsService, UserCredentialsService } from '@marinoscar/platform-api/credentials';

import { createDbClient, resolveDbSuite } from '../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('credentials-upgrade.db.spec');

/** `Buffer.alloc(32, 21).toString('base64')`: the key the fixtures were made with. */
const FIXTURE_KEY = 'FRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRU=';
/** `encryptSecret('pre-move-smtp-password-1234', 'smtp')`, pre-move. */
const SYSTEM_CIPHERTEXT = 'AhR5qZI2KLOjoQtMvKP/a24bgtPgOrZjk16QxyqIFUotogH66zOQbZ3qNLkiS3y/0mbdFGc4wA==';
/** The owner the user fixture was encrypted for. */
const FIXTURE_USER = '5c0ffee0-0000-4000-8000-0000000000a1';
/** `encryptSecret('pre-move-user-secret-5678', userCredentialPurpose(FIXTURE_USER, 'webhook'))`, pre-move. */
const USER_CIPHERTEXT = 'JuKW2xnoGisbFieMTcoPwpFnjzicKzpTxawxUO78Yo2QWXgdGd1a+f2bwDuWqd/xBFIdfEU=';

const ORIGINAL_KEY = process.env.SECRETS_ENCRYPTION_KEY;

describeWithDb('credentials written before the move (real Postgres)', () => {
  let client: PrismaClient;
  const name = `premove-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEY = FIXTURE_KEY;
    client = createDbClient();
    await client.user.deleteMany({ where: { id: FIXTURE_USER } });
    await client.user.create({ data: { id: FIXTURE_USER, email: `premove-${name}@example.com` } });
    await client.credential.create({ data: { purpose: 'smtp', name, secret: SYSTEM_CIPHERTEXT, hint: '••••1234' } });
    await client.userCredential.create({ data: { userId: FIXTURE_USER, purpose: 'webhook', name, secret: USER_CIPHERTEXT, hint: '••••5678' } });
  });

  afterAll(async () => {
    await client.credential.deleteMany({ where: { name } });
    await client.user.deleteMany({ where: { id: FIXTURE_USER } });
    await client.$disconnect();
    if (ORIGINAL_KEY === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  it('a deployment credential decrypts unchanged through the package', async () => {
    const service = new CredentialsService(client as never);
    await expect(service.getSecret('smtp', name)).resolves.toBe('pre-move-smtp-password-1234');
    await expect(service.describe('smtp', name)).resolves.toMatchObject({ purpose: 'smtp', name, hint: '••••1234' });
  });

  it("a user's credential decrypts unchanged through the package, on the user-scoped client", async () => {
    const service = new UserCredentialsService(client as never);
    await expect(service.getSecret(FIXTURE_USER, 'webhook', name)).resolves.toBe('pre-move-user-secret-5678');
    await expect(service.list(FIXTURE_USER)).resolves.toEqual([expect.objectContaining({ purpose: 'webhook', name, hint: '••••5678' })]);
  });
});
