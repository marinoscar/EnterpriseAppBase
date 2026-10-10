/**
 * The storage-config wire contract (issue #376, epic #372).
 *
 * The failure mode of a thin client is not a crash — it is a request that is
 * quietly the wrong shape and a 400 the page reports as "Failed to save the
 * storage configuration". So each of the four routes is exercised against the
 * platform test host (moved from the reference app's msw test in #736) and the
 * REQUEST is asserted: method, path, If-Match, body.
 *
 * Three of those assertions are load-bearing rather than routine:
 *
 *   1. `If-Match: 0` IS SENT. The check is `expectedVersion === undefined`,
 *      never a truthiness test, so the first save on a fresh deployment still
 *      asserts "nothing is stored yet" instead of being the one unguarded write.
 *
 *   2. `forcePathStyle: null` SURVIVES SERIALISATION. It is the tri-state's
 *      whole point, and `JSON.stringify` drops `undefined` while keeping
 *      `null` — a conversion that turned one into the other would silently
 *      hand the API an explicit `false` nobody chose (#374's bug).
 *
 *   3. A BAD DIAGNOSIS STILL RESOLVES. Both probes answer 200 carrying the
 *      answer; a client that threw on `success: false` would make the page's
 *      entire reason for existing unreachable.
 *
 * The confirmation literal and the value lists are checked against the wire
 * contract the API validates with (`@marinoscar/platform-contract/storage`,
 * #736) rather than against a copy: a dialog comparing against a drifted
 * literal would offer a confirmation the API will refuse.
 */

import { describe, it, expect } from 'vitest';
import {
  provisionStorageBucketSchema,
  storageBucketProvisionResultSchema,
  storageConfigResponseSchema,
  storageConnectionCheckSchema,
  storageConnectionTestResultSchema,
  testStorageConfigSchema,
  updateStorageConfigSchema,
} from '@marinoscar/platform-contract/storage';

import {
  BUILTIN_STORAGE_PROVIDER_KINDS,
  MISSING_STORAGE_CONFIG_FIELDS,
  STORAGE_BUCKET_OUTCOMES,
  STORAGE_PROVIDER_KINDS,
  STORAGE_SWITCH_CONFIRMATION,
  STORAGE_TEST_CHECK_CODES,
  createStorageConfigClient,
  reportsBucketMissing,
} from '../../src/storage/headless/index.js';
import type {
  StorageConfigInput,
  StorageConfigView,
  StorageConnectionTestResult,
} from '../../src/storage/headless/index.js';
import { createTestPlatformHost, type TestPlatformHost } from '../../src/testing/index.js';
import { storageConfigFixture, storageConfigWithCustomDrivers } from './fixtures.js';

const storedConfig: StorageConfigView = storageConfigFixture({
  provider: 's3compatible',
  bucket: 'app-objects',
  endpoint: 'https://minio.example.com:9000',
  effectiveEndpoint: 'https://minio.example.com:9000',
  version: 7,
});

const input: StorageConfigInput = {
  provider: 's3compatible',
  bucket: 'app-objects',
  region: 'us-east-1',
  endpoint: 'https://minio.example.com:9000',
  accountId: '',
  accessKeyId: 'AKIAEXAMPLE',
  forcePathStyle: null,
};

/** A host answering every storage-config route with `response`; its `requests` are what the client sent. */
function hostFor(response: unknown): TestPlatformHost {
  return createTestPlatformHost({
    responses: {
      'GET /admin/storage-config': response,
      'PUT /admin/storage-config': response,
      'POST /admin/storage-config/test': response,
      'POST /admin/storage-config/bucket': response,
    },
  });
}

/** The body and If-Match of the last request the host received. */
function last(host: TestPlatformHost): { body: Record<string, unknown>; ifMatch: string | null } {
  const request = host.requests.at(-1)!;
  return { body: request.body as Record<string, unknown>, ifMatch: request.ifMatch ?? null };
}

