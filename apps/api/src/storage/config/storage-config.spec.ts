import type { SystemStorageValue } from '../../common/schemas/settings.schema';
import {
  R2_DEFAULT_REGION,
  R2_ENDPOINT_HOST_SUFFIX,
  S3_COMPATIBLE_DEFAULT_REGION,
  STORAGE_ENV_FALLBACK_DEFAULT_REGION,
  deriveR2Endpoint,
  describeStorageConfig,
  fingerprintStorageConfig,
  hasSavedStorageSettings,
  readStorageEnvFallback,
  resolveStorageConfig,
  storageEnvFallbackPolicy,
  type ResolvedStorageConfig,
  type StorageEnvFallback,
} from './storage-config';

// =============================================================================
// storage-config.ts — tests (issue #373, epic #372)
// =============================================================================
//
// Pure functions, no mocking. `resolveStorageConfig` is the single definition
// of "configured" — the provider that builds an `S3Client`, the 503 an
// unconfigured deployment returns, and part 3's connection test all ask this
// same function, so the per-provider requirement list and the "every missing
// field, not just the first" contract are pinned exactly, field order and all.
// =============================================================================

function policy(overrides: Partial<SystemStorageValue> = {}): SystemStorageValue {
  return {
    provider: 's3',
    bucket: 'my-bucket',
    region: 'us-west-2',
    endpoint: '',
    accountId: '',
    accessKeyId: 'AKIAEXAMPLE',
    forcePathStyle: false,
    ...overrides,
  };
}

const SECRET = 'super-secret-access-key-value';

function resolvedConfig(
  overrides: Partial<ResolvedStorageConfig> = {},
): ResolvedStorageConfig {
  return {
    provider: 's3',
    bucket: 'my-bucket',
    region: 'us-west-2',
    accessKeyId: 'AKIAEXAMPLE',
    secretAccessKey: SECRET,
    forcePathStyle: false,
    ...overrides,
  };
}

