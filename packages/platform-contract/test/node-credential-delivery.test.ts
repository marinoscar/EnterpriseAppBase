// Provider-credential delivery to worker nodes (issue #1083): the settings
// branch of the `nodes` namespace and the issuance, state and revoke-all shapes.
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NODE_CREDENTIAL_CACHE_TTL_MINUTES,
  MAX_NODE_CREDENTIAL_CACHE_TTL_MINUTES,
  NODE_CREDENTIAL_DELIVERY_REFUSALS,
  NODE_CREDENTIAL_PURPOSE_ID_PATTERN,
  nodeCredentialDeliveryPatchSchema,
  nodeCredentialDeliveryStateSchema,
  nodeCredentialIssueRequestSchema,
  nodeCredentialIssueResponseSchema,
  nodesSettingsPatchSchema,
  nodesSettingsSchema,
  systemNodesSchema,
} from '../src/nodes/index.js';

const NODES = { staleHeartbeatSeconds: 90, offlineStaleMultiplier: 4, offlineRetentionDays: 30, jobSecretBrokerEnabled: false };
const DELIVERY = { enabled: false, cacheTtlMinutes: 60, purposes: [], epoch: 1 };
const JOB_ID = '11111111-1111-4111-8111-111111111111';

describe('node credential delivery settings', () => {
  it('ships a 60-minute TTL bounded at four hours', () => {
    expect(DEFAULT_NODE_CREDENTIAL_CACHE_TTL_MINUTES).toBe(60);
    expect(MAX_NODE_CREDENTIAL_CACHE_TTL_MINUTES).toBe(240);
  });

  it('is optional in every nodes shape, so a row or a body written before it still validates', () => {
    expect(systemNodesSchema.parse(NODES)).toEqual(NODES);
    expect(nodesSettingsSchema.parse(NODES)).toEqual(NODES);
    expect(systemNodesSchema.parse({ ...NODES, credentialDelivery: DELIVERY })).toEqual({ ...NODES, credentialDelivery: DELIVERY });
  });

  it('bounds the TTL to 5..240 minutes and the purposes to registered-id shape', () => {
    expect(systemNodesSchema.safeParse({ ...NODES, credentialDelivery: { ...DELIVERY, cacheTtlMinutes: 241 } }).success).toBe(false);
    expect(systemNodesSchema.safeParse({ ...NODES, credentialDelivery: { ...DELIVERY, cacheTtlMinutes: 4 } }).success).toBe(false);
    expect(systemNodesSchema.safeParse({ ...NODES, credentialDelivery: { ...DELIVERY, purposes: ['OpenAI'] } }).success).toBe(false);
    expect(systemNodesSchema.safeParse({ ...NODES, credentialDelivery: { ...DELIVERY, purposes: ['ai:openai', 'geo:google'] } }).success).toBe(true);
  });

  it('strips the server-written epoch from a PATCH', () => {
    expect(nodeCredentialDeliveryPatchSchema.parse({ enabled: true, epoch: 9 })).toEqual({ enabled: true });
    expect(nodesSettingsPatchSchema.parse({ credentialDelivery: { purposes: ['ai:openai'], epoch: 9 } })).toEqual({
      credentialDelivery: { purposes: ['ai:openai'] },
    });
  });

  it('accepts open-vocabulary purpose ids', () => {
    for (const id of ['ai:openai', 'ai:openai-compatible', 'geo:google', 'maps:tiles.v2']) expect(NODE_CREDENTIAL_PURPOSE_ID_PATTERN.test(id)).toBe(true);
    for (const id of ['openai', 'ai:', ':openai', 'AI:openai', 'ai:open ai']) expect(NODE_CREDENTIAL_PURPOSE_ID_PATTERN.test(id)).toBe(false);
  });
});

describe('node credential issuance shapes', () => {
  it('takes a job id and an optional claim token, and nothing else', () => {
    expect(nodeCredentialIssueRequestSchema.parse({ jobId: JOB_ID })).toEqual({ jobId: JOB_ID });
    expect(nodeCredentialIssueRequestSchema.safeParse({ jobId: JOB_ID, tier: 'user' }).success).toBe(false);
    expect(nodeCredentialIssueRequestSchema.safeParse({}).success).toBe(false);
  });

  it('describes the one response that carries material, with a 16-character version', () => {
    const response = {
      purpose: 'ai:openai',
      orgId: null,
      material: { apiKey: 'k' },
      version: '0123456789abcdef',
      issuedAt: '2026-11-08T00:00:00.000Z',
      expiresAt: '2026-11-08T01:00:00.000Z',
      epoch: 1,
    };
    expect(nodeCredentialIssueResponseSchema.parse(response)).toEqual(response);
    expect(nodeCredentialIssueResponseSchema.safeParse({ ...response, version: 'short' }).success).toBe(false);
  });

  it('describes the heartbeat and claim state', () => {
    const state = { enabled: true, epoch: 2, ttlMinutes: 60, purposes: ['ai:openai'], versions: { 'ai:openai': '0123456789abcdef' } };
    expect(nodeCredentialDeliveryStateSchema.parse(state)).toEqual(state);
  });

  it('names each refusal', () => {
    expect(Object.values(NODE_CREDENTIAL_DELIVERY_REFUSALS)).toEqual([
      'CREDENTIAL_DELIVERY_DISABLED',
      'UNKNOWN_PURPOSE',
      'PURPOSE_NOT_DECLARED',
      'CREDENTIAL_RATE_LIMITED',
      'CREDENTIAL_UNAVAILABLE',
    ]);
  });
});
