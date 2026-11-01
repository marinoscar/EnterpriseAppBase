// =============================================================================
// Webhook metrics (issue #1046)
// =============================================================================
//
// Declared for the app's metric-name registry and emitted through
// `MetricsHostService`. BOUNDED LABELS ONLY: `outcome` is a closed list and
// `event_group` is the first segment of the event key when it is a registered
// group, else `other`. Never an endpoint, URL, user or organization.
// =============================================================================

import type { AppMetricDef } from '../otel-core/index';

/** What a delivery attempt ended as. @stability experimental */
export const WEBHOOK_DELIVERY_OUTCOMES = ['succeeded', 'failed', 'dead', 'blocked'] as const;
/** What one emitted event ended as. @stability experimental */
export const WEBHOOK_EMIT_OUTCOMES = ['queued', 'no_match', 'invalid', 'unknown'] as const;

/** Code key of `app.webhooks.deliveries`. @stability experimental */
export const WEBHOOK_DELIVERIES_METRIC = 'webhookDeliveries';
/** Code key of `app.webhooks.delivery.duration`. @stability experimental */
export const WEBHOOK_DELIVERY_DURATION_METRIC = 'webhookDeliveryDuration';
/** Code key of `app.webhooks.events`. @stability experimental */
export const WEBHOOK_EVENTS_METRIC = 'webhookEvents';

/**
 * The slice's metrics, for `registerPlatformHostAppMetrics`.
 *
 * @example
 * ```ts
 * registerPlatformHostAppMetrics(WEBHOOKS_APP_METRICS);
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const WEBHOOKS_APP_METRICS: readonly AppMetricDef[] = [
  {
    key: WEBHOOK_DELIVERIES_METRIC,
    name: 'app.webhooks.deliveries',
    kind: 'counter',
    unit: '{delivery}',
    description: 'Webhook delivery attempts, by outcome and event group.',
    attributes: {
      outcome: { kind: 'enum', values: WEBHOOK_DELIVERY_OUTCOMES },
      event_group: { kind: 'free' },
    },
  },
  {
    key: WEBHOOK_DELIVERY_DURATION_METRIC,
    name: 'app.webhooks.delivery.duration',
    kind: 'histogram',
    unit: 's',
    description: 'How long one webhook delivery attempt took, from connecting to the answer.',
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    attributes: {
      outcome: { kind: 'enum', values: WEBHOOK_DELIVERY_OUTCOMES },
      event_group: { kind: 'free' },
    },
  },
  {
    key: WEBHOOK_EVENTS_METRIC,
    name: 'app.webhooks.events',
    kind: 'counter',
    unit: '{event}',
    description: 'Events emitted to the webhook fan-out, by outcome and event group.',
    attributes: {
      outcome: { kind: 'enum', values: WEBHOOK_EMIT_OUTCOMES },
      event_group: { kind: 'free' },
    },
  },
];
