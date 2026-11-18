// =============================================================================
// The webhooks slice's notification declarations (issue #1046)
// =============================================================================
//
// Pure data, no side effect: the app registers them from its notification
// manifest (the reference app: `platform/webhooks/webhooks.notifications.ts`).
//
//   - the CHANNEL `webhook` ("Webhooks"): a user's notifications, delivered to
//     the user's own webhook endpoints. It appears as a column in the
//     preferences matrix of every event that declares it; `withWebhookChannel`
//     is how an app puts it on events without editing the package;
//   - the EVENT `webhooks.endpoint_disabled`: sent to an endpoint's owner when
//     the platform switches it off (too many failures, or the receiver said
//     410 Gone), by email and in the bell.
// =============================================================================

import { SafeHtml, TRANSACTIONAL_EMAIL_HEADERS, emailTemplateRegistry, html, plainText, renderLayout, resolveEmailRenderContext } from '../../email/index';
import type { EmailRenderContext, EmailTemplateEntry, RenderedEmail } from '../../email/index';
import type { NotificationChannelDef, NotificationRegistration } from '../../notifications/index';
import {
  WEBHOOK_ENDPOINT_DISABLED_EMAIL_TEMPLATE,
  WEBHOOK_ENDPOINT_DISABLED_EVENT_KEY,
  WEBHOOK_NOTIFICATION_CHANNEL_ID,
} from '../webhooks.constants';

/**
 * The `webhook` channel's registry entry. Its id is persisted in preferences
 * and delivery rows: never rename it.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const WEBHOOK_NOTIFICATION_CHANNEL: NotificationChannelDef = Object.freeze({
  id: WEBHOOK_NOTIFICATION_CHANNEL_ID,
  label: 'Webhooks',
  description: "Sends the notification to your own webhook endpoints as a signed JSON POST.",
  userConfigurable: true,
  criticalCapable: false,
  broadcastDefault: false,
  rendersRawData: true,
});

/**
 * The data of `webhooks.endpoint_disabled`.
 *
 * @stability experimental
 */
export interface WebhookEndpointDisabledData {
  /** The endpoint id. */
  endpointId: string;
  /** Its name. */
  endpointName: string;
  /** `user`, `org` or `system`. */
  scope: string;
  /** `circuit_open` (too many failures) or `gone` (the receiver answered 410). */
  reason: string;
  /** The receiver's host (never the path or query). */
  host: string;
}

/** The bell and push text of a webhook notification. @stability experimental */
export interface WebhookBrowserContent {
  /** The headline. */
  title: string;
  /** The sentence under it. */
  body: string;
  /** A root-relative link to the settings page. */
  link: string;
}

/**
 * The bell and push text of `webhooks.endpoint_disabled`.
 *
 * @param data - the event data.
 * @returns title, body and a root-relative link to the settings page.
 *
 * @stability experimental
 */
export function webhookEndpointDisabledBrowserTemplate(data: WebhookEndpointDisabledData): WebhookBrowserContent {
  const why = data.reason === 'gone' ? 'the receiver answered 410 Gone' : 'it failed too many times in a row';
  return {
    title: 'A webhook endpoint was disabled',
    body: `"${data.endpointName}" (${data.host}) was switched off because ${why}. Fix the receiver, then enable it again.`,
    link: data.scope === 'system' ? '/admin/settings/webhooks' : data.scope === 'org' ? '/admin/settings/org-webhooks' : '/settings/webhooks',
  };
}

/**
 * The email of `webhooks.endpoint_disabled`.
 *
 * @param data - the event data; the endpoint name is user-typed and escaped on the way in.
 * @param ctx - the render context.
 * @returns the rendered message.
 *
 * @stability experimental
 */
