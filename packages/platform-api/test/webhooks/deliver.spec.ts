import { WEBHOOK_HEADERS, verifyWebhookSignature } from '@marinoscar/platform-contract/webhooks';

import { JobHandlerRegistry } from '../../src/jobs/index';
import { WebhookDeliverHandler, parseRetryAfter, retryDelayMs, WEBHOOK_RETRY_SCHEDULE_MS } from '../../src/webhooks/index';
import { KIT_USER_A, createWebhooksTestKit, type WebhooksTestKit } from '../../src/webhooks/testing/index';

const NOW = new Date('2026-11-01T10:00:00.000Z');
const SYSTEM_BODY = { name: 'ops', url: 'https://receiver.example.test/in?token=abc123', eventKeys: ['nodes.*'], enabled: true };

async function setup(options: Parameters<typeof createWebhooksTestKit>[0] = {}): Promise<{ kit: WebhooksTestKit; endpointId: string; secret: string; send: () => Promise<string> }> {
  const kit = createWebhooksTestKit(options);
  kit.setNow(() => NOW);
  kit.deliver.rand = () => 0;
  const ctx = kit.context('system');
  const created = await kit.endpoints.create(ctx, SYSTEM_BODY);
  const send = async () => (await kit.endpoints.test(ctx, created.endpoint.id)).deliveryId;
  return { kit, endpointId: created.endpoint.id, secret: created.secret, send };
}

const delivery = (kit: WebhooksTestKit, id: string) => kit.repository.deliveries.get(id)!;
const endpoint = (kit: WebhooksTestKit, id: string) => kit.repository.endpoints.get(id)!;

