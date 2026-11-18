import { SafeHtml, TRANSACTIONAL_EMAIL_HEADERS, formatEmailDateTime, html, plainText, renderLayout, resolveEmailRenderContext } from '../../email/index';
import type { EmailRenderContext, EmailTemplateEntry, RenderedEmail } from '../../email/index';
import { emailTemplateRegistry } from '../../email/index';
import type { BrowserNotificationContent, BrowserNotificationTemplate, BrowserRenderContext, NotificationRegistration } from '../../notifications/index';
import { ALERT_FIRED_NOTIFICATION, ALERT_RESOLVED_NOTIFICATION } from '../alerts.constants';

/** Where the CTA points, appended to the application root. Matches the admin card. */
const ALERTS_ADMIN_PATH = '/admin/settings/alerts';

/**
 * Everything the alert emails and browser notifications render.
 *
 * @stability experimental
 */
export interface AlertNotificationData {
  /** The incident id. */
  incidentId: string;
  /** The rule id. */
  ruleId: string;
  /** The rule's display name. Escaped on the way into the html. */
  ruleName: string;
  /** `info`, `warning` or `critical`. */
  severity: string;
  /** `fired` or `resolved`. */
  state: 'fired' | 'resolved';
  /** One sentence on what is wrong. */
  summary: string;
  /** The label set (`node.name`, ...). */
  labels: Record<string, string>;
  /** The last observed value, or `null`. */
  value: number | null;
  /** When it fired. */
  firedAt: Date | null;
  /** When it resolved. */
  resolvedAt: Date | null;
  /** Absolute URL of the application root, for the CTA. Optional. */
  appUrl?: string;
}

function detailRow(label: string, value: string): SafeHtml {
  return html`<tr>
    <td style="padding:6px 16px 6px 0;font-size:14px;line-height:20px;color:#4b5563;white-space:nowrap;vertical-align:top;">${label}</td>
    <td style="padding:6px 0;font-size:14px;line-height:20px;color:#1f2937;vertical-align:top;"><strong>${value}</strong></td>
  </tr>`;
}

function headline(data: AlertNotificationData): string {
  return data.state === 'fired'
    ? `Alert (${data.severity}): ${data.ruleName}`
    : `Resolved: ${data.ruleName}`;
}

/**
 * Renders the alert email, fired or resolved (`data.state`).
 *
 * @param data - the alert.
 * @param ctx - the render context.
 * @returns the rendered message.
 *
 * @stability experimental
 */
export function alertEmail(data: AlertNotificationData, ctx?: EmailRenderContext): RenderedEmail {
  const context = resolveEmailRenderContext(ctx);
  const appName = context.appName;
  const title = headline(data);
  const labels = Object.entries(data.labels);
  const ctaUrl = data.appUrl ? `${data.appUrl}${ALERTS_ADMIN_PATH}` : undefined;
  const when = data.state === 'fired' ? data.firedAt : data.resolvedAt;
  const whenText = when ? formatEmailDateTime(when, context) : 'Unknown time';

  const rows: SafeHtml[] = [
    detailRow('Rule', data.ruleName),
    detailRow('Severity', data.severity),
    detailRow(data.state === 'fired' ? 'Fired at' : 'Resolved at', whenText),
    ...labels.map(([k, v]) => detailRow(k, v)),
  ];

  const bodyHtml = html`
    <p style="margin:0 0 16px 0;">${data.summary}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">${rows}</table>
    <p style="margin:0;font-size:13px;line-height:20px;color:#4b5563;">You are receiving this because you can view alerts in ${appName}.</p>
  `;

  const htmlDocument = renderLayout(
    { title, previewText: data.summary, bodyHtml, ctaLabel: ctaUrl ? 'Open alerts' : undefined, ctaUrl },
    context,
  );
  const text = plainText(
    {
      title,
      lines: [
        data.summary,
        '',
        `  Rule:      ${data.ruleName}`,
        `  Severity:  ${data.severity}`,
        `  ${data.state === 'fired' ? 'Fired at:' : 'Resolved at:'} ${whenText}`,
        ...labels.map(([k, v]) => `  ${k}: ${v}`),
        '',
        `You are receiving this because you can view alerts in ${appName}.`,
      ],
      ctaLabel: ctaUrl ? 'Open alerts' : undefined,
      ctaUrl,
    },
    context,
  );

  return {
    subject: `${appName}: ${title}`,
    html: htmlDocument,
    text,
    headers: { ...TRANSACTIONAL_EMAIL_HEADERS },
  };
}

/**
 * The bell, toast and push rendering of both alert events.
 *
 * @stability experimental
 */
export const alertBrowserTemplate: BrowserNotificationTemplate = (data: never, _ctx?: BrowserRenderContext): BrowserNotificationContent => {
  const alert = data as AlertNotificationData;
  return {
    title: headline(alert),
    body: alert.summary,
    link: ALERTS_ADMIN_PATH,
  };
};

/**
 * The email template names the alert events bind. PERMANENT once deliveries name them.
 *
 * @stability experimental
 */
export const ALERT_EMAIL_TEMPLATES = {
  /** The template of `alerts.alert_fired`. */
  FIRED: 'alert-fired',
  /** The template of `alerts.alert_resolved`. */
  RESOLVED: 'alert-resolved',
} as const;

/**
 * The two alert notification events. Register with
 * `registerNotifications(ALERTS_NOTIFICATIONS)` after
 * {@link registerAlertsEmailTemplates}.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const ALERTS_NOTIFICATIONS: readonly NotificationRegistration[] = [
  {
    event: {
      key: ALERT_FIRED_NOTIFICATION,
      label: 'Alert fired',
      description: 'Sent to administrators who can view alerts when an alert rule starts firing.',
      channels: ['email', 'browser', 'push'],
      defaultEnabled: true,
    },
    emailTemplate: ALERT_EMAIL_TEMPLATES.FIRED,
    browserTemplate: alertBrowserTemplate,
  },
  {
    event: {
      key: ALERT_RESOLVED_NOTIFICATION,
      label: 'Alert resolved',
      description: 'Sent to administrators who can view alerts when a firing alert clears.',
      channels: ['email', 'browser'],
      defaultEnabled: true,
    },
    emailTemplate: ALERT_EMAIL_TEMPLATES.RESOLVED,
    browserTemplate: alertBrowserTemplate,
  },
];

/**
 * Registers the two alert email templates. IDEMPOTENT: a name already
 * registered with this renderer is skipped.
 *
 * @throws RegistryError `DUPLICATE_ID` when an app registered the name with another renderer; `FROZEN` after bootstrap.
 *
 * @stability experimental
 */
export function registerAlertsEmailTemplates(): void {
  const entries: EmailTemplateEntry[] = [ALERT_EMAIL_TEMPLATES.FIRED, ALERT_EMAIL_TEMPLATES.RESOLVED]
    .filter((name) => emailTemplateRegistry.get(name)?.render !== (alertEmail as never))
    .map((name) => ({ name, render: alertEmail as never, registrant: 'alerts' }));
  if (entries.length > 0) emailTemplateRegistry.registerAll(entries);
}
