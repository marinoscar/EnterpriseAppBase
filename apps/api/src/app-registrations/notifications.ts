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

import type { NotificationRegistration } from '../notifications/registry/bindings.registry';
import type { NotificationChannelDef } from '../notifications/registry/channel.registry';
import type { EmailTemplateEntry } from '@marinoscar/platform-api/email';

/** This app's own delivery channels, registered after the platform's. */
export const APP_NOTIFICATION_CHANNELS: readonly NotificationChannelDef[] = [];

/** This app's own email templates, registered after the platform's. */
export const APP_EMAIL_TEMPLATES: readonly EmailTemplateEntry[] = [];

/** This app's own notifications, registered after the platform's, in this order. */
export const APP_NOTIFICATIONS: readonly NotificationRegistration[] = [];
