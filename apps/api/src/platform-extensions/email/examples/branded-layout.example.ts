import { html, type EmailLayoutOptions } from '@marinoscar/platform-api/email';

// =============================================================================
// EXAMPLE, NOT WIRED: a layout theme and an inline brand mark (PP-8.4, #737)
// =============================================================================
//
// Rung 1 of the extension ladder: `EmailModule.forRoot({ layout })`. The theme
// is merged over the platform defaults colour by colour (only `brand` and
// `onBrand` change here), dark mode is opted into with explicit values, the
// brand mark is a PNG shipped INSIDE each message as a Content-ID part (never
// a remote image: those are blocked by default and read as tracking), and the
// footer names the sender. With no `layout` option the output is the
// platform's, byte for byte.
//
// To use it, a fork passes it as `layout` in
// `apps/api/src/platform/email/email.options.ts`. Exercised by
// `test/email/email-extension-points.spec.ts`; the base keeps the platform
// layout.
// =============================================================================

/** A 1x1 PNG standing in for a real brand mark (generate yours from the web app's icon). */
const BRAND_MARK_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** A teal palette with dark mode, a brand mark and a postal footer. */
export const BRANDED_EMAIL_LAYOUT: EmailLayoutOptions = {
  theme: {
    colors: { brand: '#0f766e', onBrand: '#ffffff' },
    dark: { background: '#0b1220', card: '#111827', border: '#1f2937', text: '#e5e7eb', muted: '#9ca3af', accent: '#5eead4' },
  },
  brandMark: { pngBase64: BRAND_MARK_PNG, cid: 'brand-mark', displaySize: 40, alt: '' },
  footerHtml: html`Sent by Example Ltd, 1 Main Street.<br />
                You receive this because you have an account.`,
  footerText: ['Sent by Example Ltd, 1 Main Street.', 'You receive this because you have an account.'],
};
