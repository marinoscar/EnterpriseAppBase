import { Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../../test/mocks/prisma.mock';

// =============================================================================
// SECRETS_ENCRYPTION_KEY startup validation — tests (issue #116, epic #108;
// extended for the two-store fix in #387)
// =============================================================================
//
// Two things about the module under test shape every test here.
//
// 1. IT READS `process.env` THROUGH secret-cipher, WHICH CACHES. secret-cipher
//    caches its master key at module scope on first use (see the comment on
//    `cachedMasterKey` there and the header of secret-cipher.spec.ts), so a
//    test that needs a different key — or no key — cannot simply reassign
//    `process.env` and call an already-imported function. `loadCheck()` below
//    does what `loadCipher()` does in that sibling spec: sets the variable,
//    `jest.resetModules()`, and `require`s a fresh instance, so both this
//    module and the cipher underneath it see the environment this test meant.
//
// 2. ITS ONLY DATABASE ACCESS IS TWO `count()` CALLS. That is the whole
//    surface, so Prisma is a plain jest-mock-extended deep mock (the repo's
//    `createMockPrismaService`) rather than the in-memory fake
//    credentials.service.spec.ts needs — there is no "write then read" here to
//    make meaningful.
//
// The branch table under test, restated from the module header: a present key
// is always format-validated; an absent key is fatal when rows exist in
// EITHER `credentials` or `user_credentials`, and a warning otherwise; and a
// probe that fails always warns and boots, whichever table failed.
// =============================================================================

type StartupCheckModule = typeof import('./encryption-key-startup-check');

const ENV_VAR = 'SECRETS_ENCRYPTION_KEY';
const MODULE_PATH = './encryption-key-startup-check';

/** A deterministic, valid 32-byte key (base64) for the "key is present" cases. */
const VALID_KEY = Buffer.alloc(32, 11).toString('base64');

/**
 * Reset the module registry, set (or clear) `SECRETS_ENCRYPTION_KEY`, and
 * `require` a fresh instance of the check — and, transitively, of the cipher
 * whose module-scope key cache it depends on.
 */
function loadCheck(key: string | undefined): StartupCheckModule {
  if (key === undefined) {
    delete process.env[ENV_VAR];
  } else {
    process.env[ENV_VAR] = key;
  }
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(MODULE_PATH) as StartupCheckModule;
}

/** Just the two methods the check calls, spied so the assertions can read them. */
interface LoggerSpy {
  log: jest.Mock;
  warn: jest.Mock;
}

function makeLogger(): LoggerSpy {
  return { log: jest.fn(), warn: jest.fn() };
}

/**
 * `number` resolves that count; anything else is what that probe rejects with
 * (an `Error` normally, a bare value for the not-an-Error case).
 */
type CountOutcome = number | { rejectWith: unknown };

/** Sugar so the cases below read as data rather than as object literals. */
function rejects(reason: unknown): CountOutcome {
  return { rejectWith: reason };
}

function makePrisma(
  deployment: CountOutcome,
  user: CountOutcome,
): MockPrismaService {
  const prisma = createMockPrismaService();

  const wire = (target: jest.Mock, outcome: CountOutcome): void => {
    if (typeof outcome === 'number') {
      target.mockResolvedValue(outcome);
    } else {
      target.mockRejectedValue(outcome.rejectWith);
    }
  };

  wire(prisma.credential.count as unknown as jest.Mock, deployment);
  wire(prisma.userCredential.count as unknown as jest.Mock, user);

  return prisma;
}

/** Run the check against a freshly-loaded module, with the given env and counts. */
async function run(options: {
  key: string | undefined;
  deployment?: CountOutcome;
  user?: CountOutcome;
}): Promise<{ logger: LoggerSpy; prisma: MockPrismaService; error?: Error }> {
  const { verifyEncryptionKeyAtStartup } = loadCheck(options.key);
  const logger = makeLogger();
  const prisma = makePrisma(options.deployment ?? 0, options.user ?? 0);

  let error: Error | undefined;
  try {
    await verifyEncryptionKeyAtStartup(
      prisma as unknown as PrismaService,
      logger as unknown as Logger,
    );
  } catch (thrown) {
    error = thrown as Error;
  }

  return { logger, prisma, error };
}

describe('verifyEncryptionKeyAtStartup', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env[ENV_VAR];
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = originalEnv;
    }
    jest.resetModules();
  });

  describe('key present', () => {
    it('validates the format, logs, and never touches the database', async () => {
      const { logger, prisma, error } = await run({ key: VALID_KEY });

      expect(error).toBeUndefined();
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining(ENV_VAR),
      );
      expect(logger.warn).not.toHaveBeenCalled();
      expect(prisma.credential.count).not.toHaveBeenCalled();
      expect(prisma.userCredential.count).not.toHaveBeenCalled();
    });

    it('throws for a malformed key regardless of what is stored', async () => {
      const { error } = await run({
        key: 'not-base64-of-32-bytes',
        deployment: 0,
        user: 0,
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain(ENV_VAR);
    });
  });

  describe('key absent, nothing stored', () => {
    it('warns and boots when both stores are empty', async () => {
      const { logger, error } = await run({
        key: undefined,
        deployment: 0,
        user: 0,
      });

      expect(error).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0][0]).toContain(ENV_VAR);
    });

    it('probes both stores, and does so in one round of calls rather than sequentially', async () => {
      const { prisma } = await run({ key: undefined, deployment: 0, user: 0 });

      expect(prisma.credential.count).toHaveBeenCalledTimes(1);
      expect(prisma.userCredential.count).toHaveBeenCalledTimes(1);
    });
  });

  describe('key absent, rows stored', () => {
    it('throws when only deployment credentials exist', async () => {
      const { error } = await run({ key: undefined, deployment: 3, user: 0 });

      expect(error).toBeDefined();
      expect(error?.message).toContain(ENV_VAR);
      expect(error?.message).toContain('3 encrypted credential(s)');
    });

    // ---------------------------------------------------------------------
    // THE #387 REGRESSION TEST. Before the fix this file exists to lock in,
    // strictness was measured with `prisma.credential.count()` alone, so this
    // exact state — no deployment credentials, some user credentials — took
    // the "nothing is stored" branch and the process booted clean with every
    // user's personal key unreadable.
    // ---------------------------------------------------------------------
    it('THROWS when only user credentials exist (regression: #387 counted only the credentials table)', async () => {
      const { logger, error } = await run({
        key: undefined,
        deployment: 0,
        user: 4,
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain(ENV_VAR);
      expect(error?.message).toContain('4 encrypted credential(s)');
      expect(error?.message).toContain('user_credentials');
      // Specifically NOT the warn-and-boot branch.
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('gates on the TOTAL and reports the split per store', async () => {
      const { error } = await run({ key: undefined, deployment: 2, user: 5 });

      expect(error?.message).toContain('7 encrypted credential(s)');
      expect(error?.message).toContain('2 deployment-wide');
      expect(error?.message).toContain('5 user-owned');
    });

    it('names counts only — never a credential purpose, name or label', async () => {
      const { error } = await run({ key: undefined, deployment: 1, user: 1 });

      // The mock never returns rows, so this is a guard on the message's
      // shape: it is built from counts, and there is no code path here that
      // could reach for an address even if one were available.
      expect(error?.message).toContain('openssl rand -base64 32');
      expect(error?.message).not.toMatch(/purpose|label|hint/i);
    });

    it('adds the owner caveat only when user credentials are affected', async () => {
      const withUsers = await run({ key: undefined, deployment: 0, user: 1 });
      const withoutUsers = await run({ key: undefined, deployment: 1, user: 0 });

      expect(withUsers.error?.message).toContain('their own owners');
      expect(withoutUsers.error?.message).not.toContain('their own owners');
    });

    it('treats an empty variable as absent, not as a malformed key', async () => {
      const { error } = await run({ key: '', deployment: 0, user: 2 });

      // Same fatal branch as `undefined` above — copying `.env.example`
      // verbatim produces `SECRETS_ENCRYPTION_KEY=` with nothing after it.
      expect(error?.message).toContain('2 encrypted credential(s)');
    });
  });

  describe('key absent, a probe fails', () => {
    it('warns and boots when the user_credentials count alone throws', async () => {
      const { logger, error } = await run({
        key: undefined,
        deployment: 0,
        user: rejects(new Error('relation "user_credentials" does not exist')),
      });

      expect(error).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const warning = logger.warn.mock.calls[0][0] as string;
      expect(warning).toContain('user_credentials: ');
      expect(warning).toContain('does not exist');
      // The table that answered is not named as a failure. The negative match
      // needs the leading non-underscore, because `user_credentials: ` trivially
      // contains `credentials: ` as a substring.
      expect(warning).not.toMatch(/[^_]credentials: /);
    });

    it('warns and boots when the credentials count alone throws', async () => {
      const { logger, error } = await run({
        key: undefined,
        deployment: rejects(new Error('relation "credentials" does not exist')),
        user: 0,
      });

      expect(error).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const warning = logger.warn.mock.calls[0][0] as string;
      expect(warning).toMatch(/[^_]credentials: /);
      expect(warning).not.toContain('user_credentials: ');
    });

    it('warns and boots when both counts throw, naming both tables', async () => {
      const { logger, error } = await run({
        key: undefined,
        deployment: rejects(new Error('database unreachable')),
        user: rejects(new Error('database unreachable')),
      });

      expect(error).toBeUndefined();
      const warning = logger.warn.mock.calls[0][0] as string;
      expect(warning).toMatch(/[^_]credentials: /);
      expect(warning).toContain('user_credentials: ');
    });

    it('does NOT throw when one store has rows and the other cannot be probed (the pre-#387-migration boot)', async () => {
      // A deployment that already stores deployment credentials and has not
      // yet applied #387's migration must still be able to start — often it is
      // the very container that then runs the migration.
      const { logger, error } = await run({
        key: undefined,
        deployment: 6,
        user: rejects(new Error('relation "user_credentials" does not exist')),
      });

      expect(error).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('survives a rejection that is not an Error', async () => {
      const { logger, error } = await run({
        key: undefined,
        deployment: 0,
        user: rejects('P2021'),
      });

      expect(error).toBeUndefined();
      expect(logger.warn.mock.calls[0][0] as string).toContain('P2021');
    });
  });
});
