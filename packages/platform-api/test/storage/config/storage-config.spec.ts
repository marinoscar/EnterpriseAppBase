import {
  describeStorageConfig,
  fingerprintStorageConfig,
  type ResolvedStorageConfig,
} from '../../../src/storage/config/storage-config';

// =============================================================================
// config/storage-config.ts — tests (issue #373; generalised by PP-14.7)
// =============================================================================
//
// Pure functions, no mocking: the fingerprint and the secret-free description of
// the ACTIVE driver's resolved configuration. The S3 family's completeness rules
// are tested in `drivers/s3/s3-config.spec.ts`.
// =============================================================================

const SECRET = 'super-secret-access-key-value';

function resolvedConfig(overrides: Partial<ResolvedStorageConfig> = {}): ResolvedStorageConfig {
  return {
    provider: 's3',
    bucket: 'my-bucket',
    region: 'us-west-2',
    settings: { bucket: 'my-bucket', region: 'us-west-2', accessKeyId: 'AKIAEXAMPLE' },
    secrets: { secretAccessKey: SECRET },
    ...overrides,
  };
}

describe('fingerprintStorageConfig', () => {
  it('produces the same fingerprint for the same configuration', () => {
    const a = fingerprintStorageConfig(resolvedConfig());
    const b = fingerprintStorageConfig(resolvedConfig());

    expect(a).toBe(b);
  });

  it('produces a different fingerprint when the secret changes', () => {
    const original = fingerprintStorageConfig(
      resolvedConfig({ secrets: { secretAccessKey: 'first-secret' } }),
    );
    const rotated = fingerprintStorageConfig(
      resolvedConfig({ secrets: { secretAccessKey: 'second-secret' } }),
    );

    expect(rotated).not.toBe(original);
  });

  it('produces a different fingerprint when a non-secret field changes', () => {
    const a = fingerprintStorageConfig(resolvedConfig({ settings: { bucket: 'bucket-a' } }));
    const b = fingerprintStorageConfig(resolvedConfig({ settings: { bucket: 'bucket-b' } }));

    expect(a).not.toBe(b);
  });

  it('does not depend on the order the settings were written in', () => {
    const a = fingerprintStorageConfig(resolvedConfig({ settings: { bucket: 'b', region: 'r' } }));
    const b = fingerprintStorageConfig(resolvedConfig({ settings: { region: 'r', bucket: 'b' } }));

    expect(a).toBe(b);
  });

  it('is a different identity for a different driver with the same settings', () => {
    expect(fingerprintStorageConfig(resolvedConfig({ provider: 'r2' }))).not.toBe(fingerprintStorageConfig(resolvedConfig()));
  });

  it('is not the plaintext secret, and is a sha256 hex digest', () => {
    const fingerprint = fingerprintStorageConfig(resolvedConfig());

    expect(fingerprint).not.toBe(SECRET);
    expect(fingerprint).not.toContain(SECRET);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('describeStorageConfig', () => {
  it('never includes the secret access key', () => {
    const description = describeStorageConfig(
      resolvedConfig({ secrets: { secretAccessKey: 'TOTALLY-SECRET-VALUE' } }),
    );

    expect(description).not.toContain('TOTALLY-SECRET-VALUE');
  });

  it('describes an AWS-hosted s3 config by region, not endpoint', () => {
    const description = describeStorageConfig(
      resolvedConfig({ provider: 's3', bucket: 'my-bucket', region: 'us-west-2' }),
    );

    expect(description).toBe(
      's3 bucket=my-bucket at=us-west-2 (default host) keyId=AKIAEXAMPLE',
    );
  });

  it('describes an endpoint-addressed config by its endpoint', () => {
    const description = describeStorageConfig(
      resolvedConfig({
        provider: 'r2',
        bucket: 'my-bucket',
        region: 'auto',
        endpoint: 'https://abc123.r2.cloudflarestorage.com',
      }),
    );

    expect(description).toBe(
      'r2 bucket=my-bucket at=https://abc123.r2.cloudflarestorage.com keyId=AKIAEXAMPLE',
    );
  });

  it('includes the access key id (an identifier, not a secret)', () => {
    const description = describeStorageConfig(
      resolvedConfig({ settings: { accessKeyId: 'AKIA-IDENTIFIABLE' } }),
    );

    expect(description).toContain('keyId=AKIA-IDENTIFIABLE');
  });

  it('describes a driver with no key id, no region and no endpoint without inventing any', () => {
    expect(
      describeStorageConfig({ provider: 'local-fs', bucket: '/data', region: '', settings: { directory: '/data' }, secrets: {} }),
    ).toBe('local-fs bucket=/data at=the default host');
  });
});
