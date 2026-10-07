// The principal cache's bus when the app binds no `IDENTITY_EVENT_BUS` (a test
// graph built from one module): this process only, delivered synchronously and
// marked `local`, so the cache (which applies its own invalidations itself)
// ignores its own messages exactly as on the app's in-process bus.
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { IdentityEventBus, IdentityEventBusHealth, IdentityEventBusMeta } from '../../ports';

type Handler = (payload: unknown, meta: IdentityEventBusMeta) => void | Promise<void>;

/** A single-process bus with the `in-process` adapter's semantics. */
export class LocalIdentityEventBus implements IdentityEventBus {
  readonly adapter = 'in-process';
  private readonly origin = randomUUID();
  private readonly startedAt = new Date().toISOString();
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly logger = new Logger(LocalIdentityEventBus.name);

  async publish<T>(channel: string, payload: T): Promise<void> {
    // A JSON round trip, as a real bus would serialise it.
    const copy = JSON.parse(JSON.stringify(payload ?? null)) as unknown;
    for (const handler of [...(this.handlers.get(channel) ?? [])]) {
      try {
        await handler(copy, { origin: this.origin, local: true });
      } catch (error) {
        this.logger.warn(`A handler on "${channel}" threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  subscribe<T>(channel: string, handler: (payload: T, meta: IdentityEventBusMeta) => void | Promise<void>): () => void {
    const set = this.handlers.get(channel) ?? new Set<Handler>();
    set.add(handler as Handler);
    this.handlers.set(channel, set);
    return () => {
      set.delete(handler as Handler);
    };
  }

  health(): IdentityEventBusHealth {
    return {
      adapter: this.adapter,
      connected: true,
      lastError: null,
      lastConnectedAt: this.startedAt,
      publishFailures: 0,
      reconnects: 0,
    };
  }
}