describe('resolveStorageConfig', () => {
  // ===========================================================================
  // Requirements shared by every provider
  // ===========================================================================

  it('requires a bucket for every provider', () => {
    const result = resolveStorageConfig(policy({ bucket: '' }), SECRET);

    expect(result).toEqual({
      configured: false,
      provider: 's3',
      missing: ['bucket'],
    });
  });

  it('requires an access key id for every provider', () => {
    const result = resolveStorageConfig(policy({ accessKeyId: '' }), SECRET);

    expect(result).toEqual({
      configured: false,
      provider: 's3',
      missing: ['accessKeyId'],
    });
  });

  it('requires a secret access key for every provider (null: no row saved)', () => {
    const result = resolveStorageConfig(policy(), null);

    expect(result).toEqual({
      configured: false,
      provider: 's3',
      missing: ['secretAccessKey'],
    });
  });

  it('treats an empty-string secret exactly like a null one', () => {
    const result = resolveStorageConfig(policy(), '');

    expect(result).toEqual({
      configured: false,
      provider: 's3',
      missing: ['secretAccessKey'],
    });
  });

  it('treats a whitespace-only bucket as not configured (the schema already trims)', () => {
    // The schema stores '' for whitespace input; a caller handing this
    // function a raw '' (rather than a space) is what "never filled in" and
    // "cleared" both look like from here.
    const result = resolveStorageConfig(policy({ bucket: '' }), SECRET);

    expect(result.configured).toBe(false);
  });

  // ===========================================================================
  // Every missing field is reported, not just the first
  // ===========================================================================

  it('reports every missing field for s3, in form order', () => {
    const result = resolveStorageConfig(
      policy({ provider: 's3', bucket: '', region: '', accessKeyId: '' }),
      null,
    );

    expect(result).toEqual({
      configured: false,
      provider: 's3',
      missing: ['bucket', 'region', 'accessKeyId', 'secretAccessKey'],
    });
  });

  it('reports every missing field for r2, in form order', () => {
    const result = resolveStorageConfig(
      policy({
        provider: 'r2',
        bucket: '',
        accountId: '',
        endpoint: '',
        accessKeyId: '',
      }),
      null,
    );

    expect(result).toEqual({
      configured: false,
      provider: 'r2',
      missing: ['bucket', 'accountId', 'accessKeyId', 'secretAccessKey'],
    });
  });

  it('reports every missing field for s3compatible, in form order', () => {
    const result = resolveStorageConfig(
      policy({
        provider: 's3compatible',
        bucket: '',
        endpoint: '',
        accessKeyId: '',
      }),
      null,
    );

    expect(result).toEqual({
      configured: false,
      provider: 's3compatible',
      missing: ['bucket', 'endpoint', 'accessKeyId', 'secretAccessKey'],
    });
  });

  // ===========================================================================
  // Per-provider requirement
  // ===========================================================================

  describe('s3', () => {
    it('requires region', () => {
      const result = resolveStorageConfig(
        policy({ provider: 's3', region: '' }),
        SECRET,
      );

      expect(result).toEqual({
        configured: false,
        provider: 's3',
        missing: ['region'],
      });
    });

    it('does not require endpoint or accountId', () => {
      const result = resolveStorageConfig(
        policy({ provider: 's3', endpoint: '', accountId: '' }),
        SECRET,
      );

      expect(result.configured).toBe(true);
    });

    it('is configured with just bucket, region, accessKeyId and secret', () => {
      const result = resolveStorageConfig(
        policy({ provider: 's3', bucket: 'b', region: 'eu-west-1', accessKeyId: 'AK' }),
        SECRET,
      );

      expect(result).toEqual({
        configured: true,
        config: {
          provider: 's3',
          bucket: 'b',
          region: 'eu-west-1',
          accessKeyId: 'AK',
          secretAccessKey: SECRET,
          forcePathStyle: false,
        },
      });
    });
  });

  describe('r2', () => {
    it('requires accountId when no explicit endpoint was typed', () => {
      const result = resolveStorageConfig(
        policy({ provider: 'r2', accountId: '', endpoint: '' }),
        SECRET,
      );

      expect(result).toEqual({
        configured: false,
        provider: 'r2',
        missing: ['accountId'],
      });
    });

    it('does NOT require accountId when an explicit endpoint was typed', () => {
      const result = resolveStorageConfig(
        policy({
          provider: 'r2',
          accountId: '',
          endpoint: 'https://custom.example.com',
        }),
        SECRET,
      );

      expect(result.configured).toBe(true);
    });

    it('does not require region (falls back to auto)', () => {
      const result = resolveStorageConfig(
        policy({ provider: 'r2', accountId: 'acct-1', region: '' }),
        SECRET,
      );

      expect(result.configured).toBe(true);
      if (result.configured) {
        expect(result.config.region).toBe(R2_DEFAULT_REGION);
      }
    });
  });

  describe('s3compatible', () => {
    it('requires endpoint', () => {
      const result = resolveStorageConfig(
        policy({ provider: 's3compatible', endpoint: '' }),
        SECRET,
      );

      expect(result).toEqual({
        configured: false,
        provider: 's3compatible',
        missing: ['endpoint'],
      });
    });

    it('does not require accountId', () => {
      const result = resolveStorageConfig(
        policy({
          provider: 's3compatible',
          endpoint: 'https://minio.internal:9000',
          accountId: '',
        }),
        SECRET,
      );

      expect(result.configured).toBe(true);
    });
  });

  // ===========================================================================
  // Region fallbacks
  // ===========================================================================

  it('falls back region to "auto" for r2 when the operator left it empty', () => {
    const result = resolveStorageConfig(
      policy({ provider: 'r2', accountId: 'acct-1', region: '' }),
      SECRET,
    );

    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.config.region).toBe('auto');
      expect(result.config.region).toBe(R2_DEFAULT_REGION);
    }
  });

  it('falls back region to "us-east-1" for s3compatible when the operator left it empty', () => {
    const result = resolveStorageConfig(
      policy({
        provider: 's3compatible',
        endpoint: 'https://minio.internal:9000',
        region: '',
      }),
      SECRET,
    );

    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.config.region).toBe('us-east-1');
      expect(result.config.region).toBe(S3_COMPATIBLE_DEFAULT_REGION);
    }
  });

  it('does NOT fall back region for s3 (an empty region is a missing field instead)', () => {
    const result = resolveStorageConfig(
      policy({ provider: 's3', region: '' }),
      SECRET,
    );

    expect(result).toEqual({
      configured: false,
      provider: 's3',
      missing: ['region'],
    });
  });

  it('a region an operator typed always wins over the fallback (r2)', () => {
    const result = resolveStorageConfig(
      policy({ provider: 'r2', accountId: 'acct-1', region: 'eu' }),
      SECRET,
    );

    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.config.region).toBe('eu');
    }
  });

  // ===========================================================================
  // Endpoint precedence: explicit always wins
  // ===========================================================================

  it('derives the R2 endpoint from accountId when none was typed', () => {
    const result = resolveStorageConfig(
      policy({ provider: 'r2', accountId: 'my-account', endpoint: '' }),
      SECRET,
    );

    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.config.endpoint).toBe(
        `https://my-account.${R2_ENDPOINT_HOST_SUFFIX}`,
      );
    }
  });

  it('an explicitly typed endpoint always wins over the derived R2 one', () => {
    const result = resolveStorageConfig(
      policy({
        provider: 'r2',
        accountId: 'my-account',
        endpoint: 'https://typed-over-derived.example.com',
      }),
      SECRET,
    );

    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.config.endpoint).toBe(
        'https://typed-over-derived.example.com',
      );
    }
  });

  it('leaves endpoint absent (not empty-string) for plain s3 with none typed', () => {
    const result = resolveStorageConfig(
      policy({ provider: 's3', endpoint: '' }),
      SECRET,
    );

    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.config.endpoint).toBeUndefined();
      expect('endpoint' in result.config).toBe(false);
    }
  });

  it('passes an explicit s3 endpoint through untouched (pointing s3 at local MinIO)', () => {
    const result = resolveStorageConfig(
      policy({ provider: 's3', endpoint: 'http://localhost:9000' }),
      SECRET,
    );

    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.config.endpoint).toBe('http://localhost:9000');
    }
  });

  it('passes forcePathStyle through unchanged', () => {
    const result = resolveStorageConfig(
      policy({ forcePathStyle: true }),
      SECRET,
    );

    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.config.forcePathStyle).toBe(true);
    }
  });
});

