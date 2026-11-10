// The admin fleet's response shapes (issue #881): the schemas the API's Swagger
// classes implement and the web slice derives its types from.
import { describe, expect, it } from 'vitest';

import {
  MAX_NODE_CREDENTIAL_NAME_LENGTH,
  NODE_HEALTHS,
  NODE_STATUSES,
  adminNodeCredentialSchema,
  adminNodeSchema,
  createNodeCredentialSchema,
  nodeCredentialCreatedSchema,
  nodeCredentialListItemSchema,
} from '../src/nodes/index.js';

const owner = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.test', name: null };
const node = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'rack-1',
  hostname: 'rack-1.local',
  platform: 'linux-x64',
  cliVersion: '1.2.3',
  eligibleTypes: ['example.checksum'],
  concurrency: 2,
  status: 'online',
  health: 'healthy',
  capabilities: { pgDump: true },
  registeredAt: '2026-01-01T00:00:00.000Z',
  lastHeartbeatAt: null,
  lastVitals: { cpuPercent: 12, counters: { claims: 3 } },
  lastVitalsAt: null,
  owner,
  jobCounts: { running: 0, pending: 0, succeeded: 4, failed: 1, total: 5 },
};
const credential = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'rack-1 token',
  tokenPrefix: 'nod_1a2b',
  expiresAt: null,
  lastUsedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  revokedAt: null,
  owner,
};

describe('node admin response schemas', () => {
  it('parses an admin node, including the never-heartbeated and no-vitals nulls', () => {
    expect(adminNodeSchema.parse(node)).toEqual(node);
    expect(adminNodeSchema.parse({ ...node, lastVitals: null })).toMatchObject({ lastVitals: null });
  });

  it('keeps status and health to their closed sets', () => {
    for (const status of NODE_STATUSES) expect(adminNodeSchema.safeParse({ ...node, status }).success).toBe(true);
    for (const health of NODE_HEALTHS) expect(adminNodeSchema.safeParse({ ...node, health }).success).toBe(true);
    expect(adminNodeSchema.safeParse({ ...node, status: 'sleeping' }).success).toBe(false);
    expect(adminNodeSchema.safeParse({ ...node, health: 'ok' }).success).toBe(false);
  });

  it('treats a null expiry as "never expires" and keeps a token off the list shapes', () => {
    expect(adminNodeCredentialSchema.parse(credential).expiresAt).toBeNull();
    const { owner: _owner, ...own } = credential;
    expect(nodeCredentialListItemSchema.parse(own)).toEqual(own);
    // Unknown keys are stripped, never passed through: a `token` cannot ride a list.
    expect(adminNodeCredentialSchema.parse({ ...credential, token: 'nod_secret' })).not.toHaveProperty('token');
  });

  it('carries the raw token on the create response only', () => {
    const created = { token: 'nod_abc', id: credential.id, name: credential.name, tokenPrefix: 'nod_abc', expiresAt: null, createdAt: credential.createdAt };
    expect(nodeCredentialCreatedSchema.parse(created)).toEqual(created);
    expect(nodeCredentialCreatedSchema.safeParse({ ...created, token: undefined }).success).toBe(false);
  });

  it('shares the credential name bound with the mint body', () => {
    expect(MAX_NODE_CREDENTIAL_NAME_LENGTH).toBe(100);
    expect(createNodeCredentialSchema.safeParse({ name: 'x'.repeat(MAX_NODE_CREDENTIAL_NAME_LENGTH) }).success).toBe(true);
    expect(createNodeCredentialSchema.safeParse({ name: 'x'.repeat(MAX_NODE_CREDENTIAL_NAME_LENGTH + 1) }).success).toBe(false);
  });
});
