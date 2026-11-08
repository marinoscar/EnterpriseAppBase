import { z } from 'zod';

import { JobHandlerRegistry } from '../../src/jobs/job-handler.registry';
import { NodeOffloadService } from '../../src/jobs/node-offload.service';
import {
  DEFAULT_NODE_CREDENTIAL_DELIVERY,
  nodeCredentialPurposeRegistry,
  readNodeCredentialDeliveryPolicy,
  registerNodeCredentialPurpose,
  undeliverableReason,
} from '../../src/jobs/node-credential-purpose';
import type { SystemSettingsService } from '../../src/settings/index';

// =============================================================================
// Node credential purposes and the claim-time delivery gate (issue #1083)
// =============================================================================
//
// Delivery is opt-in and OFF by default. The property under test is the
// fallback: a type that declares a purpose is offered to nodes only while the
// deployment enabled delivery, allowlisted every declared purpose and the
// purpose is registered; otherwise the SERVER runs it (it lands in
// `serverOnlyRightNow()`), never nobody.
// =============================================================================

registerNodeCredentialPurpose({ id: 'test:keyed', label: 'Test keyed provider', resolve: async () => null });

describe('readNodeCredentialDeliveryPolicy', () => {
  it('is OFF for a row without the branch, and for anything but a literal true', () => {
    expect(readNodeCredentialDeliveryPolicy(null)).toEqual(DEFAULT_NODE_CREDENTIAL_DELIVERY);
    expect(readNodeCredentialDeliveryPolicy({ jobSecretBrokerEnabled: true })).toEqual(DEFAULT_NODE_CREDENTIAL_DELIVERY);
    for (const enabled of ['true', 1, null]) {
      expect(readNodeCredentialDeliveryPolicy({ credentialDelivery: { enabled } }).enabled).toBe(false);
    }
  });

  it('clamps the TTL to 5..240, drops malformed purposes and keeps the epoch at least 1', () => {
    const policy = readNodeCredentialDeliveryPolicy({
      credentialDelivery: { enabled: true, cacheTtlMinutes: 10_000, purposes: ['ai:openai', 'NOPE', 'ai:openai', 7], epoch: 0 },
    });
    expect(policy).toEqual({ enabled: true, cacheTtlMinutes: 240, purposes: ['ai:openai'], epoch: 1 });
    expect(readNodeCredentialDeliveryPolicy({ credentialDelivery: { cacheTtlMinutes: 1 } }).cacheTtlMinutes).toBe(5);
    expect(readNodeCredentialDeliveryPolicy({ credentialDelivery: { epoch: 7 } }).epoch).toBe(7);
  });
});

describe('undeliverableReason', () => {
  const on = { enabled: true, cacheTtlMinutes: 60, purposes: ['test:keyed'], epoch: 1 };

  it('is null for a type that declares nothing, whatever the policy', () => {
    expect(undeliverableReason([], DEFAULT_NODE_CREDENTIAL_DELIVERY)).toBeNull();
  });

  it('names the first missing decision', () => {
    expect(undeliverableReason(['test:keyed'], DEFAULT_NODE_CREDENTIAL_DELIVERY)).toMatch(/enabled is off/);
    expect(undeliverableReason(['test:other'], { ...on, purposes: ['test:keyed'] })).toMatch(/not on the .*allowlist/);
    expect(undeliverableReason(['test:unregistered'], { ...on, purposes: ['test:unregistered'] })).toMatch(/not registered/);
    expect(undeliverableReason(['test:keyed'], on)).toBeNull();
  });
});

describe('registerNodeCredentialPurpose', () => {
  it('refuses a malformed id and a missing resolver', () => {
    expect(() => registerNodeCredentialPurpose({ id: 'NoColon', label: 'x', resolve: async () => null })).toThrow();
    expect(() => registerNodeCredentialPurpose({ id: 'test:bad', label: 'x' } as never)).toThrow();
    expect(nodeCredentialPurposeRegistry.get('test:keyed')?.label).toBe('Test keyed provider');
  });
});

describe('JobHandlerRegistry and nodeCredentialPurposes', () => {
  it('refuses a handler declaring a malformed purpose id', () => {
    const registry = new JobHandlerRegistry();
    expect(() => registry.register({ type: 'test.bad', process: async () => undefined, nodeCredentialPurposes: ['openai'] })).toThrow(/purpose id/);
  });
});

describe('NodeOffloadService: the delivery gate', () => {
  let registry: JobHandlerRegistry;
  let getNodesPolicy: jest.Mock;
  let service: NodeOffloadService;

  beforeEach(() => {
    registry = new JobHandlerRegistry();
    getNodesPolicy = jest.fn();
    service = new NodeOffloadService(registry, { getNodesPolicy } as unknown as SystemSettingsService);
    registry.register({
      type: 'test.keyed',
      process: async () => undefined,
      nodeResultSchema: z.object({ ok: z.boolean() }),
      persistNodeResult: async () => undefined,
      nodeCredentialPurposes: ['test:keyed'],
    });
    registry.register({
      type: 'test.open',
      process: async () => undefined,
      nodeResultSchema: z.object({ ok: z.boolean() }),
      persistNodeResult: async () => undefined,
    });
  });

  it('with the shipped defaults, withholds the keyed type and the server runs it', async () => {
    getNodesPolicy.mockResolvedValue({ jobSecretBrokerEnabled: false });
    await expect(service.offeredTypes()).resolves.toEqual(['test.open']);
    await expect(service.serverOnlyRightNow()).resolves.toEqual(['test.keyed']);
  });

  it('enabled but not allowlisted: still withheld', async () => {
    getNodesPolicy.mockResolvedValue({ credentialDelivery: { enabled: true, cacheTtlMinutes: 60, purposes: [] } });
    await expect(service.offeredTypes()).resolves.toEqual(['test.open']);
  });

  it('enabled, allowlisted and registered: offered to nodes', async () => {
    getNodesPolicy.mockResolvedValue({ credentialDelivery: { enabled: true, cacheTtlMinutes: 60, purposes: ['test:keyed'] } });
    await expect(service.offeredTypes()).resolves.toEqual(['test.keyed', 'test.open']);
    await expect(service.serverOnlyRightNow()).resolves.toEqual([]);
  });

  it('an unreadable policy withholds the keyed type (fail closed)', async () => {
    getNodesPolicy.mockRejectedValue(new Error('db down'));
    await expect(service.offeredTypes()).resolves.toEqual(['test.open']);
  });
});