describe('deriveR2Endpoint', () => {
  it('builds the account-scoped R2 origin', () => {
    expect(deriveR2Endpoint('abc123')).toBe(
      'https://abc123.r2.cloudflarestorage.com',
    );
  });

  it('never includes a bucket path segment after the account host', () => {
    // The bucket is addressed in the path/subdomain by the S3 client, not
    // baked into this host string.
    expect(deriveR2Endpoint('abc123')).toBe(
      `https://abc123.${R2_ENDPOINT_HOST_SUFFIX}`,
    );
    expect(deriveR2Endpoint('abc123').endsWith('/')).toBe(false);
  });
});

describe('fingerprintStorageConfig', () => {
  it('produces the same fingerprint for the same configuration', () => {
    const a = fingerprintStorageConfig(resolvedConfig());
    const b = fingerprintStorageConfig(resolvedConfig());

    expect(a).toBe(b);
  });

  it('produces a different fingerprint when the secret changes', () => {
    const original = fingerprintStorageConfig(
      resolvedConfig({ secretAccessKey: 'first-secret' }),
    );
    const rotated = fingerprintStorageConfig(
      resolvedConfig({ secretAccessKey: 'second-secret' }),
    );

    expect(rotated).not.toBe(original);
  });

  it('produces a different fingerprint when a non-secret field changes', () => {
    const a = fingerprintStorageConfig(resolvedConfig({ bucket: 'bucket-a' }));
    const b = fingerprintStorageConfig(resolvedConfig({ bucket: 'bucket-b' }));

    expect(a).not.toBe(b);
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
      resolvedConfig({ secretAccessKey: 'TOTALLY-SECRET-VALUE' }),
    );

    expect(description).not.toContain('TOTALLY-SECRET-VALUE');
  });

  it('describes an AWS-hosted s3 config by region, not endpoint', () => {
    const description = describeStorageConfig(
      resolvedConfig({
        provider: 's3',
        bucket: 'my-bucket',
        region: 'us-west-2',
        accessKeyId: 'AKIAEXAMPLE',
      }),
    );

    expect(description).toBe(
      's3 bucket=my-bucket at=us-west-2 (AWS) keyId=AKIAEXAMPLE',
    );
  });

  it('describes an endpoint-addressed config by its endpoint', () => {
    const description = describeStorageConfig(
      resolvedConfig({
        provider: 'r2',
        bucket: 'my-bucket',
        region: 'auto',
        endpoint: 'https://abc123.r2.cloudflarestorage.com',
        accessKeyId: 'AKIAEXAMPLE',
      }),
    );

    expect(description).toBe(
      'r2 bucket=my-bucket at=https://abc123.r2.cloudflarestorage.com keyId=AKIAEXAMPLE',
    );
  });

  it('includes the access key id (an identifier, not a secret)', () => {
    const description = describeStorageConfig(
      resolvedConfig({ accessKeyId: 'AKIA-IDENTIFIABLE' }),
    );

    expect(description).toContain('keyId=AKIA-IDENTIFIABLE');
  });
});

