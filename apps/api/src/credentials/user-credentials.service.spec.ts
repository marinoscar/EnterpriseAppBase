import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

import { UserCredentialsService } from './user-credentials.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../test/mocks/prisma.mock';

// =============================================================================
// UserCredentialsService — tests (issue #387)
// =============================================================================
//
// Mirrors credentials.service.spec.ts's approach: Prisma is mocked, but backed
// by a small in-memory Map keyed by (userId, purpose, name) so "write then
// read" and the blank-preserve tests can check what was actually persisted
// rather than a mock call argument. secret-cipher.ts is NOT mocked - it is
// exercised for real (through userCredentialPurpose), which is what makes the
// no-plaintext-egress, cross-user-isolation-adjacent, and decrypt-failure
// assertions below meaningful.
// =============================================================================

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64');

// secret-cipher.ts caches its master key at module scope on first use, so this
// must be set before the first encrypt/decrypt call in this file - which only
// happens inside a setSecret/getSecret call in the tests below, never at
// import time. Restored in afterAll so it cannot leak into another spec file
// sharing this worker.
const ORIGINAL_KEY_ENV = process.env.SECRETS_ENCRYPTION_KEY;
process.env.SECRETS_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

afterAll(() => {
  if (ORIGINAL_KEY_ENV === undefined) {
    delete process.env.SECRETS_ENCRYPTION_KEY;
  } else {
    process.env.SECRETS_ENCRYPTION_KEY = ORIGINAL_KEY_ENV;
  }
});

// Two arbitrary, valid, distinct canonical UUIDs - meaningful only in that
// they are well-formed and different from each other.
const USER_A = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const USER_B = '11111111-2222-3333-4444-555555555555';

interface FakeRow {
  id: string;
  userId: string;
  purpose: string;
  name: string;
  secret: string;
  hint: string | null;
  label: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function rowKey(userId: string, purpose: string, name: string): string {
  return `${userId}::${purpose}::${name}`;
}

/** Project a fake row down to the `select` shape the service asked Prisma for. */
function project(
  row: FakeRow,
  select: Record<string, boolean> | undefined,
): Record<string, unknown> {
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const field of Object.keys(select)) {
    if (select[field]) {
      out[field] = (row as unknown as Record<string, unknown>)[field];
    }
  }
  return out;
}

/** Apply a Prisma-shaped update/data object to a fake row, returning the next version. */
function applyUpdate(row: FakeRow, data: Record<string, unknown>): FakeRow {
  const next: FakeRow = { ...row, updatedAt: new Date() };
  if ('secret' in data) next.secret = data.secret as string;
  if ('hint' in data) next.hint = data.hint as string | null;
  if ('label' in data) next.label = data.label as string | null;
  return next;
}

/**
 * Flip one base64 character well inside the payload (never in trailing `=`
 * padding) so the underlying bytes change and GCM authentication fails on
 * decrypt - without ever constructing or touching plaintext.
 */
function corruptCiphertext(payload: string): string {
  const idx = 10;
  if (payload.length <= idx + 4) {
    throw new Error('test payload too short for corruptCiphertext');
  }
  const chars = payload.split('');
  chars[idx] = chars[idx] === 'A' ? 'B' : 'A';
  return chars.join('');
}

