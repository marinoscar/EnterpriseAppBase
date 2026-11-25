import { BadRequestException, InternalServerErrorException } from '@nestjs/common';

import { encryptSecret, orgCredentialPurpose } from '../../src/core/index';
import { OrgCredentialsService } from '../../src/credentials/org-credentials.service';
import { createMockCredentialsPrisma, type MockCredentialsPrisma } from './fakes';
import './purposes';

// =============================================================================
// OrgCredentialsService — tests (issue #735)
// =============================================================================
//
// Prisma is a structural stand-in backed by an in-memory Map keyed by
// (orgId, purpose, name), so "write then read" means something; the REAL
// cipher is used, so org isolation is an assertion about actual ciphertext.
// Row-level security itself is proven by the reference app's
// org-credentials.db.spec.ts.
// =============================================================================

const ORIGINAL_KEY = process.env.SECRETS_ENCRYPTION_KEY;
process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString('base64');
afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = ORIGINAL_KEY;
});

const KAPPA = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const SIGMA = 'a1b2c3d4-e5f6-4789-9abc-def012345678';
const ADMIN = '0b6f1d7e-3c2a-4f5b-9e8d-7a6c5b4d3e2f';

interface Row {
  id: string;
  orgId: string;
  purpose: string;
  name: string;
  secret: string;
  hint: string | null;
  label: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const key = (orgId: string, purpose: string, name: string) => `${orgId}::${purpose}::${name}`;

function project(row: Row, select?: Record<string, boolean>): Record<string, unknown> {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, (row as unknown as Record<string, unknown>)[k]]));
}