// =============================================================================
// ⚠ TEMPORARY BRIDGE — tests for the environment fallback (issue #377)
// =============================================================================
//
// Deleted wholesale by #377, with the code they cover. They exist because the
// bridge's whole risk is the one thing it must never do: let an environment
// variable win over, or be blended with, something an administrator saved. The
// all-or-nothing rule is therefore pinned from both sides — settings win when
// COMPLETE, and settings also win when INCOMPLETE (which is the dangerous
// case: a half-filled admin form beside a stale, complete environment).
// =============================================================================

/** The seeded, never-configured `storage` namespace — DEFAULT_SYSTEM_SETTINGS. */
function unconfiguredPolicy(
  overrides: Partial<SystemStorageValue> = {},
): SystemStorageValue {
  return {
    provider: 's3',
    bucket: '',
    region: '',
    endpoint: '',
    accountId: '',
    accessKeyId: '',
    forcePathStyle: false,
    ...overrides,
  };
}

function env(overrides: Partial<StorageEnvFallback> = {}): StorageEnvFallback {
  return {
    bucket: 'env-bucket',
    region: 'eu-central-1',
    endpoint: '',
    accessKeyId: 'ENV-AKIA',
    secretAccessKey: 'env-secret',
    ...overrides,
  };
}

describe('resolveStorageConfig — the temporary environment fallback (#377)', () => {
  // ===========================================================================
  // Saved settings always win
  // ===========================================================================

  describe('saved settings always win', () => {
    it('ignores the environment entirely when the settings are complete', () => {
      const result = resolveStorageConfig(policy(), SECRET, env());

      expect(result).toEqual({
        configured: true,
        config: {
          provider: 's3',
          bucket: 'my-bucket',
          region: 'us-west-2',
          accessKeyId: 'AKIAEXAMPLE',
          secretAccessKey: SECRET,
          forcePathStyle: false,
        },
      });
      // Not marked as coming from the environment, because it did not.
      expect('fromEnvironment' in result).toBe(false);
    });

    it('ignores the environment when the settings are only PARTLY saved', () => {
      // The dangerous case: an administrator has typed a bucket and has not yet
      // saved the credential. Completing that from a stale environment would
      // write bytes to a bucket nobody currently intends to use.
      const result = resolveStorageConfig(
        unconfiguredPolicy({ bucket: 'half-saved-bucket' }),
        null,
        env(),
      );

      expect(result).toEqual({
        configured: false,
        provider: 's3',
        missing: ['region', 'accessKeyId', 'secretAccessKey'],
      });
    });

    it('ignores the environment when ANY single settings field is saved', () => {
      for (const field of [
        'bucket',
        'region',
        'endpoint',
        'accountId',
        'accessKeyId',
      ] as const) {
        const result = resolveStorageConfig(
          unconfiguredPolicy({ [field]: 'something' }),
          null,
          env(),
        );

        expect(result.configured).toBe(false);
      }
    });

    it('ignores the environment when a secret is stored but no settings are', () => {
      // "Nothing configured through the database" means BOTH halves. A saved
      // credential with an unsaved bucket is still somebody mid-configuration.
      const result = resolveStorageConfig(unconfiguredPolicy(), SECRET, env());

      expect(result.configured).toBe(false);
    });

    it('never merges field by field: an env bucket cannot complete saved settings', () => {
      const result = resolveStorageConfig(
        unconfiguredPolicy({ region: 'us-west-1', accessKeyId: 'SAVED-AKIA' }),
        SECRET,
        env({ bucket: 'env-bucket' }),
      );

      expect(result).toEqual({
        configured: false,
        provider: 's3',
        missing: ['bucket'],
      });
    });
  });

  // ===========================================================================
  // The environment is used when nothing at all is saved
  // ===========================================================================

  describe('when nothing is saved', () => {
    it('resolves from the environment and marks the result', () => {
      const result = resolveStorageConfig(unconfiguredPolicy(), null, env());

      expect(result).toEqual({
        configured: true,
        fromEnvironment: true,
        config: {
          provider: 's3',
          bucket: 'env-bucket',
          region: 'eu-central-1',
          accessKeyId: 'ENV-AKIA',
          secretAccessKey: 'env-secret',
          forcePathStyle: false,
        },
      });
    });

    it('treats an empty-string stored secret as no stored secret', () => {
      const result = resolveStorageConfig(unconfiguredPolicy(), '', env());

      expect(result.configured).toBe(true);
    });

    it('is not consulted at all when no environment is passed (the #377 end state)', () => {
      const result = resolveStorageConfig(unconfiguredPolicy(), null);

      expect(result.configured).toBe(false);
    });

    it('never mutates the settings value it was handed (it writes nothing back)', () => {
      const saved = unconfiguredPolicy();

      resolveStorageConfig(saved, null, env({ endpoint: 'https://minio:9000' }));

      expect(saved).toEqual(unconfiguredPolicy());
    });
  });

  // ===========================================================================
  // A partial environment is NOT a usable configuration
  // ===========================================================================

  describe('a partial environment', () => {
    it('does not produce a config when the secret is missing', () => {
      const result = resolveStorageConfig(
        unconfiguredPolicy(),
        null,
        env({ secretAccessKey: '' }),
      );

      expect(result.configured).toBe(false);
    });

    it('does not produce a config when the bucket is missing', () => {
      const result = resolveStorageConfig(
        unconfiguredPolicy(),
        null,
        env({ bucket: '' }),
      );

      expect(result.configured).toBe(false);
    });

    it('does not produce a config when the access key id is missing', () => {
      const result = resolveStorageConfig(
        unconfiguredPolicy(),
        null,
        env({ accessKeyId: '' }),
      );

      expect(result.configured).toBe(false);
    });

    it('reports EXACTLY what it would have reported with no environment at all', () => {
      // The bridge can only ever add a success. A half-set environment must not
      // change the missing-field list a deployment is shown, or the message an
      // operator sees would depend on which unrelated variable happens to be
      // exported in their shell.
      const withoutEnv = resolveStorageConfig(unconfiguredPolicy(), null);
      const withPartialEnv = resolveStorageConfig(
        unconfiguredPolicy(),
        null,
        env({ secretAccessKey: '' }),
      );

      expect(withPartialEnv).toEqual(withoutEnv);
    });

    it('does not produce a config from an entirely empty environment', () => {
      const result = resolveStorageConfig(
        unconfiguredPolicy(),
        null,
        readStorageEnvFallback({}),
      );

      expect(result.configured).toBe(false);
    });
  });

  // ===========================================================================
  // Provider derivation — the pre-#373 `forcePathStyle: !!endpoint` behaviour
  // ===========================================================================

  describe('provider derivation', () => {
    it('yields s3compatible with path-style addressing when an endpoint is set', () => {
      const result = resolveStorageConfig(
        unconfiguredPolicy(),
        null,
        env({ endpoint: 'https://minio.internal:9000' }),
      );

      expect(result.configured).toBe(true);
      if (result.configured) {
        expect(result.config.provider).toBe('s3compatible');
        expect(result.config.endpoint).toBe('https://minio.internal:9000');
        expect(result.config.forcePathStyle).toBe(true);
      }
    });

    it('yields plain s3, with no endpoint and no path-style, when none is set', () => {
      const result = resolveStorageConfig(
        unconfiguredPolicy(),
        null,
        env({ endpoint: '' }),
      );

      expect(result.configured).toBe(true);
      if (result.configured) {
        expect(result.config.provider).toBe('s3');
        expect(result.config.forcePathStyle).toBe(false);
        expect('endpoint' in result.config).toBe(false);
      }
    });
  });

  // ===========================================================================
  // Region: the pre-#373 `S3_REGION || 'us-east-1'` default
  // ===========================================================================

  describe('region', () => {
    it('defaults to us-east-1 when S3_REGION is unset, as configuration.ts did', () => {
      const result = resolveStorageConfig(
        unconfiguredPolicy(),
        null,
        env({ region: '' }),
      );

      expect(result.configured).toBe(true);
      if (result.configured) {
        expect(result.config.region).toBe(STORAGE_ENV_FALLBACK_DEFAULT_REGION);
        expect(result.config.region).toBe('us-east-1');
      }
    });

    it('uses a region the operator did set', () => {
      const result = resolveStorageConfig(
        unconfiguredPolicy(),
        null,
        env({ region: 'ap-southeast-2' }),
      );

      expect(result.configured).toBe(true);
      if (result.configured) {
        expect(result.config.region).toBe('ap-southeast-2');
      }
    });
  });
});

