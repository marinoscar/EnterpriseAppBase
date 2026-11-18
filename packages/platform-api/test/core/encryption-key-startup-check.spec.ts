// =============================================================================
// verifyEncryptionKeyAtStartup (issue #116; moved into core by issue #698)
// =============================================================================
//
// The check had no spec while it lived in the app. Moving it into the package
// replaced its `PrismaService` parameter with a `countStoredSecrets` callback,
// which is what makes it testable with a stub counter: one test per decision
// branch of the header in encryption-key-startup-check.ts. Log lines are
// asserted verbatim because operators and the CI smoke job read them.
//
// The cipher caches the master key at module scope, so every test resets the
// module registry and requires a fresh copy after setting the variable (same
// pattern as secret-cipher.spec.ts).
// =============================================================================

type StartupCheckModule = typeof import('../../src/core/crypto/encryption-key-startup-check');

const ENV_VAR = 'SECRETS_ENCRYPTION_KEY';
const VALID_KEY = Buffer.alloc(32, 7).toString('base64');

function loadCheck(key: string | undefined): StartupCheckModule {
  if (key === undefined) {
    delete process.env[ENV_VAR];
  } else {
    process.env[ENV_VAR] = key;
  }
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../../src/core/crypto/encryption-key-startup-check') as StartupCheckModule;
}

function stubLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
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

  it('key set and valid: logs that storage is available and never counts', async () => {
    const { verifyEncryptionKeyAtStartup } = loadCheck(VALID_KEY);
    const logger = stubLogger();
    const count = jest.fn(async () => 3);

    await expect(verifyEncryptionKeyAtStartup(count, logger)).resolves.toBeUndefined();

    expect(count).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      'SECRETS_ENCRYPTION_KEY is configured; encrypted credential storage is available.',
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('key set and malformed: throws the cipher error unchanged, never counts, logs nothing', async () => {
    const { verifyEncryptionKeyAtStartup } = loadCheck('not a real key!!!');
    const logger = stubLogger();
    const count = jest.fn(async () => 0);

    await expect(verifyEncryptionKeyAtStartup(count, logger)).rejects.toThrow(
      'SECRETS_ENCRYPTION_KEY is not valid base64. It must be a base64-encoded 32-byte key. ' +
        'Generate one with: openssl rand -base64 32',
    );

    expect(count).not.toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('key set to the wrong length: throws with the byte count and no key material', async () => {
    const shortKey = Buffer.alloc(24, 9).toString('base64');
    const { verifyEncryptionKeyAtStartup } = loadCheck(shortKey);

    const failure = verifyEncryptionKeyAtStartup(jest.fn(async () => 0), stubLogger());

    await expect(failure).rejects.toThrow('SECRETS_ENCRYPTION_KEY decoded to 24 bytes.');
    await expect(failure).rejects.not.toThrow(shortKey);
  });

  it('key absent with zero stored secrets: warns once and boots', async () => {
    const { verifyEncryptionKeyAtStartup } = loadCheck(undefined);
    const logger = stubLogger();
    const count = jest.fn(async () => 0);

    await expect(verifyEncryptionKeyAtStartup(count, logger)).resolves.toBeUndefined();

    expect(count).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'SECRETS_ENCRYPTION_KEY is not set. Encrypted credential storage is unavailable, so ' +
        'object storage cannot be configured and file uploads, avatars and database ' +
        'backups will be refused until it is. No credentials are currently stored, ' +
        'so nothing already saved is at risk. Generate a key with: openssl rand -base64 32',
    );
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('an empty value counts as absent, not as malformed', async () => {
    const { verifyEncryptionKeyAtStartup } = loadCheck('');
    const logger = stubLogger();
    const count = jest.fn(async () => 0);

    await expect(verifyEncryptionKeyAtStartup(count, logger)).resolves.toBeUndefined();

    expect(count).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('key absent with stored secrets: throws with the count', async () => {
    const { verifyEncryptionKeyAtStartup } = loadCheck(undefined);
    const logger = stubLogger();

    await expect(verifyEncryptionKeyAtStartup(async () => 2, logger)).rejects.toThrow(
      'SECRETS_ENCRYPTION_KEY is not set, but 2 encrypted credential(s) are stored in the database.',
    );

    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('key absent and the count fails: warns with the cause and boots (fails open)', async () => {
    const { verifyEncryptionKeyAtStartup } = loadCheck(undefined);
    const logger = stubLogger();

    await expect(
      verifyEncryptionKeyAtStartup(async () => {
        throw new Error('The table `public.credentials` does not exist in the current database.');
      }, logger),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Could not check for stored credentials while validating SECRETS_ENCRYPTION_KEY ' +
        '(the credentials table may not be migrated yet). Continuing startup. ' +
        'Cause: The table `public.credentials` does not exist in the current database.',
    );
  });
});
