// =============================================================================
// Event bus adapter conformance kit (PP-14.2, issue #920)
// =============================================================================
//
// ONE suite every event bus adapter runs, so "implements EventBus" means the
// same thing for the built-ins and for an app's own (Redis, NATS, a recording
// double). It checks what the rules at the top of `event-bus.interface.ts` make
// observable from ONE process, which every adapter must honour: local delivery,
// per-channel order, channel isolation, a JSON round trip, isolated handler
// failures, a `publish` that never rejects, unsubscribe, `health()` and
// `close()`. Cross-replica delivery needs a second process and is out of scope.
//
// It is runner-agnostic: it receives `describe`, `it` and `expect`, so Jest and
// Vitest both work and the package needs no test-framework import.
//
//   import { describeEventBusConformance } from '@marinoscar/platform-api/host/testing';
//
//   describeEventBusConformance(() => new RecordingEventBus(), { describe, it, expect });
// =============================================================================

import type { EventBus, EventBusMeta } from '../event-bus/event-bus.interface';

/**
 * The test runner's own globals, passed in.
 *
 * @stability experimental
 */
export interface EventBusConformanceHarness {
  /** The runner's `describe`. */
  describe: (name: string, fn: () => void) => unknown;
  /** The runner's `it`. Every case body the kit passes is an async function. */
  it: (name: string, fn: () => Promise<void>) => unknown;
  /** The runner's `expect`. */
  expect: (actual: unknown) => any;
}

/**
 * Options of {@link describeEventBusConformance}.
 *
 * @stability experimental
 */
export interface EventBusConformanceOptions {
  /**
   * How long to wait for a message to arrive, in milliseconds. Default 1000.
   * Delivery is a microtask on the built-ins; an adapter that delivers local
   * messages through a broker round trip may need more.
   */
  deliveryTimeoutMs?: number;
}

/** A bus, or a factory of fresh ones (closed after each case). */
type BusSource = EventBus | (() => EventBus | Promise<EventBus>);

interface Received {
  payload: unknown;
  meta: EventBusMeta;
}

const DEFAULT_DELIVERY_TIMEOUT_MS = 1_000;

/** Polls `predicate` until it holds or `timeoutMs` passes. */
async function until(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
  return true;
}

/** Gives anything still in flight a chance to arrive, to prove a message did NOT. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 2));
}

/**
 * Registers the event bus conformance suite.
 *
 * @param source - the bus under test, or a factory of fresh buses. With a
 *   factory every case gets its own bus, closed afterwards; with an instance
 *   the cases share it and a last case closes it.
 * @param harness - the runner's `describe`, `it` and `expect`.
 * @param options - see {@link EventBusConformanceOptions}.
 *
 * @example
 * ```ts
 * describeEventBusConformance(() => new InProcessEventBus(), { describe, it, expect });
 * ```
 *
 * @extensionPoint testing
 * @stability experimental
 */
