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
// Not a `*.spec.ts` file, so Jest never runs it as a suite.
// =============================================================================

import { Logger } from '@nestjs/common';

import {
  encodeEventBusEnvelope,
  EventBusDispatcher,
  isValidEventBusChannel,
} from '../../src/common/event-bus/event-bus-core';
import type { EventBus, EventBusHandler, EventBusHealth } from '../../src/common/event-bus/event-bus.interface';

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

export class FakeEventBusNetwork {
  private readonly members: NetworkMember[] = [];

  join(origin: string): EventBus {
    const member = new NetworkMember(origin, this);
    this.members.push(member);
    return member;
  }

  broadcast(from: NetworkMember, channel: string, encoded: string): void {
    for (const member of this.members) {
      member.dispatcher.dispatch(channel, encoded, { origin: from.origin, local: member === from });
    }
  }
}

/** Lets microtask-scheduled deliveries (and the promises they start) run. */
export async function flushEventBus(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
