// The profile picture client (#892; moved from the reference app's
// `services/api.ts`): upload as multipart, remove, and the authenticated preview.
import { describe, expect, it } from 'vitest';

import { createProfileImageClient } from '../../src/settings/headless/profile-image.js';
import { createTestApiError, createTestBlobResponse, createTestPlatformHost } from '../../src/testing/index.js';

const MUTATION = {
  settings: { theme: 'system', profile: { imageSource: 'upload', imageObjectId: 'obj-1' }, updatedAt: 'x', version: 2 },
  profileImageUrl: '/avatar',
};

describe('createProfileImageClient', () => {
  it('uploads the file as one multipart `file` part', async () => {
    const host = createTestPlatformHost({ responses: { 'POST /user-settings/profile-image': MUTATION } });
    const file = new File(['bytes'], 'me.png', { type: 'image/png' });
    await expect(createProfileImageClient(host.api).upload(file)).resolves.toEqual(MUTATION);
    const request = host.requests[0]!;
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/user-settings/profile-image');
    expect(request.body).toBeInstanceOf(FormData);
    expect((request.body as FormData).get('file')).toBeInstanceOf(File);
  });

  it('removes the uploaded picture', async () => {
    const host = createTestPlatformHost({ responses: { 'DELETE /user-settings/profile-image': MUTATION } });
    await expect(createProfileImageClient(host.api).remove()).resolves.toEqual(MUTATION);
    expect(host.requests[0]).toMatchObject({ method: 'DELETE', path: '/user-settings/profile-image' });
  });

  it('previews the stored picture as a Blob, and rejects with the API error on a 404', async () => {
    const found = createTestPlatformHost({ responses: { 'GET /user-settings/profile-image': createTestBlobResponse('img') } });
    await expect(createProfileImageClient(found.api).preview()).resolves.toBeInstanceOf(Blob);

    const missing = createTestPlatformHost({
      responses: {
        'GET /user-settings/profile-image': () => {
          throw createTestApiError(404, 'Not Found');
        },
      },
    });
    await expect(createProfileImageClient(missing.api).preview()).rejects.toMatchObject({ status: 404 });
  });

  it('says so when the transport cannot upload or download', async () => {
    const { postFormData: _p, getBlob: _g, ...bare } = createTestPlatformHost().api;
    const client = createProfileImageClient(bare);
    await expect(client.upload(new File([''], 'a.png'))).rejects.toThrow(/multipart/);
    await expect(client.preview()).rejects.toThrow(/download/);
  });
});