describe('WebhookDeliverHandler', () => {
  it('succeeds on a 2xx: stores the status and snippet, resets the failure count, signs the exact body', async () => {
    const { kit, endpointId, secret, send } = await setup();
    endpoint(kit, endpointId).consecutiveFailures = 4;
    kit.receiver.answerWith({ status: 202, snippet: 'accepted' });
    const id = await send();
    await kit.runDeliveryJob(id, null);

    expect(delivery(kit, id)).toMatchObject({ status: 'succeeded', attempt: 1, responseStatus: 202, responseSnippet: 'accepted', errorCode: null, deliveredAt: NOW, nextAttemptAt: null });
    expect(delivery(kit, id).durationMs).toEqual(expect.any(Number));
    expect(endpoint(kit, endpointId)).toMatchObject({ consecutiveFailures: 0, lastSuccessAt: NOW, lastDeliveryAt: NOW });

    const request = kit.receiver.requests[0]!;
    expect(request.target).toMatchObject({ hostname: 'receiver.example.test', address: '93.184.216.34' });
    expect(request.timeoutMs).toBe(10_000);
    expect(request.body).toBe(JSON.stringify(delivery(kit, id).payload));
    expect(request.headers[WEBHOOK_HEADERS.ID]).toBe(delivery(kit, id).eventId);
    expect(request.headers[WEBHOOK_HEADERS.TIMESTAMP]).toBe(String(Math.floor(NOW.getTime() / 1000)));
    expect(request.headers['user-agent']).toBe('App-Webhooks/1.0');
    await expect(
      verifyWebhookSignature({ secret, id: request.headers[WEBHOOK_HEADERS.ID]!, timestamp: request.headers[WEBHOOK_HEADERS.TIMESTAMP]!, body: request.body, signatureHeader: request.headers[WEBHOOK_HEADERS.SIGNATURE]!, now: NOW.getTime() }),
    ).resolves.toBe(true);
  });

  it('uses the product name in the User-Agent', async () => {
    const { kit, send } = await setup({ appName: 'Acme Console!' });
    await kit.runDeliveryJob(await send(), null);
    expect(kit.receiver.requests[0]!.headers['user-agent']).toBe('Acme-Console-Webhooks/1.0');
  });

  it.each([
    [400, 'http_4xx'],
    [404, 'http_4xx'],
    [500, 'http_5xx'],
    [503, 'http_5xx'],
    [302, 'http_3xx'],
  ])('a %s answer is a failed attempt (%s) that schedules the first retry and counts toward the breaker', async (status, code) => {
    const { kit, endpointId, send } = await setup();
    kit.receiver.answerWith({ status, snippet: 'nope' });
    const id = await send();
    await kit.runDeliveryJob(id, null);

    expect(delivery(kit, id)).toMatchObject({ status: 'failed', attempt: 1, responseStatus: status, errorCode: code, responseSnippet: 'nope' });
    // First retry: 30 s schedule entry, jitter pinned to its lower half by rand = 0.
    expect(delivery(kit, id).nextAttemptAt).toEqual(new Date(NOW.getTime() + 15_000));
    expect(kit.repository.enqueued.at(-1)).toEqual({ deliveryId: id, orgId: null, reason: 'rerun', scheduledFor: new Date(NOW.getTime() + 15_000) });
    expect(endpoint(kit, endpointId)).toMatchObject({ consecutiveFailures: 1, lastSuccessAt: null, enabled: true });
  });

  it('honours Retry-After on a 429 and a 503 (seconds and HTTP date), above the schedule', async () => {
    const { kit, send } = await setup();
    kit.receiver.answerWith({ status: 429, retryAfter: '3600' }, { status: 503, retryAfter: new Date(NOW.getTime() + 7_200_000).toUTCString() });
    const first = await send();
    await kit.runDeliveryJob(first, null);
    expect(delivery(kit, first).nextAttemptAt).toEqual(new Date(NOW.getTime() + 3_600_000));
    const second = await send();
    await kit.runDeliveryJob(second, null);
    expect(delivery(kit, second).nextAttemptAt).toEqual(new Date(NOW.getTime() + 7_200_000));
  });

  it('retries along the schedule: attempts 1, 2, 3 wait 30 s, 2 min and 10 min (lower jitter bound)', async () => {
    const { kit, send } = await setup({ circuitBreakerThreshold: 100 });
    kit.receiver.answerWith({ status: 500 });
    const id = await send();
    const waits: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await kit.runDeliveryJob(id, null);
      waits.push(delivery(kit, id).nextAttemptAt!.getTime() - NOW.getTime());
    }
    expect(waits).toEqual([15_000, 60_000, 300_000]);
    expect(delivery(kit, id).attempt).toBe(3);
  });

  it.each([
    ['timeout', 'timeout'],
    ['network', 'network'],
  ] as const)('a %s is a failed attempt coded %s', async (fail, code) => {
    const { kit, send } = await setup();
    kit.receiver.answerWith({ fail });
    const id = await send();
    await kit.runDeliveryJob(id, null);
    expect(delivery(kit, id)).toMatchObject({ status: 'failed', errorCode: code, responseStatus: null });
  });

  it('goes dead after the last attempt and queues no further retry', async () => {
    const { kit, endpointId, send } = await setup({ maxDeliveryAttempts: 2 });
    kit.receiver.answerWith({ status: 500 });
    const id = await send();
    await kit.runDeliveryJob(id, null);
    expect(delivery(kit, id).status).toBe('failed');
    const queued = kit.repository.enqueued.length;
    await kit.runDeliveryJob(id, null);
    expect(delivery(kit, id)).toMatchObject({ status: 'dead', attempt: 2, nextAttemptAt: null });
    expect(kit.repository.enqueued).toHaveLength(queued);
    expect(endpoint(kit, endpointId).consecutiveFailures).toBe(2);
  });

  it('410 Gone disables the endpoint at once, ends the delivery dead and tells the owner', async () => {
    const { kit, endpointId, send } = await setup();
    kit.receiver.answerWith({ status: 410 });
    const id = await send();
    await kit.runDeliveryJob(id, null);
    expect(delivery(kit, id)).toMatchObject({ status: 'dead', errorCode: 'http_410', nextAttemptAt: null });
    expect(endpoint(kit, endpointId)).toMatchObject({ enabled: false, disabledReason: 'gone' });
    expect(kit.notified).toEqual([{ eventKey: 'webhooks.endpoint_disabled', userId: KIT_USER_A, data: expect.objectContaining({ endpointId, reason: 'gone', scope: 'system', host: 'receiver.example.test' }) }]);
    expect(JSON.stringify(kit.notified)).not.toContain('abc123');
  });

  describe('circuit breaker', () => {
    it('switches the endpoint off at the threshold, tells the owner exactly once, and stops delivering', async () => {
      const { kit, endpointId, send } = await setup({ circuitBreakerThreshold: 3 });
      kit.receiver.answerWith({ status: 500 });
      const ids = [await send(), await send(), await send()];
      await kit.runDeliveryJob(ids[0]!, null);
      await kit.runDeliveryJob(ids[1]!, null);
      expect(endpoint(kit, endpointId).enabled).toBe(true);
      expect(kit.notified).toHaveLength(0);
      await kit.runDeliveryJob(ids[2]!, null);
      expect(endpoint(kit, endpointId)).toMatchObject({ enabled: false, disabledReason: 'circuit_open', consecutiveFailures: 3 });
      expect(kit.notified).toHaveLength(1);
      expect(kit.notified[0]).toMatchObject({ eventKey: 'webhooks.endpoint_disabled', data: { reason: 'circuit_open', endpointName: 'ops' } });

      // A pending retry now ends dead without a request or another notification.
      const requests = kit.receiver.requests.length;
      const [pending] = await kit.repository.insertDeliveries(null, [{ endpointId, eventKey: 'nodes.node.offline', eventId: '44444444-4444-4444-8444-444444444444', payload: { x: 1 } }]);
      await kit.runDeliveryJob(pending!.id, null);
      expect(delivery(kit, pending!.id)).toMatchObject({ status: 'dead', errorCode: 'endpoint_disabled' });
      expect(kit.receiver.requests).toHaveLength(requests);
      expect(kit.notified).toHaveLength(1);
    });

    it('a success in between resets the count', async () => {
      const { kit, endpointId, send } = await setup({ circuitBreakerThreshold: 3 });
      kit.receiver.answerWith({ status: 500 }, { status: 500 }, { status: 200 }, { status: 500 }, { status: 500 });
      for (let i = 0; i < 5; i += 1) await kit.runDeliveryJob(await send(), null);
      expect(endpoint(kit, endpointId)).toMatchObject({ enabled: true, consecutiveFailures: 2 });
    });
  });

  describe('egress', () => {
    it('refuses a target that now resolves to a private address: no request, delivery dead, ssrf_blocked', async () => {
      const { kit, endpointId, send } = await setup();
      kit.resolver.set('receiver.example.test', '169.254.169.254');
      const id = await send();
      await kit.runDeliveryJob(id, null);
      expect(kit.receiver.requests).toHaveLength(0);
      expect(delivery(kit, id)).toMatchObject({ status: 'dead', errorCode: 'ssrf_blocked', nextAttemptAt: null });
      expect(endpoint(kit, endpointId).consecutiveFailures).toBe(1);
    });

    it('treats a name that no longer resolves as a failed attempt to retry', async () => {
      const { kit, send } = await setup();
      kit.resolver.set('receiver.example.test');
      const id = await send();
      await kit.runDeliveryJob(id, null);
      expect(kit.receiver.requests).toHaveLength(0);
      expect(delivery(kit, id)).toMatchObject({ status: 'failed', errorCode: 'network' });
    });

    it('resolves the host again on every attempt (the checked address is the one connected to)', async () => {
      const { kit, send } = await setup({ circuitBreakerThreshold: 100 });
      kit.receiver.answerWith({ status: 500 });
      const id = await send();
      const before = kit.resolver.lookups.length;
      await kit.runDeliveryJob(id, null);
      kit.resolver.set('receiver.example.test', '93.184.216.35');
      await kit.runDeliveryJob(id, null);
      expect(kit.resolver.lookups.length).toBe(before + 2);
      expect(kit.receiver.requests.map((request) => request.target.address)).toEqual(['93.184.216.34', '93.184.216.35']);
    });
  });

  describe('rotation overlap', () => {
    it('signs with both secrets until the overlap ends, then with the current one only', async () => {
      const { kit, endpointId, secret, send } = await setup();
      const rotated = await kit.endpoints.rotateSecret(kit.context('system'), endpointId);
      await kit.runDeliveryJob(await send(), null);
      const during = kit.receiver.requests[0]!;
      expect(during.headers[WEBHOOK_HEADERS.SIGNATURE]!.split(' ')).toHaveLength(2);
      for (const key of [secret, rotated.secret]) {
        await expect(verifyWebhookSignature({ secret: key, id: during.headers[WEBHOOK_HEADERS.ID]!, timestamp: during.headers[WEBHOOK_HEADERS.TIMESTAMP]!, body: during.body, signatureHeader: during.headers[WEBHOOK_HEADERS.SIGNATURE]!, now: NOW.getTime() })).resolves.toBe(true);
      }

      kit.setNow(() => new Date(NOW.getTime() + 25 * 3_600_000));
      await kit.runDeliveryJob(await send(), null);
      const after = kit.receiver.requests[1]!;
      expect(after.headers[WEBHOOK_HEADERS.SIGNATURE]!.split(' ')).toHaveLength(1);
      await expect(verifyWebhookSignature({ secret, id: after.headers[WEBHOOK_HEADERS.ID]!, timestamp: after.headers[WEBHOOK_HEADERS.TIMESTAMP]!, body: after.body, signatureHeader: after.headers[WEBHOOK_HEADERS.SIGNATURE]!, now: NOW.getTime() + 25 * 3_600_000 })).resolves.toBe(false);
    });
  });

  describe('no-op and dead paths', () => {
    it('does nothing for a delivery that is gone or already succeeded', async () => {
      const { kit, send } = await setup();
      await kit.runDeliveryJob('00000000-0000-4000-8000-000000000000', null);
      const id = await send();
      await kit.runDeliveryJob(id, null);
      await kit.runDeliveryJob(id, null);
      expect(kit.receiver.requests).toHaveLength(1);
    });

    it('settles a delivery dead without a request when its endpoint is disabled, but still sends a test ping', async () => {
      const { kit, endpointId } = await setup();
      const ctx = kit.context('system');
      const event = await kit.webhooks.emit('nodes.node.offline', { nodeId: 'n', nodeName: 'n', lastHeartbeatAt: null, markedOfflineAt: NOW.toISOString(), staleAfterMinutes: 5 }, { orgId: null });
      expect(event.queued).toBe(0); // no owner permission loaded: the creator is checked and found to have no access
      const row = endpoint(kit, endpointId);
      const { deliveryId: ping } = await kit.endpoints.test(ctx, endpointId);
      row.enabled = false;
      await kit.runDeliveryJob(ping, null);
      expect(delivery(kit, ping).status).toBe('succeeded');

      const seeded = [...kit.repository.deliveries.values()].length;
      expect(seeded).toBe(1);
      const other = (await kit.repository.insertDeliveries(null, [{ endpointId, eventKey: 'nodes.node.offline', eventId: '33333333-3333-4333-8333-333333333333', payload: { x: 1 } }]))[0]!;
      await kit.runDeliveryJob(other.id, null);
      expect(delivery(kit, other.id)).toMatchObject({ status: 'dead', errorCode: 'endpoint_disabled' });
      expect(kit.receiver.requests).toHaveLength(1);
    });

    it('settles dead when the signing secret is missing', async () => {
      const { kit, send } = await setup();
      kit.secrets.stored.clear();
      const id = await send();
      await kit.runDeliveryJob(id, null);
      expect(delivery(kit, id)).toMatchObject({ status: 'dead', errorCode: 'secret_missing' });
      expect(kit.receiver.requests).toHaveLength(0);
    });

    it('rejects a job with no delivery id', async () => {
      const { kit } = await setup();
      await expect(kit.deliver.process({ id: 'j', type: 'webhooks.deliver', subjectId: null, orgId: null } as never)).rejects.toThrow('names no delivery');
    });
  });

  it('keeps the URL path and query, and the secrets, out of the logs', async () => {
    const { kit, secret, send } = await setup({ circuitBreakerThreshold: 1 });
    const lines: string[] = [];
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((level) =>
      jest.spyOn(require('@nestjs/common').Logger.prototype, level).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' '))),
    );
    try {
      kit.receiver.answerWith({ status: 500, snippet: 'boom' });
      await kit.runDeliveryJob(await send(), null);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
    const text = lines.join('\n');
    expect(text).toContain('receiver.example.test');
    expect(text).not.toMatch(/abc123|token=|\/in\b/);
    expect(text).not.toContain(secret);
  });

  it.each([
    ['a 0 ms attempt', 0],
    ['a non-zero attempt', 250],
  ])('counts the outcome and the duration in the metrics, with bounded labels (%s)', async (_label, elapsedMs) => {
    const kit = createWebhooksTestKit();
    const added: unknown[][] = [];
    const recorded: unknown[][] = [];
    const metrics = { add: (...args: unknown[]) => added.push(args), record: (...args: unknown[]) => recorded.push(args) } as never;
    const handler = new WebhookDeliverHandler(new JobHandlerRegistry(), kit.repository, kit.secrets, kit.options, kit.receiver, kit.resolver, undefined, metrics);
    const ctx = kit.context('system');
    const created = await kit.endpoints.create(ctx, SYSTEM_BODY);
    const { deliveryId } = await kit.endpoints.test(ctx, created.endpoint.id);
    // Pin the clock: the handler reads Date.now() once before and once after the attempt.
    let calls = 0;
    const now = jest.spyOn(Date, 'now').mockImplementation(() => 1_000_000 + (calls++ % 2 === 0 ? 0 : elapsedMs));
    try {
      await handler.process({ id: 'j', type: handler.type, subjectId: deliveryId, orgId: null } as never);
    } finally {
      now.mockRestore();
    }
    expect(added).toEqual([['webhookDeliveries', 1, { outcome: 'succeeded', event_group: 'webhooks' }]]);
    expect(recorded).toEqual([['webhookDeliveryDuration', elapsedMs / 1000, { outcome: 'succeeded', event_group: 'webhooks' }]]);
  });

  it('declares the server-only profile and no node eligibility', () => {
    const kit = createWebhooksTestKit();
    expect(kit.deliver.type).toBe('webhooks.deliver');
    expect(kit.deliver.profile).toEqual({ maxRuntimeMs: 30_000, maxAttempts: 10 });
    expect((kit.deliver as unknown as Record<string, unknown>).nodeResultSchema).toBeUndefined();
    expect((kit.deliver as unknown as Record<string, unknown>).persistNodeResult).toBeUndefined();
    expect((kit.deliver as unknown as Record<string, unknown>).nodeSecretBroker).toBeUndefined();
  });

  it('registers itself with the job registry', () => {
    const registry = new JobHandlerRegistry();
    const kit = createWebhooksTestKit();
    const handler = new WebhookDeliverHandler(registry, kit.repository, kit.secrets, kit.options, kit.receiver, kit.resolver);
    handler.onModuleInit();
    expect(registry.get('webhooks.deliver')).toBe(handler);
  });
});

