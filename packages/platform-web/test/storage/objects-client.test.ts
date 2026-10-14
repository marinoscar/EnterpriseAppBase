// The storage objects client (#736): the objects API over the app's
// transport. The simple upload goes multipart through `postFormData`; the
// resumable upload's four calls hit their routes; the wait polls until
// `ready` and refuses `failed` and a timeout.
import { describe, expect, it, vi } from 'vitest';

import { StorageObjectNotReadyError, createStorageObjectsClient } from '../../src/storage/headless/index.js';
import type { StorageObject, StorageObjectsTransport } from '../../src/storage/headless/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';

const object = (status: StorageObject['status']): StorageObject => ({
  id: 'obj 1',
  name: 'a.png',
  size: '1',
  mimeType: 'image/png',
  status,
  metadata: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('createStorageObjectsClient', () => {
  it('uploads multipart through postFormData, then polls until the object is ready', async () => {
    const get = vi.fn().mockResolvedValueOnce(object('processing')).mockResolvedValueOnce(object('ready'));
    const postFormData = vi.fn().mockResolvedValue(object('processing'));
    const api = { get, post: vi.fn(), delete: vi.fn(), postFormData } as unknown as StorageObjectsTransport;

    const ready = await createStorageObjectsClient(api).uploadAndWait(new Blob(['x']), { intervalMs: 1, filename: 'a.png' });

    expect(ready.status).toBe('ready');
    expect(postFormData).toHaveBeenCalledWith('/storage/objects', expect.any(FormData));
    expect((postFormData.mock.calls[0]![1] as FormData).get('file')).toBeInstanceOf(Blob);
    expect(get).toHaveBeenCalledWith('/storage/objects/obj%201');
  });

  it('refuses the simple upload on a transport without postFormData', async () => {
    const { postFormData: _omitted, ...api } = createTestPlatformHost().api;
    await expect(createStorageObjectsClient(api).upload(new Blob(['x']))).rejects.toThrow(/multipart/);
  });

  it('throws StorageObjectNotReadyError for a failed object and after the timeout', async () => {
    const client = createStorageObjectsClient(createTestPlatformHost({ responses: { 'GET /storage/objects/obj%201': object('processing') } }).api);

    await expect(client.waitForReady(object('failed'))).rejects.toEqual(new StorageObjectNotReadyError('obj 1', 'failed'));
    await expect(client.waitForReady(object('processing'), { intervalMs: 1, timeoutMs: 5 })).rejects.toMatchObject({
      name: 'StorageObjectNotReadyError',
      status: 'timeout',
    });
  });

  it('calls the resumable-upload, download, delete and status routes', async () => {
    const host = createTestPlatformHost({
      responses: {
        'POST /storage/objects/upload/init': { objectId: 'o1', uploadId: 'u1', partSize: 5, totalParts: 1, presignedUrls: [] },
        'GET /storage/objects/o1/upload/status': { objectId: 'o1', status: 'pending', uploadedParts: [], totalParts: 1, uploadedBytes: '0', totalBytes: '5' },
        'POST /storage/objects/o1/upload/complete': object('ready'),
        'DELETE /storage/objects/o1/upload/abort': null,
        'GET /storage/objects/o1/download': { url: 'https://signed.example/o1', expiresIn: 60 },
        'DELETE /storage/objects/o1': null,
        'GET /storage/status': { configured: true },
      },
    });
    const client = createStorageObjectsClient(host.api);

    await client.initUpload({ name: 'a.bin', size: 5, mimeType: 'application/octet-stream' });
    await client.uploadStatus('o1');
    await client.completeUpload('o1', { parts: [{ partNumber: 1, eTag: '"e"' }] });
    await client.abortUpload('o1');
    await expect(client.downloadUrl('o1')).resolves.toEqual({ url: 'https://signed.example/o1', expiresIn: 60 });
    await client.remove('o1');
    await expect(client.status()).resolves.toEqual({ configured: true });

    expect(host.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /storage/objects/upload/init',
      'GET /storage/objects/o1/upload/status',
      'POST /storage/objects/o1/upload/complete',
      'DELETE /storage/objects/o1/upload/abort',
      'GET /storage/objects/o1/download',
      'DELETE /storage/objects/o1',
      'GET /storage/status',
    ]);
    expect(host.requests[2]!.body).toEqual({ parts: [{ partNumber: 1, eTag: '"e"' }] });
  });
});
