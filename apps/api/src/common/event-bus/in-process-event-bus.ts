import { Logger } from '@nestjs/common';

import {
  describeEventBusError,
  encodeEventBusEnvelope,
  EventBusDispatcher,
  isValidEventBusChannel,
  newEventBusOrigin,
} from './event-bus-core';
import type { EventBus, EventBusHandler, EventBusHealth } from './event-bus.interface';
import { NOOP_EVENT_BUS_METRICS, type EventBusMetrics } from './event-bus.metrics';

// =============================================================================
// InProcessEventBus — the default adapter (PP-1.11, issue #682)
// =============================================================================
//
// One process, one heap, one `Map`. Exactly today's single-replica behaviour:
// a message reaches this process's subscribers and nobody else. It still
// applies every rule of the interface header that does not need a network —
// the channel rule, the size limit, JSON copies, microtask delivery, handler
// isolation — so code written against it behaves the same when a deployment
// switches to `postgres`.
//
// The right adapter for exactly ONE API replica (and for tests). With two or
// more, set `EVENT_BUS_ADAPTER=postgres`; the Doctor's `core.event-bus` check
// says so.
// =============================================================================

export class InProcessEventBus implements EventBus {
  readonly adapter = 'in-process' as const;
  readonly origin: string;

  private readonly logger = new Logger(InProcessEventBus.name);
  private readonly dispatcher = new EventBusDispatcher(this.logger);
  private readonly startedAt = new Date().toISOString();
  private publishFailures = 0;
  private lastError: string | null = null;

  constructor(
    origin: string = newEventBusOrigin(),
    private readonly metrics: EventBusMetrics = NOOP_EVENT_BUS_METRICS,
  ) {
    this.origin = origin;
  }

  async publish<T>(channel: string, payload: T): Promise<void> {
    if (!isValidEventBusChannel(channel)) {
      this.recordFailure(`Refusing to publish on invalid event bus channel "${String(channel)}".`);
      this.metrics.published(String(channel), 'rejected');
      return;
    }

    let encoded: string;
    try {
      encoded = encodeEventBusEnvelope(channel, this.origin, payload);
    } catch (error) {
      this.recordFailure(`Event bus publish on "${channel}" rejected: ${describeEventBusError(error)}`);
      this.metrics.published(channel, 'rejected');
      return;
    }

    this.dispatcher.dispatch(channel, encoded, { origin: this.origin, local: true });
    this.metrics.published(channel, 'published');
    this.metrics.delivered(channel, 'local');
  }

  subscribe<T>(channel: string, handler: EventBusHandler<T>): () => void {
    return this.dispatcher.subscribe(channel, handler);
  }

  health(): EventBusHealth {
    return {
      adapter: this.adapter,
      connected: true,
      lastError: this.lastError,
      lastConnectedAt: this.startedAt,
      publishFailures: this.publishFailures,
      reconnects: 0,
    };
  }

  /** Handlers on a channel. Diagnostics and tests only. */
  handlerCount(channel: string): number {
    return this.dispatcher.handlerCount(channel);
  }

  private recordFailure(message: string): void {
    this.publishFailures += 1;
    this.lastError = message;
    this.logger.warn(message);
  }
}