export function webhookEndpointDisabledEmail(data: WebhookEndpointDisabledData, ctx?: EmailRenderContext): RenderedEmail {
  const context = resolveEmailRenderContext(ctx);
  const why = data.reason === 'gone' ? 'the receiver answered 410 Gone' : 'it failed too many times in a row';
  const title = 'A webhook endpoint was disabled';
  const summary = `"${data.endpointName}" (${data.host}) was switched off because ${why}.`;
  const bodyHtml = html`
    <p style="margin:0 0 16px 0;"><strong>${data.endpointName}</strong> (${data.host}) was switched off because ${why}.</p>
    <p style="margin:0 0 16px 0;">Deliveries to it have stopped. Fix the receiver, then open the webhook settings and enable the endpoint again; its failure count starts over.</p>
    <p style="margin:0;font-size:13px;line-height:20px;color:#4b5563;">You are receiving this because you own this endpoint in ${context.appName}.</p>
  `;
  const htmlDocument = renderLayout({ title, previewText: summary, bodyHtml: bodyHtml as SafeHtml }, context);
  const text = plainText(
    {
      title,
      lines: [summary, '', 'Deliveries to it have stopped. Fix the receiver, then open the webhook settings and enable the endpoint again.', '', `You are receiving this because you own this endpoint in ${context.appName}.`],
    },
    context,
  );
  return { subject: `${context.appName}: ${title}`, html: htmlDocument, text, headers: { ...TRANSACTIONAL_EMAIL_HEADERS } };
}

/**
 * Registers the slice's one email template with the email slice's registry.
 * Idempotent. Call it from the notification manifest, after the email render
 * context is configured and before `registerNotifications(WEBHOOKS_NOTIFICATIONS)`.
 *
 * @throws RegistryError `DUPLICATE_ID` when the app registered the name with another renderer; `FROZEN` after bootstrap.
 *
 * @example
 * ```ts
 * registerWebhooksEmailTemplates();
 * registerNotifications(WEBHOOKS_NOTIFICATIONS);
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerWebhooksEmailTemplates(): void {
  if (emailTemplateRegistry.get(WEBHOOK_ENDPOINT_DISABLED_EMAIL_TEMPLATE)?.render === (webhookEndpointDisabledEmail as never)) return;
  const entry: EmailTemplateEntry = { name: WEBHOOK_ENDPOINT_DISABLED_EMAIL_TEMPLATE, render: webhookEndpointDisabledEmail as never, registrant: 'webhooks' };
  emailTemplateRegistry.register(entry);
}

/**
 * The `webhooks.endpoint_disabled` registration: event, email template name and
 * browser renderer.
 *
 * @stability experimental
 */
export const WEBHOOKS_NOTIFICATIONS: readonly NotificationRegistration[] = Object.freeze([
  {
    event: {
      key: WEBHOOK_ENDPOINT_DISABLED_EVENT_KEY,
      label: 'Webhook endpoint disabled',
      description: 'Sent to the owner of a webhook endpoint when it is switched off after repeated failures or a 410 Gone.',
      channels: ['email', 'browser'],
      defaultEnabled: true,
    },
    emailTemplate: WEBHOOK_ENDPOINT_DISABLED_EMAIL_TEMPLATE,
    browserTemplate: webhookEndpointDisabledBrowserTemplate as never,
  },
]);

/**
 * Puts the `webhook` channel on notification registrations, so a member can
 * forward the event to their endpoints from the preferences matrix. The
 * slice's own `webhooks.endpoint_disabled` is left alone (a webhook about a
 * broken webhook helps no one). The input is not modified.
 *
 * @param registrations - what the manifest would register.
 * @returns the same registrations with `webhook` appended to each event's channels.
 *
 * @example
 * ```ts
 * registerNotifications(withWebhookChannel(AUTH_NOTIFICATIONS));
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function withWebhookChannel(registrations: readonly NotificationRegistration[]): NotificationRegistration[] {
  return registrations.map((registration) => {
    const { event } = registration;
    // An event with no channels is invalid: leave it alone so the registry rejects it, rather than the channel masking it.
    if (event.key === WEBHOOK_ENDPOINT_DISABLED_EVENT_KEY || event.channels.length === 0 || event.channels.includes(WEBHOOK_NOTIFICATION_CHANNEL_ID)) return registration;
    return { ...registration, event: { ...event, channels: [...event.channels, WEBHOOK_NOTIFICATION_CHANNEL_ID] } };
  });
}
