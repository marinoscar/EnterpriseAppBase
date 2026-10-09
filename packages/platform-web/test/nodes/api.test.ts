// The nodes client's paths and bodies (issue #881): byte-identical to the
// routes the jobs client carried for the fleet (#854), which `createJobsApi`
// still serves by spreading this client.

import { describe, expect, it, vi } from 'vitest';

import type { PlatformApiClient } from '../../src/core/index.js';
import { createJobsApi } from '../../src/jobs/headless/index.js';
import { createNodesApi } from '../../src/nodes/headless/index.js';

function fakeClient() {
  const client = {
    get: vi.fn(async () => ({})),
    post: vi.fn(async () => ({})),
    put: vi.fn(async () => ({})),
    patch: vi.fn(async () => ({})),
    delete: vi.fn(async () => undefined),
  };
  return client as typeof client & PlatformApiClient;
}

describe('createNodesApi', () => {
  it('calls the fleet and credential routes', async () => {
    const client = fakeClient();
    const api = createNodesApi(client);
    await api.getWorkerNodes();
    await api.getWorkerNode('n1');
    await api.deleteWorkerNode('n1');
    await api.getNodeCredentials();
    await api.createNodeCredential({ name: 'box' });
    await api.createNodeCredential({ name: 'box', expiresInDays: 30 });
    await api.revokeNodeCredential('c1');

    expect(client.get.mock.calls).toEqual([['/admin/nodes'], ['/admin/nodes/n1'], ['/admin/nodes/credentials']]);
    // `expiresInDays` is omitted, not sent as undefined: omitted means "never expires".
    expect(client.post.mock.calls).toEqual([
      ['/node-credentials', { name: 'box' }],
      ['/node-credentials', { name: 'box', expiresInDays: 30 }],
    ]);
    expect(client.delete.mock.calls).toEqual([['/admin/nodes/n1'], ['/admin/nodes/credentials/c1']]);
  });

  it('exposes exactly the members the jobs client carries for the fleet', () => {
    const client = fakeClient();
    const nodes = Object.keys(createNodesApi(client)).sort();
    const jobs = Object.keys(createJobsApi(client));
    for (const member of nodes) expect(jobs).toContain(member);
  });
});
