// =============================================================================
// EXAMPLE: the pure data of an app's own notification channel (PP-14.10)
// =============================================================================
//
// What `webhook.channel.ts` needs declared BEFORE Nest composes anything, and
// what `app-registrations/notifications.ts` registers:
//
//   - the channel (`webhook`): an id, a label and who may toggle it;
//   - its templates (`channelTemplates`), one per event bound for it: the
//     platform's broadcast pair (`admin.broadcast`, `admin.broadcast_critical`)
//     and one event of the app's own (`example.webhook_test`);
//   - `withWebhookChannel`, which is how an app puts its channel on a PLATFORM
//     event WITHOUT editing the package: it copies the platform's registration
//     with the channel added to the event and the template bound, and the
//     manifest registers the copy instead of the original.
//
// Pure data and pure functions: no Nest, no I/O, so the registrations file (read
// outside any container) can import it.
//
// The channel is registered on every boot but INERT until configured: the
// sender resolves no recipient until a deployment endpoint is set and a user has
// a handle (see `webhook.channel.ts`), so a fresh install delivers nothing over
// it. A fork that does not want it removes `WEBHOOK_NOTIFICATION_CHANNEL` and
// `withWebhookChannel` from `app-registrations/notifications.ts` and the
// manifest, and deletes this folder.
// =============================================================================

import type {
  ChannelTemplateRender,
  NotificationChannelDef,
  NotificationEventDef,
  NotificationRegistration,
} from '@marinoscar/platform-api/notifications';

/** The channel id. A channel id is persisted in preferences and delivery rows: never rename it. */
export const WEBHOOK_CHANNEL_ID = 'webhook';

/** The channel's registry entry. */
export const WEBHOOK_NOTIFICATION_CHANNEL: NotificationChannelDef = {
  id: WEBHOOK_CHANNEL_ID,
  label: 'Webhook',
  description: 'A JSON POST to the webhook endpoint this application is configured with, addressed to the user\'s handle.',
  userConfigurable: true,
};

/** The payload of the broadcast events (the same object their email template renders). */
interface BroadcastPayload {
  title: string;
  body: string;
  link?: string;
  critical?: boolean;
}

/** The webhook rendering of a broadcast: its title and body, the in-app link and whether it is important. */
export const broadcastWebhookTemplate: ChannelTemplateRender = (data: BroadcastPayload) => ({
  title: data.title,
  body: data.body,
  ...(data.link ? { link: data.link } : {}),
  fields: { important: data.critical === true ? 'yes' : 'no' },
});

/** The app's own event over the channel: an administrator's test message. */
export const WEBHOOK_TEST_EVENT: NotificationEventDef = {
  key: 'example.webhook_test',
  label: 'Webhook test message',
  description: 'A message sent to your webhook handle when an administrator checks that the webhook channel works.',
  channels: [WEBHOOK_CHANNEL_ID],
  defaultEnabled: true,
};

/** The payload of {@link WEBHOOK_TEST_EVENT}. */
export interface WebhookTestData {
  /** Who ran the test, for the message. */
  by: string;
}

/** The webhook rendering of the test event. */
export const webhookTestTemplate: ChannelTemplateRender = (data: WebhookTestData) => ({
  title: 'Webhook test',
  body: `${data.by} sent a test message to check this webhook.`,
});

/** The app's own notification: the test event and its webhook template. */
export const WEBHOOK_TEST_NOTIFICATION: NotificationRegistration = {
  event: WEBHOOK_TEST_EVENT,
  channelTemplates: { [WEBHOOK_CHANNEL_ID]: webhookTestTemplate },
};

/**
 * Puts the webhook channel on platform notifications: each registration is
 * copied with the channel added to its event and the broadcast template bound
 * to it. The originals are not touched (they are the package's own constants).
 *
 * @param registrations - platform registrations whose payload is a broadcast (`BROADCASTS_NOTIFICATIONS`).
 * @returns the copies, in the same order.
 */
export function withWebhookChannel(registrations: readonly NotificationRegistration[]): NotificationRegistration[] {
  return registrations.map((registration) => ({
    ...registration,
    event: { ...registration.event, channels: [...registration.event.channels, WEBHOOK_CHANNEL_ID] },
    channelTemplates: { ...registration.channelTemplates, [WEBHOOK_CHANNEL_ID]: broadcastWebhookTemplate },
  }));
}
