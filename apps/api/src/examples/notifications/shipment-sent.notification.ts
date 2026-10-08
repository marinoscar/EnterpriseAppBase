// =============================================================================
// Reference example: the step-by-step registration (issue #738)
// =============================================================================
//
// `registerNotification` (invoice-ready.notification.ts) is the one call an
// app normally makes. The three calls below are what it does, for an app that
// declares its event in one module and binds the renderers in another (or
// binds an existing platform template to a new event): the event first, then
// each binding, every one validated against the registries at call time.
// Not registered in production; the example spec calls it.
// =============================================================================

import {
  registerBrowserNotificationTemplate,
  registerEmailNotificationTemplate,
  registerNotificationEvent,
  type BrowserNotificationTemplate,
  type NotificationEventDef,
} from '@marinoscar/platform-api/notifications';

import { exampleInvoiceReadyEmail } from './invoice-ready.notification';

/** The event: the inbox, Web Push and email. */
export const EXAMPLE_SHIPMENT_SENT_EVENT: NotificationEventDef = {
  key: 'example.shipment_sent',
  label: 'Shipment sent',
  description: 'Sent when an order leaves the warehouse.',
  channels: ['browser', 'push', 'email'],
  defaultEnabled: true,
};

/** The bell row, the OS toast and the push notification. */
export const exampleShipmentSentBrowserTemplate: BrowserNotificationTemplate = (data) => {
  const { orderId } = data as { orderId: string };
  return { title: 'Shipment sent', body: `Order ${orderId} is on its way.`, link: `/orders/${encodeURIComponent(orderId)}` };
};

/**
 * Registers the event, then its two bindings. The email binding reuses the
 * invoice example's template name (`example-invoice-ready`, registered by
 * `registerExampleInvoiceNotification`), as an app binding a template it
 * already has would.
 */
export function registerExampleShipmentNotification(): void {
  // The renderer is referenced so a reader sees the shape it takes; the email
  // binding names a template by its registered name, never a function.
  void exampleInvoiceReadyEmail;
  registerNotificationEvent(EXAMPLE_SHIPMENT_SENT_EVENT);
  registerBrowserNotificationTemplate(EXAMPLE_SHIPMENT_SENT_EVENT.key, exampleShipmentSentBrowserTemplate);
  registerEmailNotificationTemplate(EXAMPLE_SHIPMENT_SENT_EVENT.key, 'example-invoice-ready');
}
