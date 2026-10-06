import { Logger } from '@nestjs/common';

import { decodeEventBusEnvelope, encodeEventBusEnvelope, exceedsEventBusPayloadLimit } from './event-bus-core';
import { EVENT_BUS_MAX_PAYLOAD_BYTES, EventBusMeta, EventBusPayloadTooLargeError } from './event-bus.interface';
import { InProcessEventBus } from './in-process-event-bus';

// =============================================================================
// InProcessEventBus — unit tests (PP-1.11, issue #682)
// =============================================================================

/** Lets queued microtasks (and the promise jobs they schedule) run. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('InProcessEventBus', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('delivers to local subscribers once, with local meta and its own origin', async () => {
    const bus = new InProcessEventBus('origin-a');
    const seen: Array<[unknown, EventBusMeta]> = [];
    bus.subscribe('test.channel', (payload, meta) => {
      seen.push([payload, meta]);
    });

    await bus.publish('test.channel', { n: 1 });
    await flush();

    expect(seen).toEqual([[{ n: 1 }, { origin: 'origin-a', local: true }]]);
  });

  it('never runs a handler inside the publisher stack', async () => {
    const bus = new InProcessEventBus();
    const order: string[] = [];
    bus.subscribe('test.channel', () => {
      order.push('handler');
    });

    void bus.publish('test.channel', {});
    order.push('after-publish');
    await flush();

    expect(order).toEqual(['after-publish', 'handler']);
  });

  it('preserves publish order on a channel', async () => {
    const bus = new InProcessEventBus();
    const seen: number[] = [];
    bus.subscribe<{ n: number }>('test.channel', ({ n }) => {
      seen.push(n);
    });

    for (let n = 0; n < 5; n += 1) void bus.publish('test.channel', { n });
    await flush();

    expect(seen).toEqual([0, 1, 2, 3, 4]);
  });

  it('routes by channel: a subscriber never sees another channel', async () => {
    const bus = new InProcessEventBus();
    const a = jest.fn();
    const b = jest.fn();
    bus.subscribe('test.alpha', a);
    bus.subscribe('test.beta', b);

    await bus.publish('test.alpha', { x: 1 });
    await flush();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('unsubscribe stops delivery and removes only that registration', async () => {
    const bus = new InProcessEventBus();
    const handler = jest.fn();
    const off1 = bus.subscribe('test.channel', handler);
    bus.subscribe('test.channel', handler);

    off1();
    off1(); // idempotent
    await bus.publish('test.channel', {});
    await flush();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(bus.handlerCount('test.channel')).toBe(1);
  });

  it('isolates a throwing or rejecting handler from the others and from the publisher', async () => {
    const bus = new InProcessEventBus();
    const good = jest.fn();
    bus.subscribe('test.channel', () => {
      throw new Error('sync boom');
    });
    bus.subscribe('test.channel', async () => {
      throw new Error('async boom');
    });
    bus.subscribe('test.channel', good);

    await expect(bus.publish('test.channel', { secret: 'payload-content' })).resolves.toBeUndefined();
    await flush();

    expect(good).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(2);
    // The channel is logged; the payload never is.
    for (const [message] of warn.mock.calls) {
      expect(String(message)).toContain('test.channel');
      expect(String(message)).not.toContain('payload-content');
    }
  });

  it('gives each handler its own JSON copy of the payload', async () => {
    const bus = new InProcessEventBus();
    const received: unknown[] = [];
    bus.subscribe<{ list: number[]; at: unknown }>('test.channel', (payload) => {
      payload.list.push(99);
      received.push(payload);
    });
    bus.subscribe('test.channel', (payload) => {
      received.push(payload);
    });

    const original = { list: [1], at: new Date('2026-01-01T00:00:00.000Z') };
    await bus.publish('test.channel', original);
    await flush();

    expect(original.list).toEqual([1]);
    expect(received[1]).toEqual({ list: [1], at: '2026-01-01T00:00:00.000Z' });
  });

  it('rejects an oversize payload locally without throwing, and counts it', async () => {
    const bus = new InProcessEventBus();
    const handler = jest.fn();
    bus.subscribe('test.channel', handler);

    await expect(
      bus.publish('test.channel', { blob: 'x'.repeat(EVENT_BUS_MAX_PAYLOAD_BYTES) }),
    ).resolves.toBeUndefined();
    await flush();

    expect(handler).not.toHaveBeenCalled();
    expect(bus.health().publishFailures).toBe(1);
    expect(String(warn.mock.calls[0][0])).toContain('limit');
  });

  it('refuses an invalid channel on publish (logged) and on subscribe (thrown)', async () => {
    const bus = new InProcessEventBus();

    await expect(bus.publish('Not A Channel', {})).resolves.toBeUndefined();
    expect(bus.health().publishFailures).toBe(1);
    expect(() => bus.subscribe('nodots', jest.fn())).toThrow(/Invalid event bus channel/);
  });

  it('reports itself as always connected', () => {
    const health = new InProcessEventBus().health();
    expect(health).toMatchObject({ adapter: 'in-process', connected: true, reconnects: 0, lastError: null });
    expect(typeof health.lastConnectedAt).toBe('string');
  });
});

describe('event bus envelope helpers', () => {
  it('round-trips an envelope', () => {
    const text = encodeEventBusEnvelope('test.channel', 'o1', { a: 1 });
    expect(decodeEventBusEnvelope(text)).toEqual({ v: 1, c: 'test.channel', o: 'o1', p: { a: 1 } });
  });

  it('measures the limit in UTF-8 bytes, not characters', () => {
    // 2,000 four-byte characters: 2,000 characters, 8,000 bytes.
    const payload = { body: '\u{1F600}'.repeat(2_000) };
    expect(exceedsEventBusPayloadLimit('test.channel', payload)).toBe(true);
    expect(() => encodeEventBusEnvelope('test.channel', 'o', payload)).toThrow(EventBusPayloadTooLargeError);
    expect(exceedsEventBusPayloadLimit('test.channel', { body: 'short' })).toBe(false);
  });

  it.each([
    ['not json', '{'],
    ['empty', ''],
    ['wrong version', JSON.stringify({ v: 2, c: 'a.b', o: 'o', p: 1 })],
    ['bad channel', JSON.stringify({ v: 1, c: 'A', o: 'o', p: 1 })],
    ['no origin', JSON.stringify({ v: 1, c: 'a.b', p: 1 })],
    ['no payload', JSON.stringify({ v: 1, c: 'a.b', o: 'o' })],
    ['not an object', '42'],
  ])('drops a malformed envelope (%s)', (_label, text) => {
    expect(decodeEventBusEnvelope(text)).toBeNull();
  });
});

describe('InProcessEventBus metrics (#680)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('counts a publish as published and delivered locally, and a refused one as rejected', async () => {
    const metrics = { published: jest.fn(), delivered: jest.fn(), reconnect: jest.fn() };
    const bus = new InProcessEventBus('origin-a', metrics);

    await bus.publish('test.channel', { n: 1 });
    await bus.publish('test.channel', { blob: 'x'.repeat(EVENT_BUS_MAX_PAYLOAD_BYTES) });
    await bus.publish('Not A Channel', {});

    expect(metrics.published.mock.calls).toEqual([
      ['test.channel', 'published'],
      ['test.channel', 'rejected'],
      ['Not A Channel', 'rejected'],
    ]);
    expect(metrics.delivered.mock.calls).toEqual([['test.channel', 'local']]);
    expect(metrics.reconnect).not.toHaveBeenCalled();
  });
});