describe('the storage-config client — the wire contract', () => {
  it('GET reads /admin/storage-config and unwraps the envelope', async () => {
    const host = hostFor(storedConfig);

    await expect(createStorageConfigClient(host.api).get()).resolves.toEqual(storedConfig);
    expect(host.requests.at(-1)).toMatchObject({ method: 'GET', path: '/admin/storage-config' });
  });

  it('PUT sends the body as given and the current version as If-Match', async () => {
    const capturedHost = hostFor(storedConfig);

    await createStorageConfigClient(capturedHost.api).update(input, 7);

    expect(last(capturedHost).ifMatch).toBe('7');
    expect(last(capturedHost).body).toEqual(input);
    // No confirmation unless it was asked for.
    expect(last(capturedHost).body).not.toHaveProperty('confirmation');
  });

  it('sends If-Match: 0, because 0 is an assertion and not an absence', async () => {
    const capturedHost = hostFor(storedConfig);

    await createStorageConfigClient(capturedHost.api).update(input, 0);

    expect(last(capturedHost).ifMatch).toBe('0');
  });

  it('omits If-Match entirely when no version is given', async () => {
    const capturedHost = hostFor(storedConfig);

    await createStorageConfigClient(capturedHost.api).update(input);

    expect(last(capturedHost).ifMatch).toBeNull();
  });

  it('adds the SWITCH literal only when the caller confirms', async () => {
    const capturedHost = hostFor(storedConfig);

    await createStorageConfigClient(capturedHost.api).update(input, 7, { confirmSwitch: true });

    expect(last(capturedHost).body.confirmation).toBe(STORAGE_SWITCH_CONFIRMATION);
  });

  it('serialises forcePathStyle: null as null, never dropping it', async () => {
    const capturedHost = hostFor(storedConfig);

    await createStorageConfigClient(capturedHost.api).update({ ...input, forcePathStyle: null }, 7);

    expect(Object.prototype.hasOwnProperty.call(last(capturedHost).body, 'forcePathStyle')).toBe(true);
    expect(last(capturedHost).body.forcePathStyle).toBeNull();
  });

  it('carries an explicit false through as false', async () => {
    const capturedHost = hostFor(storedConfig);

    await createStorageConfigClient(capturedHost.api).update({ ...input, forcePathStyle: false }, 7);

    expect(last(capturedHost).body.forcePathStyle).toBe(false);
  });

  it('posts the submitted configuration to /test, and resolves a FAILED diagnosis rather than throwing', async () => {
    const failing: StorageConnectionTestResult = {
      success: false,
      provider: 's3compatible',
      bucket: 'app-objects',
      region: 'us-east-1',
      effectiveEndpoint: 'https://minio.example.com:9000',
      usedStoredSecret: true,
      checks: [
        {
          id: 'bucket',
          label: 'Bucket',
          status: 'failed',
          code: 'bucket_missing',
          detail: 'No such bucket.',
          error: 'NoSuchBucket',
        },
      ],
      attemptedAt: '2026-01-01T00:00:00.000Z',
    };
    const capturedHost = hostFor(failing);

    const result = await createStorageConfigClient(capturedHost.api).test(input);

    expect(last(capturedHost).body).toEqual(input);
    expect(result.success).toBe(false);
  });

  it('posts to /bucket, and resolves a GUIDED outcome rather than throwing', async () => {
    const guided = {
      outcome: 'guided',
      provider: 's3compatible',
      bucket: 'app-objects',
      region: 'us-east-1',
      effectiveEndpoint: 'https://minio.example.com:9000',
      steps: [],
      guidance: {
        reason: 'This credential cannot create buckets.',
        commands: 'aws s3api create-bucket --bucket app-objects',
        runbook: null,
      },
      corsOrigin: null,
      attemptedAt: '2026-01-01T00:00:00.000Z',
    };
    const capturedHost = hostFor(guided);

    const result = await createStorageConfigClient(capturedHost.api).provisionBucket(input);

    expect(last(capturedHost).body).toEqual(input);
    expect(result.outcome).toBe('guided');
    expect(result.guidance?.commands).toContain('create-bucket');
  });

  it('omits secretAccessKey when the caller did not supply one, and sends it when they did', async () => {
    const blankHost = hostFor(storedConfig);
    await createStorageConfigClient(blankHost.api).update(input, 7);
    expect(Object.prototype.hasOwnProperty.call(last(blankHost).body, 'secretAccessKey')).toBe(false);

    const typedHost = hostFor(storedConfig);
    await createStorageConfigClient(typedHost.api).update({ ...input, secretAccessKey: 'typed-secret' }, 7);
    expect(last(typedHost).body.secretAccessKey).toBe('typed-secret');
  });
});

