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
  storageBucketProvisionResultSchema,
  storageConfigResponseSchema,
  storageConnectionCheckSchema,
  updateStorageConfigSchema,
} from '@marinoscar/platform-contract/storage';

import {
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

const storedConfig: StorageConfigView = {
  provider: 's3compatible',
  bucket: 'app-objects',
  region: 'us-east-1',
  endpoint: 'https://minio.example.com:9000',
  accountId: '',
  accessKeyId: 'AKIAEXAMPLE',
  forcePathStyle: null,
  effectiveEndpoint: 'https://minio.example.com:9000',
  configured: true,
  missing: [],
  secretStatus: {
    configured: true,
    hint: '••••ab12',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedByUserId: 'admin-user-id',
  },
  version: 7,
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedBy: { id: 'admin-user-id', email: 'admin@example.com' },
};

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

  it('PUT sends the seven fields and the current version as If-Match', async () => {
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

  it('lists every provider kind the API accepts', () => {
    expect([...STORAGE_PROVIDER_KINDS]).toEqual(updateStorageConfigSchema.shape.provider.options);
    expect([...STORAGE_PROVIDER_KINDS]).toEqual(['s3', 'r2', 's3compatible']);
  });

  it('lists every check code the API can report, bucket_missing and bucket_forbidden included', () => {
    expect([...STORAGE_TEST_CHECK_CODES]).toEqual(storageConnectionCheckSchema.shape.code.options);
    expect(STORAGE_TEST_CHECK_CODES).toContain('bucket_missing');
    expect(STORAGE_TEST_CHECK_CODES).toContain('bucket_forbidden');
  });

  it('lists every bucket outcome, including guided', () => {
    expect([...STORAGE_BUCKET_OUTCOMES]).toEqual(storageBucketProvisionResultSchema.shape.outcome.options);
  });

  it('lists every field the API can report as missing', () => {
    expect([...MISSING_STORAGE_CONFIG_FIELDS]).toEqual(storageConfigResponseSchema.shape.missing.element.options);
  });
});
