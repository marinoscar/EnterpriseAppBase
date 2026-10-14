import {
  html,
  renderCallout,
  resolveEmailRenderContext,
  testEmail,
  type EmailRenderContext,
  type RenderedEmail,
  type TestEmailData,
} from '@marinoscar/platform-api/email';

// =============================================================================
// EXAMPLE, NOT WIRED: an override of a platform template (PP-8.4, #737)
// =============================================================================
//
// Rung 2, explicitly: `registerEmailTemplate('test-email', ..., { override:
// true })` replaces what an existing name renders, without editing the
// package. Without `override: true` the same call throws `DUPLICATE_ID`
// naming the template. `EmailModule` logs each override once at bootstrap
// (name and registrant), so a restyled platform message is visible in the boot
// log. This one keeps the platform's message and appends a support line;
// wrapping the platform template, rather than copying it, keeps every
// platform fix.
//
// Only ever registered in a test (`test/email/email-extension-points.spec.ts`),
// never in the production wiring.
// =============================================================================

/** The platform test email, with the operator's support address appended to the subject's message. */
export function supportTestEmail(data: TestEmailData, ctx?: EmailRenderContext): RenderedEmail {
  const context = resolveEmailRenderContext(ctx);
  const base = testEmail(data, context);
  const note = renderCallout({ tone: 'info', bodyHtml: html`Problems? Write to support@example.test.` }, context).toString();
  return {
    ...base,
    html: base.html.replace('</body>', `${note}</body>`),
    text: `${base.text}\r\n\r\nProblems? Write to support@example.test.`,
  };
}
