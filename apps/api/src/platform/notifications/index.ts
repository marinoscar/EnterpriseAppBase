// The reference app's notification composition (issue #738). The registries,
// the dispatcher, the channels and the module are
// `@marinoscar/platform-api/notifications`; this folder holds what the app
// decides: its manifest (which channels, templates and events, in which order),
// the host-port bindings and the `forRoot` call.
//
// Importing this barrel fills the registries (through the manifest) and then
// takes the import-time snapshots below, which the package no longer exports
// (a package module loads before any app registers anything). Declaration
// files must NOT import it: they import the types they need from the package,
// so they stay leaves.

import './notification.manifest';

import {
  eventBrowserTemplateRegistry,
  eventEmailTemplateRegistry,
  listNotificationChannels,
  listNotificationEvents,
  type BrowserNotificationTemplate,
  type NotificationChannel,
  type NotificationEventDef,
} from '@marinoscar/platform-api/notifications';

/** Every registered channel id, in registration order, frozen when the manifest has run. */
export const NOTIFICATION_CHANNELS: readonly [NotificationChannel, ...NotificationChannel[]] = Object.freeze(
  listNotificationChannels().map((channel) => channel.id),
) as unknown as readonly [NotificationChannel, ...NotificationChannel[]];

/** Every registered event, in registration order, frozen when the manifest has run. */
export const NOTIFICATION_EVENTS: readonly NotificationEventDef[] = Object.freeze(listNotificationEvents());

/** Event key -> email template name, frozen when the manifest has run. */
export const EVENT_EMAIL_TEMPLATES: Readonly<Partial<Record<string, string>>> = Object.freeze(
  Object.fromEntries(eventEmailTemplateRegistry.list().map((binding) => [binding.eventKey, binding.template])),
);

/** Event key -> browser and push renderer, frozen when the manifest has run. */
export const EVENT_BROWSER_TEMPLATES: Readonly<Partial<Record<string, BrowserNotificationTemplate>>> = Object.freeze(
  Object.fromEntries(eventBrowserTemplateRegistry.list().map((binding) => [binding.eventKey, binding.render])),
);
