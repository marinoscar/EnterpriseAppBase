// =============================================================================
// The secret cipher stays byte-compatible across its move into the package
// =============================================================================
//
// Issue #698 moved apps/api/src/common/crypto/secret-cipher.ts into
// `@marinoscar/platform-api/core`. Every row of `credentials`, `user_credentials`
// and `user_ai_keys` is ciphertext that cipher wrote, so the move must not
// change the env var, the sub-key label, the IV/tag lengths or the payload
// layout. The fixtures below were produced by the APP'S copy of the cipher on
// `main`, before the move, under the fixed test key below; the package's
// cipher must decrypt them. If this fails, every stored credential of every
// deployment that upgrades becomes unreadable. Never regenerate the fixtures
// to make it pass.
//
// The cipher caches the master key at module scope, so the package is
// re-required after the variable is set (jest.resetModules).
// =============================================================================

type CoreModule = typeof import('@marinoscar/platform-api/core');

const ENV_VAR = 'SECRETS_ENCRYPTION_KEY';

/** 32 bytes of 0x5a. A test key, never used anywhere else. */
const FIXTURE_KEY = 'WlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlo=';

const FIXTURE_USER_ID = '00000000-0000-4000-8000-0000000000aa';

const FIXTURES = {
  /** encryptSecret('smtp-password-fixture', 'smtp') */
  system: 'B7YkLXO/DeSvAhyZWcBJtk9BBoIPiDTax6BpcwWnJfizOb4bkjnrtmK+6pTHvoGROQ==',
  /** encryptSecret('sk-user-key-fixture', userCredentialPurpose(FIXTURE_USER_ID, 'ai_user_key')) */
  user: 'pdqhN4k52obgO9IfOxjIYDCi1vEwGIB9ElX1LTwV6tiL4VLVNhYIgB3CFfwIoNY=',
  /** encryptSecret('', 'storage') */
  empty: 'S/t0KZ4cOPTXxK7zwtMMuQzOOw8cx1sf+nWJrQ==',
};

function loadCore(key: string | undefined): CoreModule {
  if (key === undefined) {
    delete process.env[ENV_VAR];
  } else {
    process.env[ENV_VAR] = key;
  }
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@marinoscar/platform-api/core') as CoreModule;
}

describe('secret cipher compatibility (pre-move ciphertexts)', () => {
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

  it('decrypts a system-store ciphertext written before the move', () => {
    const { decryptSecret } = loadCore(FIXTURE_KEY);

    expect(decryptSecret(FIXTURES.system, 'smtp')).toBe('smtp-password-fixture');
  });

  it('decrypts an owner-bound (per-user) ciphertext written before the move', () => {
    const { decryptSecret, userCredentialPurpose } = loadCore(FIXTURE_KEY);

    expect(decryptSecret(FIXTURES.user, userCredentialPurpose(FIXTURE_USER_ID, 'ai_user_key'))).toBe(
      'sk-user-key-fixture',
    );
  });

  it('decrypts the encryption of an empty string written before the move', () => {
    const { decryptSecret } = loadCore(FIXTURE_KEY);

    expect(decryptSecret(FIXTURES.empty, 'storage')).toBe('');
  });

  it('still binds the purpose: a pre-move ciphertext does not decrypt under another purpose', () => {
    const { decryptSecret } = loadCore(FIXTURE_KEY);

    expect(() => decryptSecret(FIXTURES.system, 'oauth')).toThrow(
      'Failed to decrypt secret: the payload is corrupt, was encrypted under a different purpose, or the encryption key has changed.',
    );
  });

  it('round-trips a new ciphertext in the pre-move payload layout ([iv 12][tag 16][ciphertext])', () => {
    const { decryptSecret, encryptSecret } = loadCore(FIXTURE_KEY);

    const payload = encryptSecret('smtp-password-fixture', 'smtp');

    expect(Buffer.from(payload, 'base64').length).toBe(Buffer.from(FIXTURES.system, 'base64').length);
    expect(decryptSecret(payload, 'smtp')).toBe('smtp-password-fixture');
  });
});
