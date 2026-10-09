// Shared helpers for the nodes slice's package tests (issue #881): a fake nodes
// client and row fixtures (moved from the jobs slice's harness).

import { vi } from 'vitest';

import type { NodesApi, NodeCredential, WorkerNode } from '../../src/nodes/headless/index.js';

/** A {@link NodesApi} whose every member is a `vi.fn()` (resolving `undefined` until a test says otherwise). */
export type FakeNodesApi = { [K in keyof NodesApi]: ReturnType<typeof vi.fn> & NodesApi[K] };

const NODES_API_MEMBERS: readonly (keyof NodesApi)[] = [
  'getWorkerNodes',
  'getWorkerNode',
  'deleteWorkerNode',
  'getNodeCredentials',
  'createNodeCredential',
  'revokeNodeCredential',
];

export function fakeNodesApi(): FakeNodesApi {
  return Object.fromEntries(NODES_API_MEMBERS.map((name) => [name, vi.fn()])) as unknown as FakeNodesApi;
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