describe('the storage-config client — pluggable drivers (PP-14.7)', () => {
  const driverInput: StorageConfigInput = {
    provider: 'local-fs',
    drivers: { 'local-fs': { directory: '/var/lib/objects' }, s3: null },
    secrets: { 'vault-blob': { connectionString: 'typed-secret' } },
  };

  it('PUT carries provider, drivers (a null resets a driver) and write-only secrets, and nothing flat', async () => {
    const host = hostFor(storedConfig);

    await createStorageConfigClient(host.api).update(driverInput, 7);

    expect(last(host).body).toEqual(driverInput);
    expect(last(host).body.drivers).toHaveProperty('s3', null);
    expect(last(host).body).not.toHaveProperty('bucket');
    expect(last(host).body).not.toHaveProperty('secretAccessKey');
  });

  it('POST /test and POST /bucket take the same body', async () => {
    const testHost = hostFor({ success: true });
    await createStorageConfigClient(testHost.api).test(driverInput);
    expect(testHost.requests.at(-1)).toMatchObject({ method: 'POST', path: '/admin/storage-config/test' });
    expect(last(testHost).body).toEqual(driverInput);

    const bucketHost = hostFor({ outcome: 'failed' });
    await createStorageConfigClient(bucketHost.api).provisionBucket(driverInput);
    expect(last(bucketHost).body).toEqual(driverInput);
  });

  it('the bodies the client builds are accepted by the API schemas', () => {
    expect(updateStorageConfigSchema.safeParse({ ...driverInput, confirmation: STORAGE_SWITCH_CONFIRMATION }).success).toBe(true);
    expect(testStorageConfigSchema.safeParse(driverInput).success).toBe(true);
    expect(provisionStorageBucketSchema.safeParse(driverInput).success).toBe(true);
    // Only `provider` is required.
    expect(updateStorageConfigSchema.safeParse({ provider: 'local-fs' }).success).toBe(true);
  });

  it('the view types match what the API serves: drivers, descriptors and string[] missing', () => {
    const view = storageConfigWithCustomDrivers({ missing: ['directory', 'connectionString'] });

    const parsed = storageConfigResponseSchema.parse(view);

    expect(Object.keys(parsed.drivers)).toEqual(['s3', 'r2', 's3compatible', 'local-fs', 'vault-blob']);
    expect(parsed.descriptors.map((descriptor) => descriptor.id)).toEqual(['s3', 'r2', 's3compatible', 'local-fs', 'vault-blob']);
    expect(parsed.missing).toEqual(['directory', 'connectionString']);
  });

  it('a descriptor secret carries presence only — no value, in the type or on the wire', () => {
    const view = storageConfigWithCustomDrivers();
    const vault = view.descriptors.find((descriptor) => descriptor.id === 'vault-blob')!;
    const secret = vault.fields.find((field) => field.kind === 'secret')!;

    expect(Object.keys(secret).sort()).toEqual(['hasValue', 'kind', 'label', 'name', 'required']);
  });

  it('a test result of a driver with no checks carries message and details', () => {
    const result: StorageConnectionTestResult = {
      success: true,
      provider: 'local-fs',
      bucket: '/var/lib/objects',
      region: '',
      effectiveEndpoint: null,
      usedStoredSecret: false,
      checks: [],
      message: 'Wrote, read and deleted a probe file.',
      details: { directory: '/var/lib/objects', free: 12, writable: true },
      attemptedAt: '2026-01-01T00:00:00.000Z',
    };

    expect(storageConnectionTestResultSchema.safeParse(result).success).toBe(true);
    expect(reportsBucketMissing(result)).toBe(false);
  });

  it('a provisioning result of a driver that cannot provision carries a message and skipped steps', () => {
    const result = {
      outcome: 'failed',
      provider: 'local-fs',
      bucket: '/var/lib/objects',
      region: '',
      effectiveEndpoint: null,
      steps: [{ id: 'create', label: 'Create', status: 'skipped', detail: 'Not supported.', error: null }],
      message: 'The local-fs driver cannot create its folder.',
      guidance: null,
      corsOrigin: null,
      attemptedAt: '2026-01-01T00:00:00.000Z',
    };

    expect(storageBucketProvisionResultSchema.safeParse(result).success).toBe(true);
  });
});