describe('UserCredentialsService', () => {
  let service: UserCredentialsService;
  let mockPrisma: MockPrismaService;
  let store: Map<string, FakeRow>;
  let nextId: number;

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();
    store = new Map();
    nextId = 1;

    (
      mockPrisma.userCredential.findUnique as unknown as jest.Mock
    ).mockImplementation(async (args: any) => {
      const { userId, purpose, name } = args.where.userId_purpose_name;
      const row = store.get(rowKey(userId, purpose, name));
      return row ? project(row, args.select) : null;
    });

    (
      mockPrisma.userCredential.findMany as unknown as jest.Mock
    ).mockImplementation(async (args: any) => {
      const userId = args.where?.userId;
      const purpose = args.where?.purpose;
      const rows = Array.from(store.values())
        .filter(
          (r) => r.userId === userId && (purpose === undefined || r.purpose === purpose),
        )
        .sort((a, b) => {
          const byPurpose = a.purpose.localeCompare(b.purpose);
          return byPurpose !== 0 ? byPurpose : a.name.localeCompare(b.name);
        });
      return rows.map((r) => project(r, args.select));
    });

    (
      mockPrisma.userCredential.upsert as unknown as jest.Mock
    ).mockImplementation(async (args: any) => {
      const { userId, purpose, name } = args.where.userId_purpose_name;
      const k = rowKey(userId, purpose, name);
      const existing = store.get(k);

      if (existing) {
        const updated = applyUpdate(existing, args.update);
        store.set(k, updated);
        return { ...updated };
      }

      const now = new Date();
      const created: FakeRow = {
        id: `usercred-${nextId++}`,
        userId,
        purpose,
        name,
        secret: args.create.secret,
        hint: args.create.hint ?? null,
        label: args.create.label ?? null,
        createdAt: now,
        updatedAt: now,
      };
      store.set(k, created);
      return { ...created };
    });

    (
      mockPrisma.userCredential.update as unknown as jest.Mock
    ).mockImplementation(async (args: any) => {
      const existing = Array.from(store.values()).find(
        (r) => r.id === args.where.id,
      );
      if (!existing) {
        // Mirrors Prisma's P2025 for an update against a missing row.
        throw new Error('Simulated Prisma P2025: record not found');
      }
      const updated = applyUpdate(existing, args.data);
      store.set(rowKey(updated.userId, updated.purpose, updated.name), updated);
      return { ...updated };
    });

    (
      mockPrisma.userCredential.deleteMany as unknown as jest.Mock
    ).mockImplementation(async (args: any) => {
      const { userId, purpose, name } = args.where;
      const k = rowKey(userId, purpose, name);
      if (store.has(k)) {
        store.delete(k);
        return { count: 1 };
      }
      return { count: 0 };
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserCredentialsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UserCredentialsService>(UserCredentialsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // getSecret
  // ==========================================================================
  describe('getSecret', () => {
    it('round-trips through a mocked Prisma', async () => {
      await service.setSecret(USER_A, 'llm', 'default', 'my-anthropic-key', {});

      await expect(service.getSecret(USER_A, 'llm', 'default')).resolves.toBe(
        'my-anthropic-key',
      );
    });

    it('returns null for a missing row', async () => {
      await expect(
        service.getSecret(USER_A, 'llm', 'never-set'),
      ).resolves.toBeNull();
    });

    it('throws (does not return null) when a row exists but will not decrypt', async () => {
      await service.setSecret(USER_A, 'llm', 'default', 'a-real-key-value', {});
      const row = store.get(rowKey(USER_A, 'llm', 'default'))!;
      store.set(rowKey(USER_A, 'llm', 'default'), {
        ...row,
        secret: corruptCiphertext(row.secret),
      });

      await expect(service.getSecret(USER_A, 'llm', 'default')).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('is not readable under a different owner, even for the identical row contents', async () => {
      await service.setSecret(USER_A, 'llm', 'default', 'owned-by-A', {});

      // Simulate a ciphertext lifted from user A's row into user B's - a bad
      // UPDATE, a mis-merged restore - which is exactly what folding userId
      // into the cipher domain exists to defend against.
      const rowA = store.get(rowKey(USER_A, 'llm', 'default'))!;
      store.set(rowKey(USER_B, 'llm', 'default'), {
        ...rowA,
        id: 'copied-row',
        userId: USER_B,
      });

      await expect(service.getSecret(USER_B, 'llm', 'default')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // ==========================================================================
  // describe / list - no plaintext egress
  // ==========================================================================
  describe('describe and list never select secret', () => {
    it('requests a select for describe that does not include secret', async () => {
      await service.setSecret(USER_A, 'llm', 'default', 'value-for-describe', {});
      (
        mockPrisma.userCredential.findUnique as unknown as jest.Mock
      ).mockClear();

      await service.describe(USER_A, 'llm', 'default');

      const call = (
        mockPrisma.userCredential.findUnique as unknown as jest.Mock
      ).mock.calls[0][0];
      expect(call.select).toBeDefined();
      expect(call.select.secret).toBeUndefined();
    });

    it('requests a select for list that does not include secret', async () => {
      await service.setSecret(USER_A, 'llm', 'default', 'value-for-list', {});
      (mockPrisma.userCredential.findMany as unknown as jest.Mock).mockClear();

      await service.list(USER_A);

      const call = (mockPrisma.userCredential.findMany as unknown as jest.Mock)
        .mock.calls[0][0];
      expect(call.select).toBeDefined();
      expect(call.select.secret).toBeUndefined();
    });

    it('describe never carries the secret, checked structurally', async () => {
      const plaintext = 'S3cr3t-Value-For-Egress-Check';
      await service.setSecret(USER_A, 'llm', 'default', plaintext, {
        label: 'Personal key',
      });
      const ciphertext = store.get(rowKey(USER_A, 'llm', 'default'))!.secret;

      const info = await service.describe(USER_A, 'llm', 'default');
      const serialized = JSON.stringify(info);

      expect(serialized).not.toContain(plaintext);
      expect(serialized).not.toContain(ciphertext);
    });

    it('list never carries any secret, checked structurally', async () => {
      const plaintextA = 'first-secret-abcdefgh';
      const plaintextB = 'second-secret-ijklmnop';
      await service.setSecret(USER_A, 'llm', 'a', plaintextA, {});
      await service.setSecret(USER_A, 'llm', 'b', plaintextB, {});
      const ciphertextA = store.get(rowKey(USER_A, 'llm', 'a'))!.secret;
      const ciphertextB = store.get(rowKey(USER_A, 'llm', 'b'))!.secret;

      const list = await service.list(USER_A);
      const serialized = JSON.stringify(list);

      expect(serialized).not.toContain(plaintextA);
      expect(serialized).not.toContain(plaintextB);
      expect(serialized).not.toContain(ciphertextA);
      expect(serialized).not.toContain(ciphertextB);
    });
  });

  // ==========================================================================
  // list - unscoped / scoped, ordering and grouping
  // ==========================================================================
  describe('list', () => {
    it('unscoped: returns every credential the user owns, across purposes', async () => {
      await service.setSecret(USER_A, 'llm', 'anthropic', 'key-1', {});
      await service.setSecret(USER_A, 'llm', 'openai', 'key-2', {});
      await service.setSecret(USER_A, 'webhook', 'default', 'key-3', {});

      const list = await service.list(USER_A);

      expect(list).toHaveLength(3);
    });

    it('scoped: purpose narrows the result to that purpose only', async () => {
      await service.setSecret(USER_A, 'llm', 'anthropic', 'key-1', {});
      await service.setSecret(USER_A, 'llm', 'openai', 'key-2', {});
      await service.setSecret(USER_A, 'webhook', 'default', 'key-3', {});

      const list = await service.list(USER_A, 'llm');

      expect(list).toHaveLength(2);
      expect(list.every((c) => c.purpose === 'llm')).toBe(true);
    });

    it('is ordered and grouped by (purpose, name), stable across renders', async () => {
      // Written out of order on purpose so the assertion is not trivially true.
      await service.setSecret(USER_A, 'webhook', 'default', 'v', {});
      await service.setSecret(USER_A, 'llm', 'openai', 'v', {});
      await service.setSecret(USER_A, 'llm', 'anthropic', 'v', {});

      const list = await service.list(USER_A);

      expect(list.map((c) => `${c.purpose}/${c.name}`)).toEqual([
        'llm/anthropic',
        'llm/openai',
        'webhook/default',
      ]);
    });

    it('never returns another user\'s credentials', async () => {
      await service.setSecret(USER_A, 'llm', 'default', 'a-key', {});
      await service.setSecret(USER_B, 'llm', 'default', 'b-key', {});

      const listA = await service.list(USER_A);
      const listB = await service.list(USER_B);

      expect(listA).toHaveLength(1);
      expect(listA[0].userId).toBe(USER_A);
      expect(listB).toHaveLength(1);
      expect(listB[0].userId).toBe(USER_B);
    });
  });

  // ==========================================================================
  // setSecret - blank preserves
  // ==========================================================================
  describe('setSecret blank preserves', () => {
    it('undefined on an existing row leaves ciphertext and hint untouched while metadata still applies', async () => {
      await service.setSecret(USER_A, 'llm', 'default', 'original-value', {
        label: 'Old Label',
      });
      const before = store.get(rowKey(USER_A, 'llm', 'default'))!;

      await service.setSecret(USER_A, 'llm', 'default', undefined, {
        label: 'New Label',
      });
      const after = store.get(rowKey(USER_A, 'llm', 'default'))!;

      expect(after.secret).toBe(before.secret);
      expect(after.hint).toBe(before.hint);
      expect(after.label).toBe('New Label');
      await expect(service.getSecret(USER_A, 'llm', 'default')).resolves.toBe(
        'original-value',
      );
    });

    it('null on an existing row leaves ciphertext and hint untouched', async () => {
      await service.setSecret(USER_A, 'llm', 'default', 'original-value-2', {});
      const before = store.get(rowKey(USER_A, 'llm', 'default'))!;

      await service.setSecret(USER_A, 'llm', 'default', null, {
        label: 'Only Metadata Changed',
      });
      const after = store.get(rowKey(USER_A, 'llm', 'default'))!;

      expect(after.secret).toBe(before.secret);
      await expect(service.getSecret(USER_A, 'llm', 'default')).resolves.toBe(
        'original-value-2',
      );
    });

    it('empty string on an existing row leaves ciphertext untouched', async () => {
      await service.setSecret(USER_A, 'llm', 'default', 'original-value-3', {});
      const before = store.get(rowKey(USER_A, 'llm', 'default'))!;

      await service.setSecret(USER_A, 'llm', 'default', '', {});
      const after = store.get(rowKey(USER_A, 'llm', 'default'))!;

      expect(after.secret).toBe(before.secret);
      expect(after.hint).toBe(before.hint);
    });

    it('first write with a blank secret throws BadRequestException and creates no row', async () => {
      await expect(
        service.setSecret(USER_A, 'llm', 'never-set', '', {}),
      ).rejects.toThrow(BadRequestException);

      expect(store.has(rowKey(USER_A, 'llm', 'never-set'))).toBe(false);
    });

    it('a real write stores ciphertext plus a derived hint', async () => {
      await service.setSecret(USER_A, 'llm', 'default', 'password123', {});

      const row = store.get(rowKey(USER_A, 'llm', 'default'))!;
      expect(row.secret).not.toBe('password123');
      expect(row.hint).toBe('••••d123');

      const info = await service.describe(USER_A, 'llm', 'default');
      expect(info?.hint).toBe('••••d123');
    });

    it('a non-blank secret replaces the stored ciphertext', async () => {
      await service.setSecret(USER_A, 'llm', 'default', 'first-value', {});
      const before = store.get(rowKey(USER_A, 'llm', 'default'))!;

      await service.setSecret(USER_A, 'llm', 'default', 'second-value', {});
      const after = store.get(rowKey(USER_A, 'llm', 'default'))!;

      expect(after.secret).not.toBe(before.secret);
      await expect(service.getSecret(USER_A, 'llm', 'default')).resolves.toBe(
        'second-value',
      );
    });
  });

  // ==========================================================================
  // deleteSecret
  // ==========================================================================
  describe('deleteSecret', () => {
    it('removes an existing credential', async () => {
      await service.setSecret(USER_A, 'llm', 'default', 'to-be-deleted', {});
      await service.deleteSecret(USER_A, 'llm', 'default');

      await expect(
        service.getSecret(USER_A, 'llm', 'default'),
      ).resolves.toBeNull();
    });

    it('is idempotent: deleting an absent credential does not throw', async () => {
      await expect(
        service.deleteSecret(USER_A, 'llm', 'never-existed'),
      ).resolves.toBeUndefined();
      await expect(
        service.deleteSecret(USER_A, 'llm', 'never-existed'),
      ).resolves.toBeUndefined();
    });

    it('deleting user A\'s credential does not affect user B\'s identically-addressed one', async () => {
      await service.setSecret(USER_A, 'llm', 'default', 'a-value', {});
      await service.setSecret(USER_B, 'llm', 'default', 'b-value', {});

      await service.deleteSecret(USER_A, 'llm', 'default');

      await expect(
        service.getSecret(USER_A, 'llm', 'default'),
      ).resolves.toBeNull();
      await expect(service.getSecret(USER_B, 'llm', 'default')).resolves.toBe(
        'b-value',
      );
    });
  });

  // ==========================================================================
  // Malformed userId fails at the service boundary
  // ==========================================================================
  describe('malformed userId', () => {
    it('getSecret rejects a non-UUID userId with a clear, non-500 error', async () => {
      await expect(
        service.getSecret('not-a-real-user-id', 'llm', 'default'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.getSecret('not-a-real-user-id', 'llm', 'default'),
      ).rejects.toThrow(/canonical UUID/);
    });

    it('setSecret rejects a non-UUID userId', async () => {
      await expect(
        service.setSecret('not-a-real-user-id', 'llm', 'default', 'x', {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('list rejects a non-UUID userId', async () => {
      await expect(service.list('not-a-real-user-id')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deleteSecret rejects a non-UUID userId', async () => {
      await expect(
        service.deleteSecret('not-a-real-user-id', 'llm', 'default'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==========================================================================
  // No secret or userId leakage in logs and thrown errors
  // ==========================================================================
  describe('no plaintext or userId leakage in logs and errors', () => {
    let logSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
      logSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
    });

    afterEach(() => {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('never logs the secret or the userId across a normal write/read/delete cycle', async () => {
      const plaintext = 'MARKER-PLAINTEXT-do-not-leak-me-user-cred';

      await service.setSecret(USER_A, 'llm', 'default', plaintext, {
        label: 'My key',
      });
      await service.getSecret(USER_A, 'llm', 'default');
      await service.deleteSecret(USER_A, 'llm', 'default');

      const loggedStrings = [...logSpy.mock.calls, ...errorSpy.mock.calls]
        .flat()
        .filter((arg): arg is string => typeof arg === 'string');

      // Sanity: the store does log something (set + delete), so this is a
      // real assertion about content and not a vacuously-true empty check.
      expect(loggedStrings.length).toBeGreaterThan(0);

      for (const line of loggedStrings) {
        expect(line).not.toContain(plaintext);
        expect(line).not.toContain(USER_A);
      }
    });

    it('never logs the secret, ciphertext, or userId on a decrypt failure, and the thrown error is likewise clean', async () => {
      const plaintext = 'another-secret-not-to-leak-ever';
      await service.setSecret(USER_A, 'llm', 'corrupt-target', plaintext, {});
      const row = store.get(rowKey(USER_A, 'llm', 'corrupt-target'))!;
      const originalCiphertext = row.secret;
      const corrupted = corruptCiphertext(originalCiphertext);
      store.set(rowKey(USER_A, 'llm', 'corrupt-target'), {
        ...row,
        secret: corrupted,
      });

      let thrown: unknown;
      try {
        await service.getSecret(USER_A, 'llm', 'corrupt-target');
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(InternalServerErrorException);
      const err = thrown as InternalServerErrorException & {
        stack?: string;
        cause?: unknown;
      };
      const responseBody = JSON.stringify(err.getResponse());

      const loggedStrings = [...logSpy.mock.calls, ...errorSpy.mock.calls]
        .flat()
        .filter((arg): arg is string => typeof arg === 'string');
      expect(loggedStrings.length).toBeGreaterThan(0);

      for (const secretMaterial of [
        plaintext,
        originalCiphertext,
        corrupted,
        USER_A,
      ]) {
        expect(err.message).not.toContain(secretMaterial);
        expect(err.stack ?? '').not.toContain(secretMaterial);
        expect(responseBody).not.toContain(secretMaterial);
        for (const line of loggedStrings) {
          expect(line).not.toContain(secretMaterial);
        }
      }
      // The service deliberately swallows the underlying cipher error rather
      // than chaining it as `cause`.
      expect(err.cause).toBeUndefined();
    });
  });
});
