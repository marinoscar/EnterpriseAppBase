// =============================================================================
// The built-in S3 drivers run the storage driver conformance kit (PP-14.7, #925)
// =============================================================================
//
// `s3`, `r2` and `s3compatible` are registered through `registerStorageDriver`
// exactly as an app's driver is, so they run the same kit. The AWS SDK is
// mocked at the module level, as in every other S3 spec here
// (`s3-storage.provider.spec.ts`, `storage-connection-test.service.spec.ts`),
// but STATEFUL this time: one in-memory bucket behind `S3Client.send`, the
// multipart `Upload` and the presigner, so the kit can put and read real bytes.
// Nothing here opens a socket.
// =============================================================================

import { Readable } from 'node:stream';

const VALID_SECRET = 'valid-secret-access-key-0123456789';

/** One in-memory bucket, shared by every client built in this file. */
const mockStore = new Map<string, { body: Buffer; metadata: Record<string, string> }>();

function mockNotFound(): Error {
  const error = new Error('NotFound');
  error.name = 'NotFound';
  (error as unknown as { $metadata: unknown }).$metadata = { httpStatusCode: 404 };
  return error;
}

jest.mock('@aws-sdk/client-s3', () => {
  const command = (name: string) =>
    jest.fn().mockImplementation((input: unknown) => ({ __command: name, input }));

  class MockNotFound extends Error {
    readonly name = 'NotFound';
  }

  return {
    S3Client: jest.fn().mockImplementation((config: { credentials?: { secretAccessKey?: string } }) => ({
      destroy: jest.fn(),
      async send(cmd: { __command: string; input: Record<string, any> }) {
        // A wrong secret is refused the way S3 refuses it, with the secret
        // echoed into the text: the driver must scrub it before it is shown.
        if (config.credentials?.secretAccessKey !== 'valid-secret-access-key-0123456789') {
          const error = new Error(`SignatureDoesNotMatch: signed with ${config.credentials?.secretAccessKey ?? 'nothing'}`);
          error.name = 'SignatureDoesNotMatch';
          (error as unknown as { $metadata: unknown }).$metadata = { httpStatusCode: 403 };
          throw error;
        }

        const { Key, Prefix, Body, Metadata } = cmd.input;

        switch (cmd.__command) {
          case 'HeadBucketCommand':
          case 'CreateBucketCommand':
          case 'PutBucketCorsCommand':
          case 'PutBucketEncryptionCommand':
          case 'PutPublicAccessBlockCommand':
          case 'GetBucketVersioningCommand':
            return {};
          case 'ListBucketsCommand':
            return { Buckets: [] };
          case 'PutObjectCommand':
            mockStore.set(Key, { body: Buffer.from(Body), metadata: Metadata ?? {} });
            return { ETag: '"put"' };
          case 'GetObjectCommand': {
            const entry = mockStore.get(Key);
            if (!entry) throw mockNotFound();
            const stream = Readable.from([entry.body]);
            return { Body: Object.assign(stream, { transformToString: async () => entry.body.toString() }) };
          }
          case 'HeadObjectCommand': {
            const entry = mockStore.get(Key);
            if (!entry) throw mockNotFound();
            return { Metadata: entry.metadata };
          }
          case 'DeleteObjectCommand':
            mockStore.delete(Key);
            return {};
          case 'ListObjectsV2Command':
            return {
              Contents: [...mockStore.keys()].filter((key) => key.startsWith(Prefix)).map((key) => ({ Key: key, Size: mockStore.get(key)?.body.length })),
              IsTruncated: false,
            };
          default:
            throw new Error(`The fake S3 does not implement ${cmd.__command}`);
        }
      },
    })),
    HeadBucketCommand: command('HeadBucketCommand'),
    ListBucketsCommand: command('ListBucketsCommand'),
    PutObjectCommand: command('PutObjectCommand'),
    GetObjectCommand: command('GetObjectCommand'),
    DeleteObjectCommand: command('DeleteObjectCommand'),
    HeadObjectCommand: command('HeadObjectCommand'),
    CopyObjectCommand: command('CopyObjectCommand'),
    CreateMultipartUploadCommand: command('CreateMultipartUploadCommand'),
    UploadPartCommand: command('UploadPartCommand'),
    CompleteMultipartUploadCommand: command('CompleteMultipartUploadCommand'),
    AbortMultipartUploadCommand: command('AbortMultipartUploadCommand'),
    CreateBucketCommand: command('CreateBucketCommand'),
    PutBucketCorsCommand: command('PutBucketCorsCommand'),
    PutBucketEncryptionCommand: command('PutBucketEncryptionCommand'),
    PutPublicAccessBlockCommand: command('PutPublicAccessBlockCommand'),
    GetBucketVersioningCommand: command('GetBucketVersioningCommand'),
    ListObjectsV2Command: command('ListObjectsV2Command'),
    NotFound: MockNotFound,
  };
});

// The multipart `Upload` consumes the stream the way the real one does (part by
// part), then stores the bytes.
jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn().mockImplementation((options: { params: { Key: string; Body: Readable; Metadata?: Record<string, string> } }) => ({
    async done() {
      const parts: Buffer[] = [];
      for await (const chunk of options.params.Body) parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      mockStore.set(options.params.Key, { body: Buffer.concat(parts), metadata: options.params.Metadata ?? {} });
      return { Location: `https://fake.s3/${options.params.Key}`, ETag: '"multipart"' };
    },
  })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(async (_client: unknown, command: { input: { Key: string } }) => `https://conformance-bucket.s3.amazonaws.com/${command.input.Key}?X-Amz-Signature=fake`),
}));

import { describeStorageDriverConformance } from '../../../../src/storage/testing/driver-conformance';
import { BUILTIN_STORAGE_DRIVERS } from '../../../../src/storage/drivers/builtin-storage-drivers';

const SETTINGS: Record<string, Record<string, unknown>> = {
  s3: { bucket: 'conformance-bucket', region: 'us-east-1', accessKeyId: 'AKIACONFORMANCE' },
  r2: { bucket: 'conformance-bucket', accountId: 'acct123', accessKeyId: 'AKIACONFORMANCE' },
  s3compatible: { bucket: 'conformance-bucket', endpoint: 'http://minio:9000', accessKeyId: 'AKIACONFORMANCE' },
};

beforeEach(() => {
  mockStore.clear();
  // The presigned URL the connection test fetches is served from the fake bucket.
  global.fetch = jest.fn(async (url: string) => {
    const key = decodeURIComponent(new URL(url).pathname.slice(1));
    const entry = mockStore.get(key);
    return entry
      ? ({ ok: true, status: 200, text: async () => entry.body.toString() } as Response)
      : ({ ok: false, status: 404, text: async () => 'NoSuchKey' } as Response);
  }) as unknown as typeof fetch;
});

describe('the built-in S3 drivers', () => {
  it('registers exactly s3, r2 and s3compatible through registerStorageDriver', () => {
    expect(BUILTIN_STORAGE_DRIVERS.map((driver) => driver.id)).toEqual(['s3', 'r2', 's3compatible']);
  });
});

for (const driver of BUILTIN_STORAGE_DRIVERS) {
  describeStorageDriverConformance(driver, {
    describe,
    it,
    expect,
    settings: SETTINGS[driver.id],
    secrets: { secretAccessKey: VALID_SECRET },
    // The fake presigner answers any key; the kit also reads the bytes back through the same fake.
    readSignedUrl: async (url) => {
      const key = decodeURIComponent(new URL(url).pathname.slice(1));
      return (mockStore.get(key)?.body ?? Buffer.alloc(0)) as Buffer;
    },
  });
}
