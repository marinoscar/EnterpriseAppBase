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

/**
 * The single-process adapter: a `Map` in this heap. The default.
 *
 * @stability experimental
 */
export class InProcessEventBus implements EventBus {
  /** Always `in-process`. */
  readonly adapter = 'in-process' as const;
  /** This process's origin id. */
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

  /**
   * Delivers locally (and, on a shared adapter, to every other replica). Never rejects.
   *
   * @param channel - a logical channel ({@link EVENT_BUS_CHANNEL_PATTERN}).
   * @param payload - JSON-serialisable data, at most {@link EVENT_BUS_MAX_PAYLOAD_BYTES} encoded.
   */
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

  /**
   * Registers a handler; returns its unsubscribe function.
   *
   * @param channel - a logical channel.
   * @param handler - called once per message, isolated from the publisher.
   * @returns the unsubscribe function.
   */
  subscribe<T>(channel: string, handler: EventBusHandler<T>): () => void {
    return this.dispatcher.subscribe(channel, handler);
  }

  /**
   * A synchronous snapshot; performs no I/O.
   *
   * @returns the bus's health.
   */
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

  /** Drops every handler. Idempotent; there is no connection to release. */
  async close(): Promise<void> {
    this.dispatcher.clear();
  }

  /**
   * Handlers on a channel. Diagnostics and tests only.
   *
   * @param channel - a logical channel.
   * @returns how many handlers are subscribed.
   */
  handlerCount(channel: string): number {
    return this.dispatcher.handlerCount(channel);
  }

  private recordFailure(message: string): void {
    this.publishFailures += 1;
    this.lastError = message;
    this.logger.warn(message);
  }
}
