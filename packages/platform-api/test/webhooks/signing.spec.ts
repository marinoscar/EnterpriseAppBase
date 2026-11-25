import { WEBHOOK_HEADERS, WEBHOOK_SECRET_PREFIX, verifyWebhookSignature } from '@marinoscar/platform-contract/webhooks';

import { generateWebhookSecret, signedHeaders } from '../../src/webhooks/index';

describe('generateWebhookSecret', () => {
  it('is whsec_ and 32 random bytes in base64, different every time', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true);
    expect(Buffer.from(a.slice(WEBHOOK_SECRET_PREFIX.length), 'base64')).toHaveLength(32);
    expect(a).not.toBe(b);
  });
});

describe('signedHeaders', () => {
  const body = '{"hello":"world"}';
  const base = { id: 'evt-1', timestamp: Math.floor(Date.now() / 1000), body, userAgent: 'App-Webhooks/1.0' };

  it('carries the Standard Webhooks headers and a signature the contract verifies', async () => {
    const secret = generateWebhookSecret();
    const headers = await signedHeaders({ ...base, secrets: [secret] });
    expect(headers[WEBHOOK_HEADERS.ID]).toBe('evt-1');
    expect(headers[WEBHOOK_HEADERS.TIMESTAMP]).toBe(String(base.timestamp));
    expect(headers['content-type']).toBe('application/json');
    expect(headers['user-agent']).toBe('App-Webhooks/1.0');
    expect(headers[WEBHOOK_HEADERS.SIGNATURE]).toMatch(/^v1,[A-Za-z0-9+/]+=*$/);
    await expect(verifyWebhookSignature({ secret, id: 'evt-1', timestamp: base.timestamp, body, signatureHeader: headers[WEBHOOK_HEADERS.SIGNATURE]! })).resolves.toBe(true);
  });

  it('does not verify under another secret, another body or another id', async () => {
    const secret = generateWebhookSecret();
    const header = (await signedHeaders({ ...base, secrets: [secret] }))[WEBHOOK_HEADERS.SIGNATURE]!;
    await expect(verifyWebhookSignature({ secret: generateWebhookSecret(), id: 'evt-1', timestamp: base.timestamp, body, signatureHeader: header })).resolves.toBe(false);
    await expect(verifyWebhookSignature({ secret, id: 'evt-1', timestamp: base.timestamp, body: `${body} `, signatureHeader: header })).resolves.toBe(false);
    await expect(verifyWebhookSignature({ secret, id: 'evt-2', timestamp: base.timestamp, body, signatureHeader: header })).resolves.toBe(false);
  });

  it('signs with two secrets during a rotation, current first, and either verifies', async () => {
    const current = generateWebhookSecret();
    const previous = generateWebhookSecret();
    const header = (await signedHeaders({ ...base, secrets: [current, previous] }))[WEBHOOK_HEADERS.SIGNATURE]!;
    const entries = header.split(' ');
    expect(entries).toHaveLength(2);
    expect(entries[0]).not.toBe(entries[1]);
    for (const secret of [current, previous]) {
      await expect(verifyWebhookSignature({ secret, id: 'evt-1', timestamp: base.timestamp, body, signatureHeader: header })).resolves.toBe(true);
    }
    await expect(verifyWebhookSignature({ secrets: [previous], id: 'evt-1', timestamp: base.timestamp, body, signatureHeader: entries[0]! })).resolves.toBe(false);
  });

  it('is rejected by the receiver once the timestamp is stale', async () => {
    const secret = generateWebhookSecret();
    const old = base.timestamp - 3600;
    const header = (await signedHeaders({ ...base, timestamp: old, secrets: [secret] }))[WEBHOOK_HEADERS.SIGNATURE]!;
    await expect(verifyWebhookSignature({ secret, id: 'evt-1', timestamp: old, body, signatureHeader: header })).resolves.toBe(false);
  });
});