export function describeEventBusConformance(
  source: BusSource,
  harness: EventBusConformanceHarness,
  options: EventBusConformanceOptions = {},
): void {
  const { describe, it, expect } = harness;
  const timeoutMs = options.deliveryTimeoutMs ?? DEFAULT_DELIVERY_TIMEOUT_MS;
  const fresh = typeof source === 'function';
  const shared: EventBus | undefined = fresh ? undefined : source;

  // One case against a bus. A factory builds (and closes) one per case.
  const withBus = (run: (bus: EventBus) => Promise<void>) => async () => {
    const bus = fresh ? await source() : (shared as EventBus);
    try {
      await run(bus);
    } finally {
      if (fresh) await bus.close?.();
    }
  };

  const collect = (bus: EventBus, channel: string, into: Received[]): (() => void) =>
    bus.subscribe<unknown>(channel, (payload, meta) => {
      into.push({ payload, meta });
    });

  describe('event bus adapter conformance', () => {
    it(
      'delivers a published message to a subscriber on a dotted channel, locally',
      withBus(async (bus) => {
        const got: Received[] = [];
        const off = collect(bus, 'conformance.basic', got);

        await bus.publish('conformance.basic', { n: 1, text: 'hello' });

        expect(await until(() => got.length >= 1, timeoutMs)).toBe(true);
        await settle();
        expect(got).toHaveLength(1);
        expect(got[0]!.payload).toEqual({ n: 1, text: 'hello' });
        expect(got[0]!.meta.local).toBe(true);
        expect(got[0]!.meta.origin).toBe(bus.origin);
        off();
      }),
    );

    it(
      'hands every subscriber a JSON round-trip copy, never the published object',
      withBus(async (bus) => {
        const got: Received[] = [];
        const off = collect(bus, 'conformance.json', got);
        const published = { when: new Date('2026-01-02T03:04:05.000Z'), nested: { list: [1, 2] } };

        await bus.publish('conformance.json', published);

        expect(await until(() => got.length >= 1, timeoutMs)).toBe(true);
        expect(got[0]!.payload).toEqual({ when: '2026-01-02T03:04:05.000Z', nested: { list: [1, 2] } });
        expect(got[0]!.payload).not.toBe(published);
        off();
      }),
    );

    it(
      'delivers to every subscriber of the channel and to no other channel',
      withBus(async (bus) => {
        const first: Received[] = [];
        const second: Received[] = [];
        const other: Received[] = [];
        const offs = [
          collect(bus, 'conformance.fanout', first),
          collect(bus, 'conformance.fanout', second),
          collect(bus, 'conformance.elsewhere', other),
        ];

        await bus.publish('conformance.fanout', { id: 1 });

        expect(await until(() => first.length >= 1 && second.length >= 1, timeoutMs)).toBe(true);
        await settle();
        expect(first).toHaveLength(1);
        expect(second).toHaveLength(1);
        expect(other).toHaveLength(0);
        offs.forEach((off) => off());
      }),
    );

    it(
      'keeps the publish order on a channel',
      withBus(async (bus) => {
        const got: Received[] = [];
        const off = collect(bus, 'conformance.order', got);

        for (let n = 0; n < 20; n += 1) await bus.publish('conformance.order', { n });

        expect(await until(() => got.length >= 20, timeoutMs)).toBe(true);
        expect(got.map((received) => (received.payload as { n: number }).n)).toEqual(
          Array.from({ length: 20 }, (_, n) => n),
        );
        off();
      }),
    );

    it(
      'stops delivering after unsubscribe, and unsubscribing twice is harmless',
      withBus(async (bus) => {
        const kept: Received[] = [];
        const dropped: Received[] = [];
        const offKept = collect(bus, 'conformance.unsub', kept);
        const offDropped = collect(bus, 'conformance.unsub', dropped);

        await bus.publish('conformance.unsub', { step: 1 });
        expect(await until(() => kept.length >= 1 && dropped.length >= 1, timeoutMs)).toBe(true);

        offDropped();
        expect(() => offDropped()).not.toThrow();
        await bus.publish('conformance.unsub', { step: 2 });

        expect(await until(() => kept.length >= 2, timeoutMs)).toBe(true);
        await settle();
        expect(dropped).toHaveLength(1);
        offKept();
      }),
    );

    it(
      'isolates a failing handler from the other handlers and from the publisher',
      withBus(async (bus) => {
        const got: Received[] = [];
        const offThrowing = bus.subscribe('conformance.failing', () => {
          throw new Error('handler failure');
        });
        const offRejecting = bus.subscribe('conformance.failing', async () => {
          throw new Error('handler rejection');
        });
        const off = collect(bus, 'conformance.failing', got);

        await expect(bus.publish('conformance.failing', { ok: true })).resolves.toBeUndefined();

        expect(await until(() => got.length >= 1, timeoutMs)).toBe(true);
        offThrowing();
        offRejecting();
        off();
      }),
    );

    it(
      'does not throw publishing with no subscribers',
      withBus(async (bus) => {
        await expect(bus.publish('conformance.nobody', { listening: false })).resolves.toBeUndefined();
      }),
    );

    it(
      'never rejects a publish: a malformed channel or an oversize payload is refused locally',
      withBus(async (bus) => {
        const got: Received[] = [];
        const off = collect(bus, 'conformance.guarded', got);

        await expect(bus.publish('Not A Channel', { x: 1 })).resolves.toBeUndefined();
        await expect(bus.publish('conformance.guarded', { big: 'x'.repeat(20_000) })).resolves.toBeUndefined();

        await settle();
        expect(got).toHaveLength(0);
        off();
      }),
    );

    it(
      'throws only for a malformed channel on subscribe',
      withBus(async (bus) => {
        expect(() => bus.subscribe('NotAChannel', () => undefined)).toThrow();
        expect(() => bus.subscribe('conformance.fine', () => undefined)()).not.toThrow();
      }),
    );

    it(
      'reports a synchronous health snapshot for its own adapter',
      withBus(async (bus) => {
        const health = bus.health();

        expect(typeof bus.adapter).toBe('string');
        expect(bus.adapter).not.toBe('');
        expect(health.adapter).toBe(bus.adapter);
        expect(typeof health.connected).toBe('boolean');
        expect(typeof bus.origin).toBe('string');
        expect(health.publishFailures).toBeGreaterThanOrEqual(0);
        expect(health.reconnects).toBeGreaterThanOrEqual(0);
      }),
    );

    it(
      'closes, idempotently, and publishing afterwards still does not throw',
      async () => {
        const bus = fresh ? await source() : (shared as EventBus);
        await bus.close?.();
        await expect((async () => bus.close?.())()).resolves.toBeUndefined();
        await expect(bus.publish('conformance.closed', { late: true })).resolves.toBeUndefined();
      },
    );
  });
}
