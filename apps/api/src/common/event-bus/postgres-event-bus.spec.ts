import { EventEmitter } from 'node:events';

import { Logger } from '@nestjs/common';
import type { Notification } from 'pg';

import { encodeEventBusEnvelope } from './event-bus-core';
import { EVENT_BUS_MAX_PAYLOAD_BYTES } from './event-bus.interface';
import {
  EVENT_BUS_PG_CHANNEL,
  EventBusListenerClient,
  PostgresEventBus,
  eventBusBackoffMs,
} from './postgres-event-bus';

// =============================================================================
// PostgresEventBus — unit tests over a fake listener (PP-1.11, issue #682)
// =============================================================================
//
// The real-Postgres behaviour (two buses, pg_terminate_backend) is proven in
// test/event-bus/postgres-event-bus.db.spec.ts. This file covers the decisions
// that need no database: origin suppression, routing, backoff and the
// never-block-startup rule.
// =============================================================================

class FakeClient extends EventEmitter implements EventBusListenerClient {
  connectError: Error | null = null;
  queries: string[] = [];
  ended = false;

  async connect(): Promise<void> {
    if (this.connectError) throw this.connectError;
  }

  async query(text: string): Promise<{ rows: Array<Record<string, unknown>> }> {
    this.queries.push(text);
    return { rows: [{ pid: 4242 }] };
  }

  async end(): Promise<void> {
    this.ended = true;
  }

  notify(payload: string, channel = EVENT_BUS_PG_CHANNEL): void {
    this.emit('notification', { processId: 1, channel, payload } as Notification);
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

function makeBus(clients: FakeClient[], executeRaw = jest.fn().mockResolvedValue(1), initialBackoffMs = 5) {
  let index = 0;
  const created: FakeClient[] = [];
  const bus = new PostgresEventBus(
    { $executeRaw: executeRaw },
    {
      connectionString: 'postgresql://unused',
      origin: 'me',
      initialBackoffMs,
      maxBackoffMs: Math.max(20, initialBackoffMs),
      random: () => 0,
      createClient: () => {
        const client = clients[Math.min(index, clients.length - 1)];
        index += 1;
        created.push(client);
        return client;
      },
    },
  );
  return { bus, executeRaw, created };
}

describe('PostgresEventBus (fake listener)', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('LISTENs once on the physical channel and reports connected', async () => {
    const client = new FakeClient();
    const { bus } = makeBus([client]);

    bus.start();
    await flush();

    expect(client.queries).toContain(`LISTEN ${EVENT_BUS_PG_CHANNEL}`);
    expect(bus.health()).toMatchObject({ adapter: 'postgres', connected: true, lastError: null });
    expect(bus.listenerPid()).toBe(4242);

    // Subscribing issues no SQL.
    const before = client.queries.length;
    bus.subscribe('test.channel', jest.fn())();
    expect(client.queries.length).toBe(before);

    await bus.close();
    expect(client.ended).toBe(true);
    expect(bus.health().connected).toBe(false);
  });

  it('delivers locally first and publishes a parameterised pg_notify', async () => {
    const client = new FakeClient();
    const { bus, executeRaw } = makeBus([client]);
    const handler = jest.fn();
    bus.subscribe('test.channel', handler);

    await bus.publish('test.channel', { n: 1 });
    await flush();

    expect(handler).toHaveBeenCalledWith({ n: 1 }, { origin: 'me', local: true });
    const [strings, value] = executeRaw.mock.calls[0];
    expect((strings as TemplateStringsArray).join('?')).toBe("SELECT pg_notify('platform_bus', ?)");
    expect(JSON.parse(value as string)).toEqual({ v: 1, c: 'test.channel', o: 'me', p: { n: 1 } });
  });

  it('drops its own echo and dispatches remote messages as non-local', async () => {
    const client = new FakeClient();
    const { bus } = makeBus([client]);
    const handler = jest.fn();
    bus.subscribe('test.channel', handler);
    bus.start();
    await flush();

    client.notify(encodeEventBusEnvelope('test.channel', 'me', { echo: true }));
    client.notify(encodeEventBusEnvelope('test.channel', 'other', { remote: true }));
    client.notify(encodeEventBusEnvelope('test.elsewhere', 'other', { ignored: true }));
    client.notify('not json');
    client.notify(encodeEventBusEnvelope('test.channel', 'other', { wrong: 'channel' }), 'some_other_channel');
    await flush();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ remote: true }, { origin: 'other', local: false });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('malformed'));

    await bus.close();
  });

  it('never rejects when NOTIFY fails, and counts the failure', async () => {
    const client = new FakeClient();
    const { bus } = makeBus([client], jest.fn().mockRejectedValue(new Error('db down')));
    const handler = jest.fn();
    bus.subscribe('test.channel', handler);

    await expect(bus.publish('test.channel', {})).resolves.toBeUndefined();
    await flush();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(bus.health().publishFailures).toBe(1);
    expect(bus.health().lastError).toContain('db down');
  });

  it('rejects an oversize payload without sending a NOTIFY', async () => {
    const { bus, executeRaw } = makeBus([new FakeClient()]);

    await bus.publish('test.channel', { blob: 'x'.repeat(EVENT_BUS_MAX_PAYLOAD_BYTES) });

    expect(executeRaw).not.toHaveBeenCalled();
    expect(bus.health().publishFailures).toBe(1);
  });

  it('does not block startup on a failed first connect, and keeps retrying', async () => {
    const failing = new FakeClient();
    failing.connectError = new Error('connection refused');
    const healthy = new FakeClient();
    const { bus } = makeBus([failing, healthy], undefined, 100);

    bus.start();
    await flush();
    expect(bus.health()).toMatchObject({ connected: false, lastError: 'connection refused', reconnects: 1 });

    await waitFor(() => bus.health().connected);
    expect(healthy.queries).toContain(`LISTEN ${EVENT_BUS_PG_CHANNEL}`);
    await bus.close();
  });

  it('reconnects after the session ends and re-LISTENs', async () => {
    const first = new FakeClient();
    const second = new FakeClient();
    const { bus } = makeBus([first, second]);

    bus.start();
    await flush();
    first.emit('error', new Error('terminating connection due to administrator command'));
    first.emit('end');

    expect(bus.health().connected).toBe(false);
    expect(bus.health().reconnects).toBe(1);

    await waitFor(() => bus.health().connected);
    expect(second.queries).toContain(`LISTEN ${EVENT_BUS_PG_CHANNEL}`);
    await bus.close();
  });

  it('stops reconnecting once closed', async () => {
    const failing = new FakeClient();
    failing.connectError = new Error('nope');
    // A backoff long enough that the flush below cannot outlast it on a slow machine.
    const { bus, created } = makeBus([failing], undefined, 200);

    bus.start();
    await flush();
    expect(bus.health().reconnects).toBe(1);
    await bus.close();
    await new Promise((resolve) => setTimeout(resolve, 260));

    expect(created).toHaveLength(1);
  });
});

describe('eventBusBackoffMs', () => {
  it('doubles from 1 s to a 30 s cap', () => {
    const noJitter = () => 0;
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => eventBusBackoffMs(n, 1_000, 30_000, noJitter))).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]);
  });

  it('adds at most 20% jitter and never exceeds the cap', () => {
    expect(eventBusBackoffMs(0, 1_000, 30_000, () => 1)).toBe(1_200);
    expect(eventBusBackoffMs(10, 1_000, 30_000, () => 1)).toBe(30_000);
  });
});
