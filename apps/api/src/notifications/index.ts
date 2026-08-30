// =============================================================================
// Notifications — public surface (issue #121, epic #109)
// =============================================================================
//
// #121 ships the event registry and its helpers only: no dispatcher, no
// transports, no delivery records, no module. Consumers import from
// `../notifications`, so the providers #122/#125 add can appear behind this
// barrel without every call site changing its import path.
// =============================================================================

export {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  findEvent,
  channelsFor,
  supportsChannel,
  isMandatory,
} from './notification-events';

export type {
  NotificationChannel,
  NotificationEventDef,
} from './notification-events';
