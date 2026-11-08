import { randomBytes } from 'node:crypto';

import { ConflictException, ForbiddenException, HttpException, Logger, NotFoundException } from '@nestjs/common';
import { z } from 'zod';

import { JobHandlerRegistry } from '../../src/jobs/job-handler.registry';
import { registerNodeCredentialPurpose } from '../../src/jobs/node-credential-purpose';
import {
  NodeCredentialDeliveryService,
  NodeCredentialRateLimiter,
  nodeCredentialVersion,
} from '../../src/nodes/node-credential-delivery.service';
import { mergeNodesSettings } from '../../src/nodes/nodes.system-settings';
import { DEFAULT_NODES_POLICY } from '../../src/jobs/jobs.policy';

// =============================================================================
// NodeCredentialDeliveryService (issue #1083)
// =============================================================================
//
// The refusal ladder, in order, each with its own `details.reason`; the marker
// rule (the material reaches the HTTP response and nothing else: not the
// issuance row, not the audit row, not a log line); the version changing on
// rotation; and revoke-all advancing the epoch through the settings merge.
// =============================================================================

process.env.SECRETS_ENCRYPTION_KEY = process.env.SECRETS_ENCRYPTION_KEY ?? randomBytes(32).toString('base64');

const MARKER = 'sk-node-delivery-marker-Qw81Zx';
const USER_MARKER = 'sk-user-byok-marker-Lm22Pq';
const NODE_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const ORG_ID = '33333333-3333-4333-8333-333333333333';

/** The deployment key the test purpose serves, rotatable. */
let deploymentKey: string | null = MARKER;
/** What the resolver was asked for. */
const resolveCalls: Array<{ orgId: string | null }> = [];

registerNodeCredentialPurpose({
  id: 'test:provider',
  label: 'Test provider',
  async resolve(ctx) {
    resolveCalls.push({ orgId: ctx.orgId });
    // A user-tier key exists in the "store" but the purpose never reads it.
    void USER_MARKER;
    return deploymentKey ? { material: { apiKey: deploymentKey } } : null;
  },
});
registerNodeCredentialPurpose({
  id: 'test:throws',
  label: 'Throws with the key in its message',
  async resolve() {
    throw new Error(`provider rejected ${MARKER}`);
  },
});

interface Harness {
  service: NodeCredentialDeliveryService;
  writes: unknown[];
  stored: { nodes: Record<string, unknown> };
  nodes: { getNode: jest.Mock; assertJobHeldByNode: jest.Mock };
  logs: string[];
}

