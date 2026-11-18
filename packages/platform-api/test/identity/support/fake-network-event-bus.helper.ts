// A fake "network" event bus for multi-replica tests: a port of
// apps/api/test/helpers/fake-network-event-bus.helper.ts (#727) onto identity's
// IdentityEventBus. A publish reaches the publisher's own subscribers with
// `local: true` and every other member's with `local: false` (the contract the
// app's Postgres adapter keeps), after a JSON round trip, on a later turn.
import type { IdentityEventBus, IdentityEventBusHealth, IdentityEventBusMeta } from '../../../src/identity/index';

type Handler = (payload: unknown, meta: IdentityEventBusMeta) => void | Promise<void>;

const CHANNEL = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/;

class NetworkMember implements IdentityEventBus {
  readonly adapter = 'postgres';
  readonly handlers = new Map<string, Set<Handler>>();
  publishFailures = 0;

  constructor(
    readonly origin: string,
    private readonly network: FakeEventBusNetwork,
  ) {}

  async publish<T>(channel: string, payload: T): Promise<void> {
    if (!CHANNEL.test(channel)) {
      this.publishFailures += 1;
      return;
    }
    let encoded: string;
    try {
      encoded = JSON.stringify(payload ?? null);
    } catch {
      this.publishFailures += 1;
      return;
    }
    this.network.broadcast(this, channel, encoded);
  }

  subscribe<T>(channel: string, handler: (payload: T, meta: IdentityEventBusMeta) => void | Promise<void>): () => void {
    const set = this.handlers.get(channel) ?? new Set<Handler>();
    set.add(handler as Handler);
    this.handlers.set(channel, set);
    return () => set.delete(handler as Handler);
  }

  deliver(channel: string, encoded: string, meta: IdentityEventBusMeta): void {
    for (const handler of [...(this.handlers.get(channel) ?? [])]) {
      queueMicrotask(() => {
        try {
          void Promise.resolve(handler(JSON.parse(encoded) as unknown, meta)).catch(() => undefined);
        } catch {
          // handler isolation: one throwing subscriber never affects another
        }
      });
    }
  }

  health(): IdentityEventBusHealth {
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

/** One simulated network of replicas. */
export class FakeEventBusNetwork {
  private readonly members: NetworkMember[] = [];

  join(origin: string): IdentityEventBus {
    const member = new NetworkMember(origin, this);
    this.members.push(member);
    return member;
  }

  broadcast(from: NetworkMember, channel: string, encoded: string): void {
    for (const member of this.members) {
      member.deliver(channel, encoded, { origin: from.origin, local: member === from });
    }
  }
}

/** Lets microtask-scheduled deliveries (and the promises they start) run. */
export async function flushEventBus(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
