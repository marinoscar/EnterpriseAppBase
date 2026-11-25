import {
  SafeHtml,
  TRANSACTIONAL_EMAIL_HEADERS,
  escapeHtml,
  html,
  plainText,
  renderCallout,
  renderLayout,
  resolveEmailRenderContext,
  safeUrl,
  type EmailRenderContext,
  type EmailTemplate,
  type EmailTemplateEntry,
  type RenderedEmail,
} from '@marinoscar/platform-api/email';

// =============================================================================
// EXAMPLE, NOT WIRED: an app's own email template (PP-8.4, #737)
// =============================================================================
//
// Rung 2 of the extension ladder: an app adds a template to the email
// template registry and types its data by augmenting `EmailTemplateDataMap`,
// so `renderEmailTemplate('example-digest', data)` checks `data` against
// `ExampleDigestEmailData` at compile time. The template is a pure function of
// its data and the render context: the product name, the layout (theme,
// brand mark) and the helpers come from the context, every interpolation goes
// through the escaping `html` tag.
//
// To use it, a fork adds `EXAMPLE_DIGEST_EMAIL_TEMPLATE` to
// `APP_EMAIL_TEMPLATES` in `app-registrations/notifications.ts` (or calls
// `registerEmailTemplate('example-digest', exampleDigestEmail)` from a
// manifest), then binds a notification event to the name. The name is a
// STABLE ID once an event maps to it. Exercised by
// `test/email/email-extension-points.spec.ts`; the base registers no app
// template.
// =============================================================================

/** What the weekly digest renders. Every field is data gathered by the caller. */
export interface ExampleDigestEmailData {
  /** The recipient's display name, if known. User-typed: escaped. */
  recipientName?: string;
  /** The ISO week, e.g. `2026-W41`. */
  week: string;
  /** One line per item; user-typed, escaped. */
  items: string[];
  /** An absolute link to the digest page, if any. */
  digestUrl?: string;
}

declare module '@marinoscar/platform-api/email' {
  interface EmailTemplateDataMap {
    'example-digest': ExampleDigestEmailData;
  }
}

/** Renders the weekly digest. */
export function exampleDigestEmail(data: ExampleDigestEmailData, ctx?: EmailRenderContext): RenderedEmail {
  const context = resolveEmailRenderContext(ctx);
  const title = `Your ${context.appName} week (${data.week})`;
  const greeting = data.recipientName ? `Hello ${data.recipientName},` : 'Hello,';
  const items =
    data.items.length > 0
      ? html`<ul style="margin:0 0 16px 20px;padding:0;">${data.items.map((item) => html`<li>${item}</li>`)}</ul>`
      : renderCallout({ tone: 'info', bodyHtml: html`Nothing new this week.` }, context);

  // `safeUrl` admits only absolute http(s)/mailto links; anything else drops
  // the button (and the text-part link) rather than rendering a dead or
  // dangerous one.
  const digestUrl = data.digestUrl ? (safeUrl(data.digestUrl) ?? undefined) : undefined;
  // The escape hatch, used the only acceptable way: markup that is literal in
  // the source, with the one dynamic value escaped by hand. Prefer `html`.
  const weekBadge = SafeHtml.unsafeFromTrustedString(`<span style="font-weight:bold;">${escapeHtml(data.week)}</span>`);

  const bodyHtml = html`<p style="margin:0 0 16px 0;">${greeting}</p>
    <p style="margin:0 0 16px 0;">Here is what happened in ${weekBadge}.</p>
    ${items}`;

  return {
    subject: title,
    html: renderLayout(
      { title, previewText: `${data.items.length} updates this week`, bodyHtml, ctaLabel: digestUrl ? 'Open the digest' : undefined, ctaUrl: digestUrl },
      context,
    ),
    text: plainText(
      {
        title,
        lines: [greeting, '', 'Here is what happened this week.', '', ...(data.items.length > 0 ? data.items.map((item) => `- ${item}`) : ['Nothing new this week.'])],
        ctaLabel: digestUrl ? 'Open the digest' : undefined,
        ctaUrl: digestUrl,
      },
      context,
    ),
    headers: { ...TRANSACTIONAL_EMAIL_HEADERS },
  };
}

/** The registry entry a fork appends to `APP_EMAIL_TEMPLATES`. */
export const EXAMPLE_DIGEST_EMAIL_TEMPLATE: EmailTemplateEntry = {
  name: 'example-digest',
  render: exampleDigestEmail as EmailTemplate<never>,
  registrant: 'app',
};
