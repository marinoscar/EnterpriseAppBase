// =============================================================================
// This application's own notifications (issue #678, PP-1.6)
// =============================================================================
//
// The app-owned seam of the notification registries. Upstream keeps all three
// arrays EMPTY FOREVER, so a fork's edits here never conflict on merge. A fork
// adds its channels, email templates and notifications here and never edits a
// platform declaration file or `notifications/registry/notification.manifest.ts`.
//
// The manifest registers, in order: platform channels, APP_NOTIFICATION_CHANNELS,
// platform email templates, APP_EMAIL_TEMPLATES, platform notifications,
// APP_NOTIFICATIONS. So an app notification may use an app channel and an app
// template, and app events list after the platform's on
// `GET /api/notifications/events`. An id that collides with a platform entry
// fails at import time with `DUPLICATE_ID`.
//
// Pure data only: no `register()` calls (the manifest registers), no Nest, no
// Prisma, no services. A channel's TRANSPORT is a Nest provider and lives in the
// app's own module; see notifications/README.md, "Adding a channel".
//
// Example (in a fork):
//
//   export const APP_NOTIFICATION_CHANNELS: readonly NotificationChannelDef[] = [
//     { id: 'android_app', label: 'Android app', description: 'A notification on the paired Android app.' },
//   ];
//
//   declare module '../notifications/registry/channel.registry' {
//     interface NotificationChannelIds { android_app: true }
//   }
//
//   declare module '@marinoscar/platform-api/email' {
//     interface EmailTemplateDataMap { 'coach-weekly-review': CoachWeeklyReviewEmailData }
//   }
//
//   export const APP_EMAIL_TEMPLATES: readonly EmailTemplateEntry[] = [
//     { name: 'coach-weekly-review', render: coachWeeklyReviewEmail as EmailTemplate<never> },
//   ];
//
//   (Or `registerEmailTemplate('coach-weekly-review', coachWeeklyReviewEmail)`,
//   typed by the augmentation; `{ override: true }` replaces a platform
//   template, e.g. a restyled `broadcast`. See apps/api/src/examples/email/.)
//
//   export const APP_NOTIFICATIONS: readonly NotificationRegistration[] = [
//     {
//       event: {
//         key: 'coach.weekly_review',
//         label: 'Weekly review',
//         description: 'Sent every Monday with a summary of your training week.',
//         channels: ['email', 'browser', 'android_app'],
//         defaultEnabled: true,
//       },
//       emailTemplate: 'coach-weekly-review',
//       browserTemplate: coachWeeklyReviewBrowserTemplate,
//     },
//   ];
// =============================================================================

import type { NotificationRegistration } from '@marinoscar/platform-api/notifications';
import type { NotificationChannelDef } from '@marinoscar/platform-api/notifications';
import type { EmailTemplateEntry } from '@marinoscar/platform-api/email';

import {
  WEBHOOK_NOTIFICATION_CHANNEL,
  WEBHOOK_TEST_NOTIFICATION,
  withWebhookChannel,
} from '../platform-extensions/notifications/webhook.notifications';

// =============================================================================
// The reference app registers ONE worked example (PP-14.10): the `webhook`
// channel, with a template for the platform's broadcast events (added to them
// by `adaptPlatformBroadcasts` below, which the manifest applies)
// and for one event of its own, `example.webhook_test`. It is registered so the
// example is the real thing, but INERT: the sender reaches nobody until a
// deployment endpoint is configured and a user has a handle. A fork that does
// not want it deletes the two entries below, `adaptPlatformBroadcasts`'s body
// and `platform-extensions/notifications/`. Recipe:
// docs/EXTENDING.md, "Add a notification channel".
// =============================================================================

/** This app's own delivery channels, registered after the platform's. */
export const APP_NOTIFICATION_CHANNELS: readonly NotificationChannelDef[] = [WEBHOOK_NOTIFICATION_CHANNEL];

/** This app's own email templates, registered after the platform's. */
export const APP_EMAIL_TEMPLATES: readonly EmailTemplateEntry[] = [];

/** This app's own notifications, registered after the platform's, in this order. */
export const APP_NOTIFICATIONS: readonly NotificationRegistration[] = [WEBHOOK_TEST_NOTIFICATION];

/**
 * How this app changes the platform's broadcast notifications before the
 * manifest registers them: the seam an app uses to put its own channel on a
 * platform event without editing the package (PP-14.10). The reference app adds
 * the `webhook` channel to both broadcast events and binds its template to
 * each; a fork with no extra channel returns the registrations unchanged.
 *
 * @param registrations - the package's `BROADCASTS_NOTIFICATIONS`.
 * @returns the registrations to register, in the same order.
 */
export function adaptPlatformBroadcasts(registrations: readonly NotificationRegistration[]): readonly NotificationRegistration[] {
  return withWebhookChannel(registrations);
}
