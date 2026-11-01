import { createHmac, randomBytes } from 'node:crypto';

// =============================================================================
// deriveSigningKey (issue #822)
// =============================================================================
//
// The cipher caches the master key and the derived keys for the process, so
// every case loads a fresh module instance (`jest.resetModules()` + `require`)
// after setting the variable, as secret-cipher.spec.ts does.
//
// The golden value pins the derivation, label included. It is the value the
// app-side copy derived before the cipher moved into this package, ported from
// the consumer's test: a change to it would invalidate every outstanding token
// signed under the key (the consumer's Android APK download links).
// =============================================================================

type SecretCipherModule = typeof import('../../src/core/crypto/secret-cipher');

const ENV_VAR = 'SECRETS_ENCRYPTION_KEY';
const MODULE_PATH = '../../src/core/crypto/secret-cipher';

/** A deterministic, valid 32-byte key (base64-encoded). */
const VALID_KEY = Buffer.alloc(32, 7).toString('base64');

/**
 * HMAC-SHA256(VALID_KEY, 'enterpriseappbase:signing-key:v1:android-app-download'),
 * as the pre-package app copy of the cipher derived it.
 */
const GOLDEN_ANDROID_DOWNLOAD_KEY =
  'cd0471fc5d3af6a61ad34239138ada62d63d0825e8e7f0618be56d4fb60e8950';

function load(key: string | undefined): SecretCipherModule {
  if (key === undefined) delete process.env[ENV_VAR];
  else process.env[ENV_VAR] = key;
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(MODULE_PATH) as SecretCipherModule;
}

describe('deriveSigningKey (#822)', () => {
  const original = process.env[ENV_VAR];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = original;
    jest.resetModules();
  });

  it('derives exactly the key the pre-package copy derived (same label)', () => {
    expect(load(VALID_KEY).deriveSigningKey('android-app-download').toString('hex')).toBe(
      GOLDEN_ANDROID_DOWNLOAD_KEY,
    );
    // Whitespace around the variable is absorbed, as the cipher absorbs it.
    expect(load(` ${VALID_KEY}\n`).deriveSigningKey('android-app-download').toString('hex')).toBe(
      GOLDEN_ANDROID_DOWNLOAD_KEY,
    );
  });

  it('is HMAC-SHA256 over the signing label, never the encryption label', () => {
    const master = Buffer.from(VALID_KEY, 'base64');
    const key = load(VALID_KEY).deriveSigningKey('smtp');

    const signing = createHmac('sha256', master).update('enterpriseappbase:signing-key:v1:smtp').digest();
    const encryption = createHmac('sha256', master).update('enterpriseappbase:secret-cipher:v1:smtp').digest();

    expect(key.equals(signing)).toBe(true);
    expect(key.equals(encryption)).toBe(false);
  });

  it('is a stable 32-byte key per purpose, distinct across purposes and keys', () => {
    const first = load(VALID_KEY);
    const a = first.deriveSigningKey('android-app-download');

    expect(a).toHaveLength(32);
    expect(first.deriveSigningKey('android-app-download').equals(a)).toBe(true);
    expect(first.deriveSigningKey('other-purpose').equals(a)).toBe(false);

    const second = load(randomBytes(32).toString('base64'));
    expect(second.deriveSigningKey('android-app-download').equals(a)).toBe(false);
  });

  it('refuses an empty purpose and a missing or malformed master key', () => {
    expect(() => load(VALID_KEY).deriveSigningKey('')).toThrow(/non-empty purpose/);
    expect(() =>
      load(VALID_KEY).deriveSigningKey(undefined as unknown as string),
    ).toThrow(/non-empty purpose/);
    expect(() => load(undefined).deriveSigningKey('android-app-download')).toThrow(/SECRETS_ENCRYPTION_KEY is not set/);
    expect(() => load('not base64 !').deriveSigningKey('android-app-download')).toThrow(/not valid base64/);
    expect(() => load(Buffer.alloc(16, 1).toString('base64')).deriveSigningKey('android-app-download')).toThrow(
      /decoded to 16 bytes/,
    );
  });

  it('never puts key material in its errors', () => {
    const sentinel = Buffer.alloc(16, 9).toString('base64');
    try {
      load(sentinel).deriveSigningKey('android-app-download');
      throw new Error('expected a throw');
    } catch (err) {
      expect((err as Error).message).not.toContain(sentinel);
    }
  });

  it('is exported from @marinoscar/platform-api/core', () => {
    process.env[ENV_VAR] = VALID_KEY;
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require('../../src/core/index') as typeof import('../../src/core/index');
    expect(core.deriveSigningKey('android-app-download').toString('hex')).toBe(GOLDEN_ANDROID_DOWNLOAD_KEY);
  });
});
