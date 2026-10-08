// Shared helpers for the jobs slice's package tests (issue #854): a fake jobs
// client (the stand-in for the reference app's mocked `services/jobs.ts` and
// `services/nodes.ts` the moved suites used to mock) and row fixtures.

import { vi } from 'vitest';

import type { Job, JobsApi, NodeCredential, WorkerNode } from '../../src/jobs/headless/index.js';

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

export function node(overrides: Partial<WorkerNode> = {}): WorkerNode {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'worker-a',
    hostname: 'build-box-01',
    platform: 'linux-x64',
    cliVersion: '1.4.0',
    eligibleTypes: ['image.thumbnail'],
    concurrency: 4,
    status: 'online',
    health: 'healthy',
    capabilities: null,
    registeredAt: '2026-01-01T00:00:00.000Z',
    lastHeartbeatAt: '2026-01-01T00:05:00.000Z',
    owner: { id: 'u1', email: 'ops@example.com', name: 'Ops' },
    jobCounts: { running: 1, pending: 2, succeeded: 30, failed: 1, total: 34 },
    lastVitals: null,
    lastVitalsAt: null,
    ...overrides,
  };
}

export function credential(overrides: Partial<NodeCredential> = {}): NodeCredential {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'build-box-01',
    tokenPrefix: 'nod_1a2b',
    expiresAt: null,
    lastUsedAt: '2026-01-01T00:05:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    revokedAt: null,
    owner: { id: 'u1', email: 'ops@example.com', name: 'Ops' },
    ...overrides,
  };
}
