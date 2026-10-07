import type { AppMetricDef } from '@marinoscar/platform-api/otel-core';
import type { EventBusAdapterName } from './event-bus.interface';

// =============================================================================
// Event bus metrics (issue #680, follow-up of PP-1.11 / #682)
// =============================================================================
//
// The bus's three counters, declared in the app-metric registry like every
// other `app.*` instrument (registered by `otel/app-metric.manifest.ts`) and
// emitted through `AppMetricsService.add`. The adapters stay framework-free:
// they report to the small {@link EventBusMetrics} sink the module builds.
//
// Labels are the adapter, the LOGICAL channel (a code constant such as
// `notifications.stream`, bounded like any free label) and an outcome or
// origin. Never a payload, a user id or an error message.
// =============================================================================

/** How one `publish` call ended. */
export type EventBusPublishOutcome =
  /** Encoded and delivered locally (and, on `postgres`, NOTIFYed). */
  | 'published'
  /** Refused before delivery: an invalid channel, an oversize or unserialisable payload. */
  | 'rejected'
  /** `postgres` only: delivered locally, but the NOTIFY failed, so other replicas miss it. */
  | 'notify_failed';

const ADAPTER = { kind: 'enum', values: ['in-process', 'postgres'] } as const;

export const EVENT_BUS_APP_METRICS = [
  {
    key: 'eventBusPublished',
    name: 'app.event_bus.published',
    kind: 'counter',
    unit: '{message}',
    description: 'Messages published on the event bus, by adapter, channel and outcome.',
    attributes: {
      adapter: ADAPTER,
      channel: { kind: 'free' },
      outcome: { kind: 'enum', values: ['published', 'rejected', 'notify_failed'] },
    },
  },
  {
    key: 'eventBusDelivered',
    name: 'app.event_bus.delivered',
    kind: 'counter',
    unit: '{message}',
    description:
      "Messages handed to this process's subscribers, by adapter, channel and origin (local: published here; remote: another replica).",
    attributes: {
      adapter: ADAPTER,
      channel: { kind: 'free' },
      origin: { kind: 'enum', values: ['local', 'remote'] },
    },
  },
  {
    key: 'eventBusReconnects',
    name: 'app.event_bus.reconnects',
    kind: 'counter',
    unit: '{reconnect}',
    description: 'Listener reconnects the event bus scheduled after losing its session, by adapter.',
    attributes: { adapter: ADAPTER },
  },
] as const satisfies readonly AppMetricDef[];

/** What an adapter reports. Every method is fire and forget and never throws. */
export interface EventBusMetrics {
  published(channel: string, outcome: EventBusPublishOutcome): void;
  delivered(channel: string, origin: 'local' | 'remote'): void;
  reconnect(): void;
}

/** Reports nothing: the default for an adapter built without a sink (tests, scripts). */
export const NOOP_EVENT_BUS_METRICS: EventBusMetrics = {
  published: () => undefined,
  delivered: () => undefined,
  reconnect: () => undefined,
};

/**
 * The sink over `AppMetricsService.add` (passed as a function, so this file
 * imports no service). `add` never throws; the wrapper guards anyway, because
 * a metrics fault must never reach a publisher.
 */
export function eventBusMetricsVia(
  add: (key: string, value: number, attributes: Record<string, unknown>) => void,
  adapter: EventBusAdapterName,
): EventBusMetrics {
  const safely = (fn: () => void) => {
    try {
      fn();
    } catch {
      // Never reaches the bus.
    }
  };
  return {
    published: (channel, outcome) => safely(() => add('eventBusPublished', 1, { adapter, channel, outcome })),
    delivered: (channel, origin) => safely(() => add('eventBusDelivered', 1, { adapter, channel, origin })),
    reconnect: () => safely(() => add('eventBusReconnects', 1, { adapter })),
  };
}
