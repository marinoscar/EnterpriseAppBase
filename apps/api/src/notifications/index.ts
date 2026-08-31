// =============================================================================
// Notifications — public surface (issue #121, epic #109)
// =============================================================================
//
// #121 shipped the event registry and its helpers only. #124 adds the one
// endpoint that serves that registry to the web app -- readable by ANY
// authenticated user, because #126 renders every user's own preferences
// against it -- and the module that carries it. Still absent: the dispatcher,
// the transports' wiring and the delivery records (#125).
//
// Consumers import from `../notifications`, so the providers #125 adds can
// appear behind this barrel without every call site changing its import path.
// =============================================================================

export {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  findEvent,
  channelsFor,
  supportsChannel,
  isMandatory,
} from './notification-events';

export { NotificationsController } from './notifications.controller';
export { NotificationsModule } from './notifications.module';
export { notificationEventSchema } from './dto/notification-event.dto';

export type {
  NotificationChannel,
  NotificationEventDef,
} from './notification-events';
export type { NotificationEventResponse } from './dto/notification-event.dto';
