import { NodesCredentialDeliveryDoctorCheck, decideCredentialDelivery } from '../../src/nodes/doctor/nodes-credential-delivery.doctor-check';
import { NodeCredentialIssuancesPurgeHandler } from '../../src/nodes/handlers/node-credential-issuances-purge.handler';
import { resolveNodesModuleOptions } from '../../src/nodes/nodes.options';
import { NodeCredentialIssuancesPurgeTask } from '../../src/nodes/tasks/node-credential-issuances-purge.task';
import { DEFAULT_NODE_CREDENTIAL_DELIVERY } from '../../src/jobs/node-credential-purpose';
import { RESERVED_NODE_SUBPATHS, reservedNodeSubpathOverlap } from '../../src/nodes/node-route.paths';
import { registerNodeSpanAttribute } from '../../src/nodes/node-span-attribute.registry';

// Node credential delivery (issue #1083): the Doctor verdict, the audit purge,
// its options, the reserved route and the span-attribute guard.

describe('decideCredentialDelivery', () => {
  const on = { enabled: true, cacheTtlMinutes: 60, purposes: ['ai:openai'], epoch: 2 };

  it('skips when delivery is off (the default)', () => {
    expect(decideCredentialDelivery(DEFAULT_NODE_CREDENTIAL_DELIVERY, [], [], 0).status).toBe('skip');
  });

  it('warns whenever delivery is on and every purpose resolves', () => {
    const outcome = decideCredentialDelivery(on, ['ai:openai'], ['ai:openai'], 3);
    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('ai:openai');
    expect(outcome.detail).toContain('60 min');
    expect(outcome.data).toEqual({ enabled: true, purposes: 1, ttlMinutes: 60, epoch: 2, onlineNodes: 3 });
  });

  it('fails when an allowlisted purpose is unregistered or does not resolve', () => {
    expect(decideCredentialDelivery(on, [], [], 0).status).toBe('fail');
    expect(decideCredentialDelivery(on, ['ai:openai'], [], 0).detail).toContain('no deployment credential resolves');
  });

  it('the check is skip without reading the fleet while off', async () => {
    const listFleet = jest.fn();
    const check = new NodesCredentialDeliveryDoctorCheck(
      { register: jest.fn() } as never,
      { policy: async () => DEFAULT_NODE_CREDENTIAL_DELIVERY } as never,
      { listFleet } as never,
    );
    await expect(check.run()).resolves.toEqual(expect.objectContaining({ status: 'skip' }));
    expect(listFleet).not.toHaveBeenCalled();
    expect(check.id).toBe('nodes.credential_delivery');
  });
});

describe('the credential-issuances purge', () => {
  it('deletes rows issued before the retention cutoff (30 days by default)', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 4 });
    const handler = new NodeCredentialIssuancesPurgeHandler({ register: jest.fn() } as never, { nodeCredentialIssuance: { deleteMany } } as never);
    const now = new Date('2026-11-08T00:00:00.000Z');
    await expect(handler.purge(now)).resolves.toBe(4);
    expect(deleteMany).toHaveBeenCalledWith({ where: { issuedAt: { lt: new Date('2026-10-09T00:00:00.000Z') } } });
    expect(handler.type).toBe('nodes.credential_issuances_purge');
  });

  it('honours credentialIssuancesRetentionDays and validates it', () => {
    expect(resolveNodesModuleOptions({}).credentialIssuancesRetentionDays).toBe(30);
    expect(resolveNodesModuleOptions({ credentialIssuancesRetentionDays: 7 }).credentialIssuancesRetentionDays).toBe(7);
    expect(() => resolveNodesModuleOptions({ credentialIssuancesRetentionDays: 0 })).toThrow(/credentialIssuancesRetentionDays/);
    expect(resolveNodesModuleOptions({ tasks: { credentialIssuancesPurge: false } }).tasks.credentialIssuancesPurge).toBe(false);
  });

  it('the cron only enqueues, and not when the task is off', async () => {
    const jobs = { enqueue: jest.fn() };
    const prisma = { job: { findFirst: jest.fn().mockResolvedValue(null) } };
    const off = new NodeCredentialIssuancesPurgeTask(jobs as never, prisma as never, resolveNodesModuleOptions({ tasks: { credentialIssuancesPurge: false } }));
    await off.handleCron();
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(prisma.job.findFirst).not.toHaveBeenCalled();
  });
});

describe('the node plane', () => {
  it('reserves :id/credentials/* for the platform', () => {
    expect(RESERVED_NODE_SUBPATHS).toContain(':id/credentials/*');
    expect(reservedNodeSubpathOverlap([':id', 'credentials', 'ai:openai'])).toBe(':id/credentials/*');
  });

  it('refuses to relay a span attribute named like a secret', () => {
    for (const key of ['apiKey', 'material', 'authorization', 'clientSecret', 'password']) {
      expect(() => registerNodeSpanAttribute({ key, type: 'string' })).toThrow(/named like a secret/);
    }
    expect(() => registerNodeSpanAttribute({ key: 'tokensIn', type: 'int' })).not.toThrow();
  });
});