describe('readStorageEnvFallback (#377)', () => {
  it('reads the five pre-#373 variables', () => {
    expect(
      readStorageEnvFallback({
        S3_BUCKET: 'b',
        S3_REGION: 'r',
        S3_ENDPOINT: 'e',
        AWS_ACCESS_KEY_ID: 'k',
        AWS_SECRET_ACCESS_KEY: 's',
      }),
    ).toEqual({
      bucket: 'b',
      region: 'r',
      endpoint: 'e',
      accessKeyId: 'k',
      secretAccessKey: 's',
    });
  });

  it('reads an absent variable as the empty string, never undefined', () => {
    expect(readStorageEnvFallback({})).toEqual({
      bucket: '',
      region: '',
      endpoint: '',
      accessKeyId: '',
      secretAccessKey: '',
    });
  });

  it('trims, so a variable set to whitespace is "not set" (as the schema does)', () => {
    expect(readStorageEnvFallback({ S3_BUCKET: '  spaced  ' }).bucket).toBe(
      'spaced',
    );
    expect(readStorageEnvFallback({ S3_BUCKET: '   ' }).bucket).toBe('');
  });

  it('reads nothing but the five (no STORAGE_PROVIDER, no account id)', () => {
    const parsed = readStorageEnvFallback({ STORAGE_PROVIDER: 'r2' });

    expect(Object.keys(parsed).sort()).toEqual([
      'accessKeyId',
      'bucket',
      'endpoint',
      'region',
      'secretAccessKey',
    ]);
  });
});

