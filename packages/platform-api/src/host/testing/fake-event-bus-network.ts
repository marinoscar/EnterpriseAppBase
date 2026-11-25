// =============================================================================
// A fake "network" event bus for multi-replica tests (PP-1.11, issue #682)
// =============================================================================
//
// `FakeEventBusNetwork.join()` returns one `EventBus` per simulated replica.
// A publish is delivered to the publisher's own subscribers with
// `local: true` and to every OTHER member's subscribers with `local: false` —
// the contract the Postgres adapter keeps, without a database. It reuses the
// real dispatcher and envelope codec, so the size limit, JSON copies and
// handler isolation are the production ones.
//
// Packaged with the bus by #867 (it was the reference app's
// `test/helpers/fake-network-event-bus.helper.ts`).
// =============================================================================

import { Logger } from '@nestjs/common';

import { encodeEventBusEnvelope, EventBusDispatcher, isValidEventBusChannel } from '../event-bus/event-bus-core';
import type { EventBus, EventBusHandler, EventBusHealth } from '../event-bus/event-bus.interface';

/** One simulated replica's bus. */
class NetworkMember implements EventBus {
  readonly adapter = 'postgres' as const;
  readonly dispatcher = new EventBusDispatcher(new Logger('FakeEventBus'));
  publishFailures = 0;

  constructor(
    readonly origin: string,
    private readonly network: FakeEventBusNetwork,
  ) {}

  async publish<T>(channel: string, payload: T): Promise<void> {
    if (!isValidEventBusChannel(channel)) {
      this.publishFailures += 1;
      return;
    }

    let encoded: string;
    try {
      encoded = encodeEventBusEnvelope(channel, this.origin, payload);
    } catch {
      this.publishFailures += 1;
      return;
    }

    this.network.broadcast(this, channel, encoded);
  }

  subscribe<T>(channel: string, handler: EventBusHandler<T>): () => void {
    return this.dispatcher.subscribe(channel, handler);
  }

  health(): EventBusHealth {
    return {
      adapter: this.adapter,
      connected: true,
      lastError: null,
      lastConnectedAt: null,
      publishFailures: this.publishFailures,
      reconnects: 0,
    };
  }
}

/**
 * A simulated set of API replicas sharing one bus: `join(origin)` returns that
 * replica's `EventBus`. A publish reaches the publisher's own subscribers with
 * `local: true` and every other member's with `local: false`, the contract the
 * Postgres adapter keeps, without a database.
 *
 * @example
 * ```ts
 * const network = new FakeEventBusNetwork();
 * const a = network.join('replica-a');
 * const b = network.join('replica-b');
 * b.subscribe('notifications.stream', handler);
 * await a.publish('notifications.stream', { id: 'n-1' });
 * await flushEventBus();
 * ```
 *
 * @stability experimental
 */
export class FakeEventBusNetwork {
  private readonly members: NetworkMember[] = [];

  /**
   * Adds a replica.
   *
   * @param origin - the replica's origin id.
   * @returns its bus.
   */
  join(origin: string): EventBus {
    const member = new NetworkMember(origin, this);
    this.members.push(member);
    return member;
  }

  /**
   * Delivers one encoded envelope to every member. Called by a member's publish.
   *
   * @param from - the publishing member.
   * @param channel - the logical channel.
   * @param encoded - the encoded envelope.
   */
  broadcast(from: EventBus, channel: string, encoded: string): void {
    for (const member of this.members) {
      member.dispatcher.dispatch(channel, encoded, { origin: from.origin, local: member === from });
    }
  }
}

/**
 * Lets microtask-scheduled deliveries (and the promises they start) run.
 *
 * @param turns - how many `setImmediate` turns to wait.
 * @stability experimental
 */
export async function flushEventBus(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