describe('OrgCredentialsService', () => {
  let prisma: MockCredentialsPrisma;
  let store: Map<string, Row>;
  let service: OrgCredentialsService;

  beforeEach(() => {
    prisma = createMockCredentialsPrisma();
    store = new Map();
    let next = 1;
    const model = prisma.orgCredential;
    model.findUnique.mockImplementation(async (args: any) => {
      const { orgId, purpose, name } = args.where.orgId_purpose_name;
      const row = store.get(key(orgId, purpose, name));
      return row ? project(row, args.select) : null;
    });
    model.findMany.mockImplementation(async (args: any) =>
      [...store.values()]
        .filter((r) => r.orgId === args.where.orgId && (args.where.purpose === undefined || r.purpose === args.where.purpose))
        .sort((a, b) => a.purpose.localeCompare(b.purpose) || a.name.localeCompare(b.name))
        .map((r) => project(r, args.select)),
    );
    model.upsert.mockImplementation(async (args: any) => {
      const { orgId, purpose, name } = args.where.orgId_purpose_name;
      const k = key(orgId, purpose, name);
      const existing = store.get(k);
      const now = new Date();
      const row: Row = existing
        ? { ...existing, ...args.update, updatedAt: new Date(existing.updatedAt.getTime() + 1) }
        : { id: `oc-${next++}`, ...args.create, createdAt: now, updatedAt: now };
      store.set(k, row);
      return project(row, args.select);
    });
    model.update.mockImplementation(async (args: any) => {
      const { orgId, purpose, name } = args.where.orgId_purpose_name;
      const k = key(orgId, purpose, name);
      const row = { ...(store.get(k) as Row), ...args.data };
      store.set(k, row);
      return project(row, args.select);
    });
    model.deleteMany.mockImplementation(async (args: any) => {
      const k = key(args.where.orgId, args.where.purpose, args.where.name);
      return { count: store.delete(k) ? 1 : 0 };
    });
    service = new OrgCredentialsService(prisma as never);
  });

  it('stores ciphertext under the org-bound domain and reads back plaintext', async () => {
    const info = await service.setSecret(KAPPA, 'partner_api', 'default', 'kappa-partner-token-9876', {
      label: 'Partner token',
      updatedByUserId: ADMIN,
    });

    const row = store.get(key(KAPPA, 'partner_api', 'default')) as Row;
    expect(row.secret).not.toContain('kappa-partner-token-9876');
    expect(row.hint).toBe('••••9876');
    expect(info).toEqual({
      purpose: 'partner_api',
      name: 'default',
      hint: '••••9876',
      label: 'Partner token',
      updatedByUserId: ADMIN,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    await expect(service.getSecret(KAPPA, 'partner_api')).resolves.toBe('kappa-partner-token-9876');
  });

  it('runs every query on the org-scoped client (forOrg extends the port)', async () => {
    await service.describe(KAPPA, 'partner_api', 'default');
    expect(prisma.$extends).toHaveBeenCalled();
  });

  it("refuses to decrypt another organization's ciphertext copied into this row", async () => {
    await service.setSecret(SIGMA, 'partner_api', 'default', 'sigma-token-0000');
    const stolen = (store.get(key(SIGMA, 'partner_api', 'default')) as Row).secret;
    await service.setSecret(KAPPA, 'partner_api', 'default', 'kappa-token-1111');
    (store.get(key(KAPPA, 'partner_api', 'default')) as Row).secret = stolen;

    await expect(service.getSecret(KAPPA, 'partner_api', 'default')).rejects.toThrow(InternalServerErrorException);
  });

  it('decrypts a row written directly under orgCredentialPurpose (the domain is the contract)', async () => {
    store.set(key(KAPPA, 'partner_api', 'default'), {
      id: 'x',
      orgId: KAPPA,
      purpose: 'partner_api',
      name: 'default',
      secret: encryptSecret('direct', orgCredentialPurpose(KAPPA, 'partner_api')),
      hint: null,
      label: null,
      updatedByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(service.getSecret(KAPPA, 'partner_api', 'default')).resolves.toBe('direct');
  });

  it('describes and lists without the secret, ordered by purpose then name', async () => {
    await service.setSecret(KAPPA, 'partner_api', 'b', 'secret-bbbbbbbb');
    await service.setSecret(KAPPA, 'partner_api', 'a', 'secret-aaaaaaaa');
    await service.setSecret(KAPPA, 'org_only', 'default', 'secret-oooooooo');
    await service.setSecret(SIGMA, 'partner_api', 'a', 'secret-gggggggg');

    const list = await service.list(KAPPA);
    expect(list.map((i) => `${i.purpose}/${i.name}`)).toEqual(['org_only/default', 'partner_api/a', 'partner_api/b']);
    for (const info of list) expect(Object.keys(info)).not.toContain('secret');
    await expect(service.list(KAPPA, 'partner_api')).resolves.toHaveLength(2);
    await expect(service.describe(KAPPA, 'partner_api', 'missing')).resolves.toBeNull();
  });

  it('blank preserves the secret and applies metadata; blank with nothing stored is a 400', async () => {
    await service.setSecret(KAPPA, 'partner_api', 'default', 'keep-me-12345678');
    const before = (store.get(key(KAPPA, 'partner_api', 'default')) as Row).secret;

    const info = await service.setSecret(KAPPA, 'partner_api', 'default', '', { label: 'Renamed' });
    expect(info.label).toBe('Renamed');
    expect((store.get(key(KAPPA, 'partner_api', 'default')) as Row).secret).toBe(before);

    await expect(service.setSecret(KAPPA, 'partner_api', 'default', undefined)).resolves.toMatchObject({ label: 'Renamed' });
    await expect(service.setSecret(KAPPA, 'partner_api', 'new', null)).rejects.toThrow(BadRequestException);
  });

  it('deletes idempotently', async () => {
    await service.setSecret(KAPPA, 'partner_api', 'default', 'delete-me-1234567');
    await service.deleteSecret(KAPPA, 'partner_api', 'default');
    await service.deleteSecret(KAPPA, 'partner_api', 'default');
    await expect(service.getSecret(KAPPA, 'partner_api', 'default')).resolves.toBeNull();
  });

  it('refuses an unregistered purpose, and a system-only one, with a 500-class error', async () => {
    await expect(service.setSecret(KAPPA, 'typo_purpose', 'default', 'x-12345678')).rejects.toThrow(InternalServerErrorException);
    await expect(service.setSecret(KAPPA, 'smtp', 'default', 'x-12345678')).rejects.toThrow(/not registered for the org tier/);
    expect(prisma.orgCredential.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ['an uppercase org id', KAPPA.toUpperCase(), 'partner_api', 'default'],
    ['a non-UUID org id', 'kappa', 'partner_api', 'default'],
    ['a purpose with ":"', KAPPA, 'a:b', 'default'],
    ['a padded name', KAPPA, 'partner_api', ' default'],
  ])('rejects %s with a 400', async (_label, orgId, purpose, name) => {
    await expect(service.getSecret(orgId, purpose, name)).rejects.toThrow(BadRequestException);
  });

  it('never logs the secret or its hint', async () => {
    const log = jest.spyOn((service as unknown as { logger: { log: (m: string) => void } }).logger, 'log').mockImplementation(() => undefined);
    await service.setSecret(KAPPA, 'partner_api', 'default', 'super-secret-value-4321');
    for (const [message] of log.mock.calls) {
      expect(String(message)).not.toContain('super-secret-value-4321');
      expect(String(message)).not.toContain('4321');
    }
  });
});
