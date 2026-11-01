// Shared fixtures of the notifications slice's package tests (issue #738):
// the platform's channels and email templates, the slice's own notifications,
// and a stand-in for an app's event (the reference app's identity events live
// in the app, not here).
import { configureEmailRendering, registerPlatformEmailTemplates } from '../../src/email/index';
import { BROADCASTS_NOTIFICATIONS } from '../../src/notifications/broadcasts/broadcasts.notifications';
import { NODES_NOTIFICATIONS } from '../../src/notifications/ops/nodes.notifications';
import { OPS_NOTIFICATIONS } from '../../src/notifications/ops/ops.notifications';
import { registerNotifications } from '../../src/notifications/registry/bindings.registry';
import { notificationEventRegistry } from '../../src/notifications/registry/event.registry';
import { registerPlatformNotificationChannels } from '../../src/notifications/registry/platform-channels';
import type { NotificationEventDef } from '../../src/notifications/registry/event.registry';

/** A stand-in app event over email and browser. */
export const WELCOME_EVENT: NotificationEventDef = {
  key: 'user.welcome',
  label: 'Welcome',
  description: 'Sent on first sign-in.',
  channels: ['email', 'browser'],
  defaultEnabled: true,
};

/** A stand-in mandatory event over email and browser. */
export const ROLE_CHANGED_EVENT: NotificationEventDef = {
  key: 'security.role_changed',
  label: 'Role changed',
  description: 'Sent when your roles change.',
  channels: ['email', 'browser'],
  defaultEnabled: true,
  mandatory: true,
};

/** Registers what a minimal app's manifest would, once per test file. */
export function registerTestNotifications(): void {
  if (notificationEventRegistry.has(WELCOME_EVENT.key)) return;
  configureEmailRendering({ appName: 'Fixture App' });
  registerPlatformEmailTemplates();
  registerPlatformNotificationChannels();
  registerNotifications([
    { event: WELCOME_EVENT, emailTemplate: 'user-welcome' },
    { event: ROLE_CHANGED_EVENT, emailTemplate: 'role-changed' },
  ]);
  registerNotifications(BROADCASTS_NOTIFICATIONS);
  registerNotifications(OPS_NOTIFICATIONS);
  registerNotifications(NODES_NOTIFICATIONS);
}
