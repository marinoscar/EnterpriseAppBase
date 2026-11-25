// The jobs client's paths and bodies (issue #854): byte-identical to the
// reference app's `services/jobs.ts` and `services/nodes.ts`, plus the
// `orgId` list filter (#734).

import { describe, expect, it, vi } from 'vitest';

import type { PlatformApiClient } from '../../src/core/index.js';
import { createJobsApi } from '../../src/jobs/headless/index.js';

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

describe('createJobsApi', () => {
  it('lists jobs with an empty query by default', async () => {
    const client = fakeClient();
    await createJobsApi(client).getJobs();
    expect(client.get).toHaveBeenCalledWith('/admin/jobs?');
  });

  it('sends every filter in the reference app order, orgId included', async () => {
    const client = fakeClient();
    await createJobsApi(client).getJobs({
      page: 2,
      pageSize: 50,
      status: 'failed',
      type: 'image.thumbnail',
      subjectType: 'storage_object',
      subjectId: 'obj-1',
      orgId: '33333333-3333-4333-8333-333333333333',
      processedWithin: '24h',
    });
    expect(client.get).toHaveBeenCalledWith(
      '/admin/jobs?page=2&pageSize=50&status=failed&type=image.thumbnail&subjectType=storage_object' +
        '&subjectId=obj-1&orgId=33333333-3333-4333-8333-333333333333&processedWithin=24h',
    );
  });

  it('sends scheduled only when true and omits the default window', async () => {
    const client = fakeClient();
    const api = createJobsApi(client);
    await api.getJobs({ scheduled: true, processedWithin: 'all' });
    await api.getJobs({ scheduled: false });
    expect(client.get).toHaveBeenNthCalledWith(1, '/admin/jobs?scheduled=true');
    expect(client.get).toHaveBeenNthCalledWith(2, '/admin/jobs?');
  });

  it('calls the queue routes', async () => {
    const client = fakeClient();
    const api = createJobsApi(client);
    await api.getJobStats();
    await api.retryJob('j1');
    await api.deleteJob('j1');
    await api.retryFailedJobs();
    await api.retryFailedJobs('email.send');
    await api.resetStuckJobs();
    await api.resetStuckJobs(15);
    await api.getJobInsights();
    await api.getJobInsights(30);
    await api.resetJobInsightsHistory();

    expect(client.get.mock.calls).toEqual([
      ['/admin/jobs/stats'],
      ['/admin/jobs/insights'],
      ['/admin/jobs/insights?windowDays=30'],
    ]);
    expect(client.post.mock.calls).toEqual([
      ['/admin/jobs/j1/retry'],
      ['/admin/jobs/retry-failed', {}],
      ['/admin/jobs/retry-failed', { type: 'email.send' }],
      ['/admin/jobs/reset-stuck', {}],
      ['/admin/jobs/reset-stuck', { olderThanMinutes: 15 }],
      ['/admin/jobs/insights/reset-history'],
    ]);
    expect(client.delete.mock.calls).toEqual([['/admin/jobs/j1']]);
  });

  it('calls the fleet routes on their two prefixes', async () => {
    const client = fakeClient();
    const api = createJobsApi(client);
    await api.getWorkerNodes();
    await api.getWorkerNode('n1');
    await api.deleteWorkerNode('n1');
    await api.getNodeCredentials();
    await api.createNodeCredential({ name: 'box' });
    await api.createNodeCredential({ name: 'box', expiresInDays: 30 });
    await api.revokeNodeCredential('c1');

    expect(client.get.mock.calls).toEqual([['/admin/nodes'], ['/admin/nodes/n1'], ['/admin/nodes/credentials']]);
    // `expiresInDays` absent means "never expires": it is omitted, never sent as undefined or null.
    expect(client.post.mock.calls).toEqual([
      ['/node-credentials', { name: 'box' }],
      ['/node-credentials', { name: 'box', expiresInDays: 30 }],
    ]);
    expect(Object.keys((client.post.mock.calls as unknown[][])[0]?.[1] as object)).toEqual(['name']);
    expect(client.delete.mock.calls).toEqual([['/admin/nodes/n1'], ['/admin/nodes/credentials/c1']]);
  });
});