describe('retryDelayMs', () => {
  it('follows the schedule with half-range jitter', () => {
    expect(WEBHOOK_RETRY_SCHEDULE_MS).toEqual([30_000, 120_000, 600_000, 1_800_000, 3_600_000, 7_200_000, 14_400_000, 21_600_000, 21_600_000]);
    WEBHOOK_RETRY_SCHEDULE_MS.forEach((base, index) => {
      expect(retryDelayMs(index + 1, null, () => 0)).toBe(base / 2);
      expect(retryDelayMs(index + 1, null, () => 1)).toBe(base);
    });
  });

  it('repeats the last entry past the schedule and clamps nonsense attempts', () => {
    expect(retryDelayMs(50, null, () => 1)).toBe(21_600_000);
    expect(retryDelayMs(0, null, () => 1)).toBe(30_000);
  });

  it('never waits less than Retry-After, and never more than 24 h of it', () => {
    expect(retryDelayMs(1, 600_000, () => 1)).toBe(600_000);
    expect(retryDelayMs(1, 10_000, () => 1)).toBe(30_000);
    expect(retryDelayMs(1, 99 * 3_600_000, () => 0)).toBe(24 * 3_600_000);
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds, dates and rejects the rest', () => {
    expect(parseRetryAfter('120')).toBe(120_000);
    expect(parseRetryAfter(' 5 ')).toBe(5_000);
    expect(parseRetryAfter(new Date(1_000_000 + 60_000).toUTCString(), 1_000_000)).toBeGreaterThanOrEqual(59_000);
    expect(parseRetryAfter('Wed, 21 Oct 2015 07:28:00 GMT', Date.now())).toBe(0);
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
});