function harness(delivery: Record<string, unknown> | undefined): Harness {
  const writes: unknown[] = [];
  const stored = { nodes: { ...DEFAULT_NODES_POLICY, credentialDelivery: delivery } as Record<string, unknown> };
  const tx = {
    nodeCredentialIssuance: { create: jest.fn(async (args: unknown) => writes.push({ table: 'node_credential_issuances', args })) },
    auditEvent: { create: jest.fn(async (args: unknown) => writes.push({ table: 'audit_events', args })) },
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  const nodes = {
    getNode: jest.fn().mockResolvedValue({ id: NODE_ID }),
    assertJobHeldByNode: jest.fn().mockResolvedValue({ id: JOB_ID, type: 'test.keyed', orgId: ORG_ID }),
  };
  const registry = new JobHandlerRegistry();
  registry.register({
    type: 'test.keyed',
    process: async () => undefined,
    nodeResultSchema: z.object({}),
    persistNodeResult: async () => undefined,
    nodeCredentialPurposes: ['test:provider', 'test:throws'],
  });
  registry.register({ type: 'test.plain', process: async () => undefined });
  const settings = {
    getNodesPolicy: jest.fn(async () => stored.nodes),
    patchSettings: jest.fn(async (body: { nodes: never }) => {
      stored.nodes = mergeNodesSettings(stored.nodes as never, body.nodes) as never;
    }),
  };
  const moduleRef = { get: jest.fn() };
  const logs: string[] = [];
  for (const method of ['log', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
  }
  const service = new NodeCredentialDeliveryService(prisma as never, nodes as never, registry, settings as never, moduleRef as never);
  return { service, writes, stored, nodes, logs };
}

const ON = { enabled: true, cacheTtlMinutes: 30, purposes: ['test:provider', 'test:throws'], epoch: 3 };

async function refusal(promise: Promise<unknown>): Promise<{ status: number; reason: unknown }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      const body = error.getResponse() as { details?: { reason?: unknown } };
      return { status: error.getStatus(), reason: body.details?.reason };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

afterEach(() => {
  jest.restoreAllMocks();
  deploymentKey = MARKER;
  resolveCalls.length = 0;
});

describe('issue: the refusal ladder', () => {
  it('with the shipped defaults (no branch at all), refuses 409 CREDENTIAL_DELIVERY_DISABLED', async () => {
    const { service, writes } = harness(undefined);
    await expect(refusal(service.issue('u', NODE_ID, 'test:provider', { jobId: JOB_ID }))).resolves.toEqual({
      status: 409,
      reason: 'CREDENTIAL_DELIVERY_DISABLED',
    });
    expect(writes).toEqual([]);
  });

  it('checks ownership before anything else', async () => {
    const h = harness(ON);
    h.nodes.getNode.mockRejectedValue(new ForbiddenException());
    await expect(h.service.issue('stranger', NODE_ID, 'test:provider', { jobId: JOB_ID })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404 UNKNOWN_PURPOSE for an unregistered or a non-allowlisted purpose', async () => {
    const { service } = harness({ ...ON, purposes: ['test:provider', 'test:unregistered'] });
    await expect(refusal(service.issue('u', NODE_ID, 'test:unregistered', { jobId: JOB_ID }))).resolves.toEqual({ status: 404, reason: 'UNKNOWN_PURPOSE' });
    await expect(refusal(service.issue('u', NODE_ID, 'test:throws', { jobId: JOB_ID }))).resolves.toEqual({ status: 404, reason: 'UNKNOWN_PURPOSE' });
  });

  it('passes the lease check through (409 when the node no longer holds the job)', async () => {
    const h = harness(ON);
    h.nodes.assertJobHeldByNode.mockRejectedValue(new ConflictException({ message: 'lease gone' }));
    await expect(h.service.issue('u', NODE_ID, 'test:provider', { jobId: JOB_ID })).rejects.toBeInstanceOf(ConflictException);
    expect(h.nodes.assertJobHeldByNode).toHaveBeenCalledWith('u', NODE_ID, JOB_ID, undefined);
  });

  it('403 PURPOSE_NOT_DECLARED when the job type does not declare the purpose', async () => {
    const h = harness(ON);
    h.nodes.assertJobHeldByNode.mockResolvedValue({ id: JOB_ID, type: 'test.plain', orgId: null });
    await expect(refusal(h.service.issue('u', NODE_ID, 'test:provider', { jobId: JOB_ID }))).resolves.toEqual({ status: 403, reason: 'PURPOSE_NOT_DECLARED' });
  });

  it('424 CREDENTIAL_UNAVAILABLE when nothing is configured, and when the resolver throws (its message withheld)', async () => {
    const h = harness(ON);
    deploymentKey = null;
    await expect(refusal(h.service.issue('u', NODE_ID, 'test:provider', { jobId: JOB_ID }))).resolves.toEqual({ status: 424, reason: 'CREDENTIAL_UNAVAILABLE' });
    await expect(refusal(h.service.issue('u', NODE_ID, 'test:throws', { jobId: JOB_ID }))).resolves.toEqual({ status: 424, reason: 'CREDENTIAL_UNAVAILABLE' });
    expect(h.logs.join('\n')).not.toContain(MARKER);
    expect(h.writes).toEqual([]);
  });

  it('429 CREDENTIAL_RATE_LIMITED past 30 a minute per node', () => {
    const limiter = new NodeCredentialRateLimiter(30, 60_000);
    for (let i = 0; i < 30; i += 1) expect(limiter.take('n', 1000)).toBe(true);
    expect(limiter.take('n', 1000)).toBe(false);
    expect(limiter.take('other', 1000)).toBe(true);
    expect(limiter.take('n', 61_001)).toBe(true);
  });
});

describe('issue: success, and the marker rule', () => {
  it('returns the material once, resolved for the job organization, with version, TTL expiry and epoch', async () => {
    const h = harness(ON);
    const issued = await h.service.issue('u', NODE_ID, 'test:provider', { jobId: JOB_ID });

    expect(issued).toEqual({
      purpose: 'test:provider',
      orgId: ORG_ID,
      material: { apiKey: MARKER },
      version: expect.stringMatching(/^[0-9a-f]{16}$/),
      issuedAt: expect.any(String),
      expiresAt: expect.any(String),
      epoch: 3,
    });
    expect(Date.parse(issued.expiresAt) - Date.parse(issued.issuedAt)).toBe(30 * 60_000);
    expect(resolveCalls).toEqual([{ orgId: ORG_ID }]);
  });

  it('writes the issuance and an audit row with purpose and version only: the marker is in neither, nor in any log line', async () => {
    const h = harness(ON);
    const issued = await h.service.issue('u', NODE_ID, 'test:provider', { jobId: JOB_ID });

    expect(h.writes).toHaveLength(2);
    const serialized = JSON.stringify(h.writes);
    expect(serialized).not.toContain(MARKER);
    expect(serialized).not.toContain(USER_MARKER);
    expect(serialized).toContain(issued.version);
    expect(h.writes).toContainEqual({
      table: 'audit_events',
      args: { data: expect.objectContaining({ action: 'node_credential:issued', targetType: 'worker_node', targetId: NODE_ID, meta: { purpose: 'test:provider', version: issued.version, jobId: JOB_ID } }) },
    });
    expect(h.logs.join('\n')).not.toContain(MARKER);
  });

  it('changes the version when the credential rotates, and not otherwise', () => {
    const a = nodeCredentialVersion('test:provider', { material: { apiKey: 'one' } });
    expect(nodeCredentialVersion('test:provider', { material: { apiKey: 'one' } })).toBe(a);
    expect(nodeCredentialVersion('test:provider', { material: { apiKey: 'two' } })).not.toBe(a);
    expect(nodeCredentialVersion('test:other', { material: { apiKey: 'one' } })).not.toBe(a);
    expect(nodeCredentialVersion('test:provider', { material: { apiKey: 'one' }, versionSource: 'row:1' })).not.toBe(a);
    expect(a).not.toContain('one');
  });
});

describe('deliveryState and revokeAll', () => {
  it('reports disabled (and no versions) with the defaults', async () => {
    const { service } = harness(undefined);
    await expect(service.deliveryState()).resolves.toEqual({ enabled: false, epoch: 1, ttlMinutes: 60, purposes: [], versions: {} });
  });

  it('reports the system-scope versions of resolvable, registered, allowlisted purposes only, never material', async () => {
    const { service } = harness({ ...ON, purposes: ['test:provider', 'test:throws', 'test:unregistered'] });
    const state = await service.deliveryState();
    expect(state).toEqual({
      enabled: true,
      epoch: 3,
      ttlMinutes: 30,
      purposes: ['test:provider', 'test:throws'],
      versions: { 'test:provider': nodeCredentialVersion('test:provider', { material: { apiKey: MARKER } }) },
    });
    expect(JSON.stringify(state)).not.toContain(MARKER);
    expect(resolveCalls).toEqual([{ orgId: null }]);
  });

  it('revoke-all advances the epoch through the settings merge and audits it', async () => {
    const h = harness(ON);
    await expect(h.service.revokeAll('admin')).resolves.toEqual({ epoch: 4 });
    expect((h.stored.nodes.credentialDelivery as { epoch: number }).epoch).toBe(4);
    expect(h.writes).toContainEqual({ table: 'audit_events', args: { data: expect.objectContaining({ action: 'node_credential:revoke_all', meta: { epoch: 4 } }) } });
    await expect(h.service.deliveryState()).resolves.toEqual(expect.objectContaining({ epoch: 4 }));
  });

  it('revoke-all works on a row written before #1083 (no branch): epoch 1 -> 2, delivery still off', async () => {
    const h = harness(undefined);
    await expect(h.service.revokeAll('admin')).resolves.toEqual({ epoch: 2 });
    expect(h.stored.nodes.credentialDelivery).toEqual({ enabled: false, cacheTtlMinutes: 60, purposes: [], epoch: 2 });
  });
});

describe('mergeNodesSettings: the credentialDelivery branch', () => {
  const current = { ...DEFAULT_NODES_POLICY, credentialDelivery: { ...ON } } as never;

  it('merges field by field and never moves the epoch backwards', () => {
    expect(mergeNodesSettings(current, { credentialDelivery: { enabled: false } }).credentialDelivery).toEqual({ ...ON, enabled: false });
    expect(mergeNodesSettings(current, { credentialDelivery: { epoch: 1 } as never }).credentialDelivery?.epoch).toBe(3);
    expect(mergeNodesSettings(current, {}).credentialDelivery).toEqual(ON);
  });
});
