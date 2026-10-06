// Public surface of the event bus (PP-1.11, issue #682). Consumers import from
// here; the adapters are implementation detail selected by `EVENT_BUS_ADAPTER`.
export {
  EVENT_BUS,
  EVENT_BUS_ADAPTERS,
  EVENT_BUS_CHANNEL_PATTERN,
  EVENT_BUS_MAX_PAYLOAD_BYTES,
  EventBusPayloadTooLargeError,
} from './event-bus.interface';
export type {
  EventBus,
  EventBusAdapterName,
  EventBusHandler,
  EventBusHealth,
  EventBusMeta,
} from './event-bus.interface';
export { exceedsEventBusPayloadLimit } from './event-bus-core';
export {
  DEFAULT_EVENT_BUS_ADAPTER,
  EVENT_BUS_SELECTION,
  parseEventBusAdapter,
} from './event-bus.config';
export type { EventBusSelection } from './event-bus.config';
export { EventBusModule } from './event-bus.module';
export { InProcessEventBus } from './in-process-event-bus';
export { EVENT_BUS_PG_CHANNEL, PostgresEventBus } from './postgres-event-bus';
