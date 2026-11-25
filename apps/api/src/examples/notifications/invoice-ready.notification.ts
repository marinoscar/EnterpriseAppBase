// =============================================================================
// Reference example: an app's own notification event, with its email and
// browser templates (issue #738)
// =============================================================================
//
// What an app writes to add a notification, using only
// `@marinoscar/platform-api/notifications` and `/email`: the event, the email
// template (registered in the email slice's template registry, its data typed
// by augmenting `EmailTemplateDataMap`) and the bell-row / push renderer. The
// reference app does NOT register it in production (that would add a row to
// the preferences matrix and an event to `GET /api/notifications/events`);
// `registerExampleInvoiceNotification()` is what an app's manifest would call,
// and the example spec calls it before booting the app.
//
// Raise it after the write that produced the invoice commits:
//
//   await this.notifications.notify(EXAMPLE_INVOICE_READY_EVENT.key, userId, data);
// =============================================================================

import {
  TRANSACTIONAL_EMAIL_HEADERS,
  html,
  plainText,
  registerEmailTemplates,
  renderLayout,
  resolveEmailRenderContext,
  type EmailRenderContext,
  type RenderedEmail,
} from '@marinoscar/platform-api/email';
import {
  registerNotification,
  type BrowserNotificationTemplate,
  type NotificationEventDef,
} from '@marinoscar/platform-api/notifications';

/** What the invoice notification renders. */
export interface ExampleInvoiceReadyData {
  /** The invoice number, e.g. `INV-2026-0042`. */
  invoiceNumber: string;
  /** The amount, already formatted for display. */
  amount: string;
}

declare module '@marinoscar/platform-api/email' {
  interface EmailTemplateDataMap {
    'example-invoice-ready': ExampleInvoiceReadyData;
  }
}

/** The event: email and the in-app inbox, on by default, mutable by the user. */
export const EXAMPLE_INVOICE_READY_EVENT: NotificationEventDef = {
  key: 'example.invoice_ready',
  label: 'Invoice ready',
  description: 'Sent when a new invoice is available to download.',
  channels: ['email', 'browser'],
  defaultEnabled: true,
};

/** The email template: escaped interpolation, the layout, a hand-written text part. */
export function exampleInvoiceReadyEmail(data: ExampleInvoiceReadyData, ctx?: EmailRenderContext): RenderedEmail {
  const context = resolveEmailRenderContext(ctx);
  const title = `Invoice ${data.invoiceNumber} is ready`;
  const bodyHtml = html`<p style="margin:0 0 16px 0;">Your invoice ${data.invoiceNumber} for ${data.amount} is ready to download.</p>`;
  return {
    subject: title,
    html: renderLayout({ title, previewText: `${data.amount} due`, bodyHtml }, context),
    text: plainText({ title, lines: [`Your invoice ${data.invoiceNumber} for ${data.amount} is ready to download.`] }, context),
    headers: { ...TRANSACTIONAL_EMAIL_HEADERS },
  };
}

/** The bell row and the OS toast (also used by Web Push). `link` is root-relative. */
export const exampleInvoiceReadyBrowserTemplate: BrowserNotificationTemplate = (data) => {
  const invoice = data as unknown as ExampleInvoiceReadyData;
  return { title: 'Invoice ready', body: `Invoice ${invoice.invoiceNumber} (${invoice.amount}) is ready.`, link: '/billing' };
};

/** What the app's manifest would call: the template first, then the event with both renderers. */
export function registerExampleInvoiceNotification(): void {
  registerEmailTemplates([{ name: 'example-invoice-ready', render: exampleInvoiceReadyEmail as never }]);
  registerNotification({
    event: EXAMPLE_INVOICE_READY_EVENT,
    emailTemplate: 'example-invoice-ready',
    browserTemplate: exampleInvoiceReadyBrowserTemplate,
  });
}
