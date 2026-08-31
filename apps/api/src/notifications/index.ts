// =============================================================================
// Notifications — public surface (issues #121/#124/#125, epic #109)
// =============================================================================
//
// #121 shipped the event registry and its helpers. #124 added the endpoint
// that serves that registry to the web app. #125 adds the dispatcher, the
// channel abstraction, the preference resolver and the delivery records.
//
// FOR A FEATURE THAT WANTS TO SEND A NOTIFICATION, THE WHOLE API IS:
//
//     imports: [NotificationsModule]          // in your module
//     constructor(private readonly notifications: NotificationsService) {}
//     await this.notifications.notify('security.role_changed', userId, data);
//
// That call cannot throw, cannot join your transaction, and returns before
// anything is sent. Nothing else here is needed at a call site.
//
// WHAT IS DELIBERATELY NOT EXPORTED: `NotificationDeliveryService` and
// `EmailNotificationChannel`. The preference gate and the `mandatory` override
// live in `NotificationsService.dispatch`; a caller able to invoke a channel
// directly, or to write a delivery record for a send that never happened,
// would be a route around the one gate this epic has. The module does not
// export them either — this barrel and the module agree on purpose.
//
// Still absent: the browser channel (#127) and the real event templates and
// triggers (#128).
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
export { NotificationsService } from './notifications.service';
export { notificationEventSchema } from './dto/notification-event.dto';

// Preference resolution (#125). Pure functions, exported because #126's
// preferences page needs to render the SAME answer the dispatcher will act on
// — a page that computed "enabled" its own way would show a user a state the
// dispatcher disagrees with, and `mandatory` is one of the things it would get
// to disagree about.
export {
  NOTIFICATION_PREFERENCES_NAMESPACE,
  isChannelEnabled,
  readNotificationPreferences,
  resolveChannels,
} from './notification-preferences';

// The DI token, exported so a channel added later (#127) can be registered
// from its own module if it ever needs to live in one.
export { NOTIFICATION_CHANNEL_SENDERS } from './notification.types';

export type {
  NotificationChannel,
  NotificationEventDef,
} from './notification-events';
export type { NotificationEventResponse } from './dto/notification-event.dto';
export type {
  ChannelPreferences,
  NotificationPreferences,
} from './notification-preferences';
export type {
  ChannelDeliveryResult,
  NotificationChannelSender,
  NotificationDispatchContext,
  NotificationRecipient,
} from './notification.types';