describe('hasSavedStorageSettings (#377)', () => {
  it('is false for the seeded, never-configured namespace', () => {
    expect(hasSavedStorageSettings(unconfiguredPolicy())).toBe(false);
  });

  it('is true when any single string field carries a value', () => {
    for (const field of [
      'bucket',
      'region',
      'endpoint',
      'accountId',
      'accessKeyId',
    ] as const) {
      expect(
        hasSavedStorageSettings(unconfiguredPolicy({ [field]: 'x' })),
      ).toBe(true);
    }
  });

  it('ignores provider and forcePathStyle, which always carry a value', () => {
    expect(hasSavedStorageSettings(unconfiguredPolicy({ provider: 'r2' }))).toBe(
      false,
    );
    expect(
      hasSavedStorageSettings(unconfiguredPolicy({ forcePathStyle: true })),
    ).toBe(false);
  });
});

describe('storageEnvFallbackPolicy (#377)', () => {
  it('maps the environment onto the settings shape, endpoint-addressed', () => {
    expect(
      storageEnvFallbackPolicy(env({ endpoint: 'https://minio:9000' })),
    ).toEqual({
      provider: 's3compatible',
      bucket: 'env-bucket',
      region: 'eu-central-1',
      endpoint: 'https://minio:9000',
      accountId: '',
      accessKeyId: 'ENV-AKIA',
      forcePathStyle: true,
    });
  });

  it('maps the environment onto the settings shape, AWS-hosted', () => {
    expect(storageEnvFallbackPolicy(env())).toEqual({
      provider: 's3',
      bucket: 'env-bucket',
      region: 'eu-central-1',
      endpoint: '',
      accountId: '',
      accessKeyId: 'ENV-AKIA',
      forcePathStyle: false,
    });
  });

  it('never invents an accountId (the environment path had no R2 derivation)', () => {
    expect(storageEnvFallbackPolicy(env()).accountId).toBe('');
  });
});
