// Shared helpers for the jobs slice's package tests (issue #854): a fake jobs
// client (the stand-in for the reference app's mocked `services/jobs.ts` and
// `services/nodes.ts` the moved suites used to mock) and a job row fixture. The
// node fixtures are the nodes slice's (`../nodes/harness.ts`).

import { vi } from 'vitest';

import type { Job, JobsApi } from '../../src/jobs/headless/index.js';

/** A {@link JobsApi} whose every member is a `vi.fn()` (resolving `undefined` until a test says otherwise). */
export type FakeJobsApi = { [K in keyof JobsApi]: ReturnType<typeof vi.fn> & JobsApi[K] };

const JOBS_API_MEMBERS: readonly (keyof JobsApi)[] = [
  'getJobs',
  'getJobStats',
  'retryJob',
  'deleteJob',
  'retryFailedJobs',
  'resetStuckJobs',
  'getJobInsights',
  'resetJobInsightsHistory',
  'getWorkerNodes',
  'getWorkerNode',
  'deleteWorkerNode',
  'getNodeCredentials',
  'createNodeCredential',
  'revokeNodeCredential',
];

export function fakeJobsApi(): FakeJobsApi {
  return Object.fromEntries(JOBS_API_MEMBERS.map((name) => [name, vi.fn()])) as unknown as FakeJobsApi;
}

export function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    type: 'image.thumbnail',
    typeLabel: 'Thumbnail',
    subjectType: null,
    subjectId: null,
    dedupKey: null,
    status: 'pending',
    reason: 'upload',
    priority: 0,
    providerKey: null,
    modelVersion: null,
    attempts: 0,
    lastError: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    scheduledFor: null,
    rateLimitedAt: null,
    rateLimitHits: 0,
    claimedByNodeId: null,
    leaseExpiresAt: null,
    executor: null,
    orgId: null,
    ...overrides,
  };
}
