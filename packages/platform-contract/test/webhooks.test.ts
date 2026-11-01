import { describe, expect, it } from 'vitest';

import {
  WEBHOOK_ERROR_CODES,
  WEBHOOK_EVENT_KEY_PATTERN,
  WEBHOOK_EVENT_KEYS_MAX,
  WEBHOOK_HEADERS,
  WEBHOOK_PERMISSIONS,
  createWebhookEndpointSchema,
  signWebhookPayload,
  updateWebhookEndpointSchema,
  verifyWebhookSignature,
  webhookDeliveryListQuerySchema,
  webhookEnvelopeSchema,
} from '../src/webhooks/index.js';

const base = { name: 'Receiver A', url: 'https://hooks.example.test/in', eventKeys: ['jobs.job.failed'] };

describe('webhook schemas', () => {
  it('applies defaults and bounds on create', () => {
    expect(createWebhookEndpointSchema.parse(base).enabled).toBe(true);
    expect(createWebhookEndpointSchema.safeParse({ ...base, name: '' }).success).toBe(false);
    expect(createWebhookEndpointSchema.safeParse({ ...base, name: 'x'.repeat(121) }).success).toBe(false);
    expect(createWebhookEndpointSchema.safeParse({ ...base, description: 'x'.repeat(501) }).success).toBe(false);
    expect(createWebhookEndpointSchema.safeParse({ ...base, url: 'ftp://hooks.example.test' }).success).toBe(false);
    expect(createWebhookEndpointSchema.safeParse({ ...base, url: 'not a url' }).success).toBe(false);
    expect(createWebhookEndpointSchema.safeParse({ ...base, url: `https://e.test/${'a'.repeat(2048)}` }).success).toBe(false);
    expect(createWebhookEndpointSchema.safeParse({ ...base, eventKeys: [] }).success).toBe(false);
    const many = Array.from({ length: WEBHOOK_EVENT_KEYS_MAX + 1 }, (_, i) => `grp.ev${i}`);
    expect(createWebhookEndpointSchema.safeParse({ ...base, eventKeys: many }).success).toBe(false);
    expect(createWebhookEndpointSchema.safeParse({ ...base, eventKeys: many.slice(0, 100) }).success).toBe(true);
  });

  it('accepts partial updates', () => {
    expect(updateWebhookEndpointSchema.safeParse({}).success).toBe(true);
    expect(updateWebhookEndpointSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(updateWebhookEndpointSchema.safeParse({ eventKeys: [] }).success).toBe(false);
  });

  it('matches exact keys and wildcards only', () => {
    for (const ok of ['nodes.node.offline', 'jobs.job.failed', 'nodes.*', 'notification.*', 'a.b.*', '*']) {
      expect(WEBHOOK_EVENT_KEY_PATTERN.test(ok), ok).toBe(true);
    }
    for (const bad of ['', 'nodes', 'Nodes.node', 'nodes.', '.*', 'nodes.*.x', '**', 'nodes.no*', 'a b.c', '1a.b']) {
      expect(WEBHOOK_EVENT_KEY_PATTERN.test(bad), bad).toBe(false);
    }
  });

  it('parses the delivery list query with coercion and a page cap', () => {
    expect(webhookDeliveryListQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
    expect(webhookDeliveryListQuerySchema.parse({ page: '2', pageSize: '100', status: 'dead' })).toMatchObject({ page: 2, pageSize: 100, status: 'dead' });
    expect(webhookDeliveryListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(webhookDeliveryListQuerySchema.safeParse({ status: 'nope' }).success).toBe(false);
  });

  it('parses an envelope', () => {
    const env = { id: 'e1', type: 'webhooks.ping', createdAt: '2026-11-01T00:00:00.000Z', apiVersion: '2026-11-01', org: null, data: { a: 1 } };
    expect(webhookEnvelopeSchema.safeParse(env).success).toBe(true);
    expect(webhookEnvelopeSchema.safeParse({ ...env, org: { id: 'o1' } }).success).toBe(true);
  });

  it('exposes the documented constants', () => {
    expect(WEBHOOK_HEADERS.SIGNATURE).toBe('webhook-signature');
    expect(WEBHOOK_PERMISSIONS.SYSTEM_WRITE).toBe('system_webhooks:write');
    expect(WEBHOOK_ERROR_CODES.WEBHOOK_URL_FORBIDDEN).toBe('WEBHOOK_URL_FORBIDDEN');
  });
});

describe('webhook signatures', () => {
  // Key bytes "test-signing-key-bytes-0123456789"; vector computed with node:crypto.
  const secret = 'whsec_dGVzdC1zaWduaW5nLWtleS1ieXRlcy0wMTIzNDU2Nzg5';
  const id = 'msg_example';
  const timestamp = 1730419200;
  const body = '{"a":1}';
  const vector = 'v1,Ui2L2fPtkoV0EFTdS5AF1vACQHzFTKSQM/jgH+FD/V0=';
  const now = timestamp * 1000;
  const other = `whsec_${btoa('another-key-another-key-another!')}`;

  it('matches the pinned vector', async () => {
    expect(await signWebhookPayload({ secret, id, timestamp, body })).toBe(vector);
  });

  it('round trips', async () => {
    const signatureHeader = await signWebhookPayload({ secret, id, timestamp, body });
    expect(await verifyWebhookSignature({ secret, id, timestamp, body, signatureHeader, now })).toBe(true);
    expect(await verifyWebhookSignature({ secret, id, timestamp: String(timestamp), body, signatureHeader, now })).toBe(true);
  });

  it('rejects a wrong secret, tampered body, id or timestamp', async () => {
    const args = { id, timestamp, body, signatureHeader: vector, now };
    expect(await verifyWebhookSignature({ ...args, secret: other })).toBe(false);
    expect(await verifyWebhookSignature({ ...args, secret, body: '{"a":2}' })).toBe(false);
    expect(await verifyWebhookSignature({ ...args, secret, id: 'msg_other' })).toBe(false);
    expect(await verifyWebhookSignature({ ...args, secret, timestamp: timestamp + 1 })).toBe(false);
  });

  it('enforces the tolerance window', async () => {
    const args = { secret, id, timestamp, body, signatureHeader: vector };
    expect(await verifyWebhookSignature({ ...args, now: now + 299_000 })).toBe(true);
    expect(await verifyWebhookSignature({ ...args, now: now + 301_000 })).toBe(false);
    expect(await verifyWebhookSignature({ ...args, now: now - 301_000 })).toBe(false);
    expect(await verifyWebhookSignature({ ...args, now: now + 3_600_000, toleranceSeconds: 7200 })).toBe(true);
  });

  it('accepts any of several header entries and any of several secrets (rotation)', async () => {
    const oldSig = await signWebhookPayload({ secret: other, id, timestamp, body });
    const header = `${vector} ${oldSig}`;
    expect(await verifyWebhookSignature({ secret: other, id, timestamp, body, signatureHeader: header, now })).toBe(true);
    expect(await verifyWebhookSignature({ secrets: [secret, other], id, timestamp, body, signatureHeader: oldSig, now })).toBe(true);
    expect(await verifyWebhookSignature({ secrets: [secret], id, timestamp, body, signatureHeader: oldSig, now })).toBe(false);
  });

  it('returns false on malformed input', async () => {
    const args = { secret, id, timestamp, body, now };
    expect(await verifyWebhookSignature({ ...args, signatureHeader: '' })).toBe(false);
    expect(await verifyWebhookSignature({ ...args, signatureHeader: 'v2,abc' })).toBe(false);
    expect(await verifyWebhookSignature({ ...args, signatureHeader: 'v1,%%%' })).toBe(false);
    expect(await verifyWebhookSignature({ ...args, timestamp: 'abc', signatureHeader: vector })).toBe(false);
    expect(await verifyWebhookSignature({ id, timestamp, body, signatureHeader: vector, now })).toBe(false);
  });
});
