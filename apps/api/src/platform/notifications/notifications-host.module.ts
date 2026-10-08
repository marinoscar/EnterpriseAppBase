import { Global, Module } from '@nestjs/common';
import {
  NOTIFICATIONS_EVENT_BUS,
  NOTIFICATIONS_METRICS,
  type NotificationsEventBus,
} from '@marinoscar/platform-api/notifications';

import { exceedsEventBusPayloadLimit } from '../../common/event-bus/event-bus-core';
import { EVENT_BUS, type EventBus } from '../../common/event-bus/event-bus.interface';
import { AppMetricsService } from '../../common/otel/app-metrics.service';

// =============================================================================
// The notifications slice's host ports, bound to this app (issue #738)
// =============================================================================
//
// - NOTIFICATIONS_METRICS: the app's `AppMetricsService`
//   (`app.notifications.deliveries`, unchanged labels).
// - NOTIFICATIONS_EVENT_BUS: the cross-replica `EVENT_BUS` (#682), with the
//   bus's own oversize check, so the stream publishes a reference instead of a
//   notification too large for the Postgres adapter's NOTIFY.
// =============================================================================

/** The stream's view of the app's event bus. */
export function notificationsEventBusOf(bus: EventBus): NotificationsEventBus {
  return {
    publish: (channel, payload) => bus.publish(channel, payload),
    subscribe: (channel, handler) => bus.subscribe(channel, handler),
    exceedsPayloadLimit: exceedsEventBusPayloadLimit,
  };
}

const BINDINGS = [
  { provide: NOTIFICATIONS_METRICS, useExisting: AppMetricsService },
  { provide: NOTIFICATIONS_EVENT_BUS, useFactory: notificationsEventBusOf, inject: [EVENT_BUS] },
];

@Global()
@Module({
  providers: BINDINGS,
  exports: BINDINGS.map((binding) => binding.provide),
})
export class NotificationsHostModule {}