describe('reportsBucketMissing', () => {
  function withCode(code: string): StorageConnectionTestResult {
    return {
      success: false,
      provider: 's3',
      bucket: 'b',
      region: 'us-east-1',
      effectiveEndpoint: null,
      usedStoredSecret: true,
      checks: [
        {
          id: 'bucket',
          label: 'Bucket',
          status: 'failed',
          code: code as StorageConnectionTestResult['checks'][number]['code'],
          detail: '',
          error: null,
        },
      ],
      attemptedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  it('is true only for bucket_missing', () => {
    expect(reportsBucketMissing(withCode('bucket_missing'))).toBe(true);
  });

  it('is FALSE for bucket_forbidden — the two need opposite actions', () => {
    // 403 means the bucket exists and this key may not see it. Offering to
    // create it would send an admin to make a bucket that is already there and
    // is not theirs. This is the single assertion that keeps the two apart.
    expect(reportsBucketMissing(withCode('bucket_forbidden'))).toBe(false);
  });

  it('is false for no result at all', () => {
    expect(reportsBucketMissing(null)).toBe(false);
  });
});

describe('the constants mirror the wire contract the API validates with', () => {
  it('uses the API’s own confirmation literal', () => {
    expect(updateStorageConfigSchema.shape.confirmation.unwrap().value).toBe(STORAGE_SWITCH_CONFIRMATION);
  });

  it('lists the built-in drivers, and the API accepts any registered driver id besides', () => {
    expect([...BUILTIN_STORAGE_PROVIDER_KINDS]).toEqual(['s3', 'r2', 's3compatible']);
    // The deprecated alias stays.
    expect([...STORAGE_PROVIDER_KINDS]).toEqual([...BUILTIN_STORAGE_PROVIDER_KINDS]);
    for (const id of [...BUILTIN_STORAGE_PROVIDER_KINDS, 'local-fs', 'azure-blob']) {
      expect(updateStorageConfigSchema.shape.provider.safeParse(id).success).toBe(true);
    }
    expect(updateStorageConfigSchema.shape.provider.safeParse('Not An Id').success).toBe(false);
  });

  it('lists every check code the API can report, bucket_missing and bucket_forbidden included', () => {
    expect([...STORAGE_TEST_CHECK_CODES]).toEqual(storageConnectionCheckSchema.shape.code.options);
    expect(STORAGE_TEST_CHECK_CODES).toContain('bucket_missing');
    expect(STORAGE_TEST_CHECK_CODES).toContain('bucket_forbidden');
  });

  it('lists every bucket outcome, including guided', () => {
    expect([...STORAGE_BUCKET_OUTCOMES]).toEqual(storageBucketProvisionResultSchema.shape.outcome.options);
  });

  it('keeps the built-ins\' missing-field vocabulary; the API reports any driver\'s as strings', () => {
    expect([...MISSING_STORAGE_CONFIG_FIELDS]).toEqual(['bucket', 'region', 'endpoint', 'accountId', 'accessKeyId', 'secretAccessKey']);
    expect(storageConfigResponseSchema.shape.missing.element.safeParse('directory').success).toBe(true);
  });
});
