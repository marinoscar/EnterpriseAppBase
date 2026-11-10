import { describe, expect, it } from 'vitest';

import { isPlatformApiError } from '../../src/core/index.js';
import { createTestBlobResponse, createTestPlatformHost } from '../../src/testing/index.js';

// The test host's answers to the transport members #704 added: request
// options on every method, `postBlob` and `postSse`.
describe('createTestPlatformHost (transport extensions, #704)', () => {
  it('records ifMatch on PUT, PATCH and DELETE', async () => {
    const host = createTestPlatformHost({ responses: { '/x': null } });
    await host.api.put('/x', { a: 1 }, { ifMatch: '1' });
    await host.api.patch('/x', { a: 2 }, { ifMatch: '2' });
    await host.api.delete('/x', { ifMatch: '3' });
    await host.api.get('/x', { signal: new AbortController().signal });
    expect(host.requests.map((r) => [r.method, r.ifMatch])).toEqual([
      ['PUT', '1'],
      ['PATCH', '2'],
      ['DELETE', '3'],
      ['GET', undefined],
    ]);
  });

  it('answers postBlob from the table', async () => {
    const host = createTestPlatformHost({
      responses: { 'POST /file': createTestBlobResponse('hello', { 'X-Count': '1' }) },
    });
    const { blob, headers } = await host.api.postBlob!('/file', { q: 1 });
    expect(await blob.text()).toBe('hello');
    expect(headers.get('x-count')).toBe('1');
    expect(host.requests).toEqual([{ method: 'POST', path: '/file', body: { q: 1 } }]);
  });

  it('delivers canned frames to postSse in order, and stops when aborted', async () => {
    const host = createTestPlatformHost({
      responses: {
        'POST /stream': [
          { event: 'a', data: 1 },
          { event: 'b', data: 2 },
        ],
      },
    });
    const seen: Array<[string, unknown]> = [];
    await host.api.postSse!('/stream', {}, { onFrame: (event, data) => seen.push([event, data]) });
    expect(seen).toEqual([
      ['a', 1],
      ['b', 2],
    ]);

    const controller = new AbortController();
    controller.abort();
    const none: unknown[] = [];
    await host.api.postSse!('/stream', {}, { onFrame: (e) => none.push(e), signal: controller.signal });
    expect(none).toEqual([]);
  });

  it('rejects an unmatched stream like any other call', async () => {
    const error = await createTestPlatformHost()
      .api.postSse!('/nowhere', {}, { onFrame: () => undefined })
      .catch((e: unknown) => e);
    expect(isPlatformApiError(error)).toBe(true);
    expect(error).toMatchObject({ status: 404 });
  });
});
