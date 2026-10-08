import type { EmailTone } from './layout-theme';
import { resolveEmailRenderContext, type EmailRenderContext } from './render-context';
import { SafeHtml, html, safeUrl } from './safe-html';

// =============================================================================
// Email layout — the HTML shell every message shares (issue #123, epic #109)
// =============================================================================
//
// EMAIL HTML IS NOT WEB HTML. Every constraint below is here because a real
// client breaks without it, and getting this wrong once means every template
// #128 adds inherits the breakage.
//
//   * **Inline styles and nested tables, no flexbox, no grid, no classes.**
//     Outlook on Windows renders mail with the WORD layout engine, not with a
//     browser engine. It ignores `display:flex`, `display:grid`, most
//     positioning, and — critically — it strips `<style>` blocks in many
//     configurations, so anything not inlined is simply absent. Tables are the
//     only layout primitive with 25 years of consistent behaviour across
//     Gmail, Outlook and Apple Mail.
//
//   * **No external assets whatsoever** — no `<link>`, no remote images, no
//     web fonts. Gmail, Outlook and Apple Mail all block remote content by
//     default until the recipient clicks "display images", so a layout that
//     depends on a logo renders broken for the MAJORITY of recipients on first
//     open. The wordmark below is therefore text, and the "button" is a
//     coloured table cell rather than an image. A blocked asset is also a
//     tracking-pixel signal to spam filters, which is a second reason not to
//     have one.
//
//   * **A hidden preheader.** Inbox lists show a snippet beside the subject.
//     With no preheader the client scrapes the first visible text in the body,
//     which is the greeting — so every message in the list previews as "Hello,
//     Oscar" and the recipient learns nothing about which one to open.
//
//   * **A palette that survives forced dark mode.** Outlook.com, the Gmail
//     Android app and others do not ask the message what it wants: they
//     INVERT its colours. The rule that follows is that CONTRAST survives
//     inversion but HUE does not — a dark colour becomes light and vice versa,
//     so a near-black-on-near-white pair stays legible, while any mid-luminance
//     colour inverts to another mid-luminance colour and can land close to its
//     background. So: extremes for anything carrying text, and no mid-greys.
//     The `color-scheme`/`supported-color-schemes` metas additionally opt Apple
//     Mail and iOS out of forced inversion, but they are advisory and several
//     clients ignore them, so the palette has to work either way on its own.
//
// The plain-text renderer lives at the bottom of this same file, deliberately.
// #123 requires BOTH parts for every message, and a template author who opens
// this file to find `renderLayout` cannot miss `plainText` sitting directly
// beneath it. Splitting them across files is how one of them quietly stops
// being produced.
// =============================================================================

// The product name and the palette are not constants here any more (issue
// #737): they come from the render context (`./render-context.ts`) and its
// resolved layout theme (`./layout-theme.ts`), whose defaults are the values
// this file used to hard-code. With the defaults, the output is unchanged
// byte for byte.

/**
 * Padding that pushes the client's scraped snippet off the end of the
 * preheader.
 *
 * Clients fill the inbox snippet to a fixed length: they take the preheader
 * and then KEEP GOING into the visible body, so a short preheader previews as
 * "Your roles changed [app name] Hello, Oscar..." — the wordmark and the
 * greeting are the layout's chrome bleeding in behind it. These are zero-width
 * non-joiners interleaved with word joiners — invisible in every client, but consumed by
 * the snippet's character budget, so the scrape runs out before it reaches the
 * body. The interleaving matters: a run of identical characters gets collapsed
 * by some clients, and the pair does not.
 */
const PREHEADER_PADDING = '&#847;&zwnj;&nbsp;&#8199;&#65279;&#847;'.repeat(30);

/**
 * Options of {@link renderLayout}.
 *
 * @stability experimental
 */
export interface RenderLayoutOptions {
  /** Heading shown at the top of the body card, and the document `<title>`. */
  title: string;

  /**
   * Hidden inbox-preview text. Optional in the signature, but every real
   * template should pass one — see the preheader note in the header block.
   */
  previewText?: string;

  /**
   * The message body.
   *
   * TYPED `SafeHtml`, NOT `string`, AND THAT IS THE POINT. A body assembled by
   * string concatenation — the shape in which an unescaped display name
   * arrives — does not typecheck here. The only ways to produce a `SafeHtml`
   * are the `html` tag, which escapes every interpolation, and the explicitly
   * named `SafeHtml.unsafeFromTrustedString`. The compiler enforces the
   * escaping rule so that no reviewer has to (see safe-html.ts).
   */
  bodyHtml: SafeHtml;

  /** Call-to-action button label. Rendered only together with `ctaUrl`. */
  ctaLabel?: string;

  /**
   * Call-to-action button URL. Must be an absolute `http(s)`/`mailto` URL;
   * anything else is rejected by `safeUrl` and the button is omitted rather
   * than rendered pointing somewhere useless.
   */
  ctaUrl?: string;
}

/**
 * Render the complete HTML document for one email.
 *
 * Returns a plain `string` because this is the terminal step: the result goes
 * straight into `EmailMessage.html` and is never interpolated into anything
 * else, so there is nothing left for the `SafeHtml` type to protect.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function renderLayout(opts: RenderLayoutOptions, ctx?: EmailRenderContext): string {
  const { title, previewText, bodyHtml, ctaLabel, ctaUrl } = opts;
  const context = resolveEmailRenderContext(ctx);
  const { theme, brandMark, footerHtml } = context.layout;
  const { colors, fontStack: FONT_STACK, dark } = theme;
  const BG_COLOR = colors.background;
  const CARD_COLOR = colors.card;
  const TEXT_COLOR = colors.text;
  const MUTED_COLOR = colors.muted;
  const BORDER_COLOR = colors.border;
  const BRAND_COLOR = colors.brand;
  const ON_BRAND_COLOR = colors.onBrand;
  const appName = context.appName;

  // Dark mode (issue #737) is progressive and OPT-IN: without `theme.dark`
  // there is no `<style>` block and no class attribute, so the document is the
  // one this layout has always produced. With it, a `prefers-color-scheme`
  // block restates the colours on class hooks; a client that strips `<style>`
  // keeps the inline light palette.
  const hook = (name: string): SafeHtml =>
    dark ? SafeHtml.unsafeFromTrustedString(` class="${name}"`) : SafeHtml.EMPTY;
  const darkStyle = dark
    ? SafeHtml.unsafeFromTrustedString(
        '\n    <style>@media (prefers-color-scheme: dark){' +
          `.em-bg{background:${dark.background}!important;background-color:${dark.background}!important;}` +
          `.em-card{background:${dark.card}!important;background-color:${dark.card}!important;border-color:${dark.border}!important;}` +
          `.em-text{color:${dark.text}!important;}` +
          `.em-muted{color:${dark.muted}!important;}` +
          `.em-brand{color:${dark.accent}!important;}` +
          '}</style>',
      )
    : SafeHtml.EMPTY;

  // The brand mark (issue #737): an INLINE part referenced by `cid:`, never a
  // remote image (see the header). The part itself is added to the rendered
  // message by the template registry, which reads `layout.attachments`.
  const brandMarkHtml = brandMark
    ? html`<img src="cid:${brandMark.cid}" width="${String(brandMark.displaySize)}" height="${String(brandMark.displaySize)}" alt="${brandMark.alt ?? ''}" style="display:block;margin:0 auto 8px auto;border:0;outline:none;width:${String(brandMark.displaySize)}px;height:${String(brandMark.displaySize)}px;" />`
    : SafeHtml.EMPTY;

  // The preheader is hidden by six overlapping declarations, not one. Clients
  // disagree about which of them they honour — Gmail respects `display:none`,
  // some Outlook builds do not and need the zero height/width, and a few
  // strip `visibility` — so the belt-and-braces stack is what keeps this text
  // out of the rendered body while leaving it visible to the snippet scraper.
  const preheader = previewText
    ? html`<div
        style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;max-height:0;width:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;"
      >
        ${previewText}${SafeHtml.unsafeFromTrustedString(PREHEADER_PADDING)}
      </div>`
    : SafeHtml.EMPTY;

  // Reject the CTA URL rather than emit an unusable href — see `safeUrl`.
  const checkedCtaUrl = ctaUrl ? safeUrl(ctaUrl) : null;

  // The button is a table cell with a background colour and padding, NOT a
  // styled `<a>`. The Word engine ignores padding and `display:inline-block`
  // on an anchor, which collapses a CSS button down to bare underlined text;
  // it does honour `bgcolor` and cell padding on a `<td>`. `border-radius` is
  // ignored by Outlook and degrades to square corners, which is acceptable.
  const ctaBlock =
    ctaLabel && checkedCtaUrl
      ? html`<tr>
          <td align="center" style="padding:8px 0 4px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="${BRAND_COLOR}" style="border-radius:6px;">
                  <a
                    href="${checkedCtaUrl}"
                    style="display:inline-block;padding:12px 28px;font-family:${FONT_STACK};font-size:15px;line-height:20px;font-weight:bold;color:${ON_BRAND_COLOR};text-decoration:none;border-radius:6px;"
                    >${ctaLabel}</a
                  >
                </td>
              </tr>
            </table>
          </td>
        </tr>`
      : SafeHtml.EMPTY;

  // `bgcolor` attributes accompany every `background` style below: the Word
  // engine drops the CSS background on table elements often enough that the
  // deprecated presentational attribute is the reliable one.
  //
  // `x-apple-disable-message-reformatting` stops iOS Mail auto-scaling the
  // message, which otherwise resizes text and breaks the fixed 560px column.
  //
  // The `<!--[if mso]>` ghost table exists because Outlook ignores `max-width`
  // entirely: without it the 560px column stretches to the full window width
  // and the layout reads as an unformatted band of text across a 27" monitor.
  // Non-Outlook clients never see it — it is inside a conditional comment.
  const document = html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />${darkStyle}
    <title>${title}</title>
  </head>
  <body${hook('em-bg')}
    style="margin:0;padding:0;width:100%;background:${BG_COLOR};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;"
    bgcolor="${BG_COLOR}"
  >
    ${preheader}
    <table${hook('em-bg')}
      role="presentation"
      width="100%"
      cellpadding="0"
      cellspacing="0"
      border="0"
      bgcolor="${BG_COLOR}"
      style="background:${BG_COLOR};"
    >
      <tr>
        <td align="center" style="padding:24px 12px;">
          <!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
          <table
            role="presentation"
            width="100%"
            cellpadding="0"
            cellspacing="0"
            border="0"
            style="max-width:560px;width:100%;"
          >
            <tr>
              <td${hook('em-brand')}
                align="center"
                style="padding:0 0 20px 0;font-family:${FONT_STACK};font-size:18px;font-weight:bold;letter-spacing:-0.2px;color:${BRAND_COLOR};"
              >
                ${brandMarkHtml}${appName}
              </td>
            </tr>
            <tr>
              <td${hook('em-card')}
                bgcolor="${CARD_COLOR}"
                style="background:${CARD_COLOR};border:1px solid ${BORDER_COLOR};border-radius:10px;padding:32px 28px;"
              >
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td${hook('em-text')}
                      style="font-family:${FONT_STACK};font-size:20px;font-weight:bold;line-height:28px;color:${TEXT_COLOR};padding:0 0 16px 0;"
                    >
                      ${title}
                    </td>
                  </tr>
                  <tr>
                    <td${hook('em-text')}
                      style="font-family:${FONT_STACK};font-size:15px;line-height:24px;color:${TEXT_COLOR};"
                    >
                      ${bodyHtml}
                    </td>
                  </tr>
                  ${ctaBlock}
                </table>
              </td>
            </tr>
            <tr>
              <td${hook('em-muted')}
                align="center"
                style="padding:20px 12px 0 12px;font-family:${FONT_STACK};font-size:12px;line-height:18px;color:${MUTED_COLOR};"
              >
                ${footerHtml ?? html`This is an automated message from ${appName}.<br />
                If you were not expecting it, you can safely ignore it.`}
              </td>
            </tr>
          </table>
          <!--[if mso]></td></tr></table><![endif]-->
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return document.toString();
}

// -----------------------------------------------------------------------------
// The plain-text half
// -----------------------------------------------------------------------------
//
// THE TEXT PART IS MANDATORY AND HAND-WRITTEN. There is deliberately no
// function anywhere in this module that takes HTML and returns text, because
// the moment one exists every template will use it and the text part stops
// being written.
//
// Two independent reasons, both load-bearing:
//
//   1. **Deliverability.** Spam filters score HTML-only multipart-less mail as
//      a signal, because legitimate bulk senders produce both parts and a good
//      deal of unsolicited mail does not. This is not theoretical scoring
//      trivia: it moves messages to the junk folder.
//
//   2. **It is read by humans.** Text-only clients, screen readers in text
//      mode, and previews all render this part. A machine-stripped version
//      reads as debris — bare CTA URLs stranded mid-sentence, table remnants,
//      the footer welded to the greeting, the preheader padding transcribed as
//      a run of nothing. A recipient who sees that concludes the message is
//      broken, which is worse than the HTML they could not read.
//
// So `plainText` composes from STRUCTURE the author supplies — a title and
// lines — rather than from the rendered markup, which it never sees.
// -----------------------------------------------------------------------------

/**
 * Options of {@link plainText}.
 *
 * @stability experimental
 */
export interface PlainTextOptions {
  /** Same heading as the HTML, so the two parts say the same thing. */
  title: string;

  /**
   * Body paragraphs, one per element; an empty string is a blank line.
   *
   * TYPED AS A NON-EMPTY TUPLE. `[]` does not typecheck, so "I will fill the
   * text part in later" is a compile error rather than a message that ships
   * with an empty alternative part — which is exactly the failure the
   * mandatory-text rule above exists to prevent, and exactly the one that is
   * invisible unless somebody opens the message in a text client.
   */
  lines: readonly [string, ...string[]];

  /** CTA label, matching the HTML button. */
  ctaLabel?: string;

  /** CTA URL. Written out in full — a text part cannot hide a link behind a label. */
  ctaUrl?: string;
}

/**
 * Compose the plain-text alternative for a message.
 *
 * No wrapping, no reflowing, no markdown. Mail clients wrap text parts
 * themselves at the width of the reader's window, and a hard-wrapped body
 * double-wraps into a ragged mess on a phone.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function plainText(opts: PlainTextOptions, ctx?: EmailRenderContext): string {
  const context = resolveEmailRenderContext(ctx);
  const parts: string[] = [context.appName, '', opts.title, '', ...opts.lines];

  if (opts.ctaLabel && opts.ctaUrl) {
    // The URL is scheme-checked here too. A text part is not markup, so there
    // is no injection to prevent — but a `javascript:` URL that the HTML half
    // refused to render must not reappear here as something the recipient can
    // copy into a browser bar.
    const checked = safeUrl(opts.ctaUrl);
    if (checked) {
      parts.push('', `${opts.ctaLabel}: ${checked}`);
    }
  }

  parts.push(
    '',
    '--',
    ...(context.layout.footerText ?? [
      `This is an automated message from ${context.appName}.`,
      'If you were not expecting it, you can safely ignore it.',
    ]),
  );

  // CRLF, not LF. RFC 5322 specifies CRLF line endings, and while most
  // transports normalise, some SMTP relays pass bare LF through and the
  // recipient sees the whole body on one line.
  return parts.join('\r\n');
}

// -----------------------------------------------------------------------------
// Callouts (issue #737)
// -----------------------------------------------------------------------------

/**
 * Options of {@link renderCallout}.
 *
 * @stability experimental
 */
export interface RenderCalloutOptions {
  /** The tone: its colour, tint and label come from the layout theme's `tones`. */
  tone: EmailTone;
  /** The callout text, built with the `html` tag. */
  bodyHtml: SafeHtml;
  /** Replaces the tone's label above the text. */
  label?: string;
}

/**
 * A toned callout block for a template body (a tinted cell with a status bar
 * and an uppercase label), in the theme's tone colours. Not used by the
 * platform's own templates, so the defaults stay byte-identical; for an
 * app's template (warnings, results, notices).
 *
 * @param opts - the tone, the text and an optional label.
 * @param ctx - the render context; default: the configured one.
 * @returns the callout as `SafeHtml`, for a template's `bodyHtml`.
 *
 * @example
 * ```ts
 * const body = html`<p>Your export is ready.</p>${renderCallout({ tone: 'warning', bodyHtml: html`It expires in 24 hours.` }, ctx)}`;
 * ```
 *
 * @stability experimental
 */
export function renderCallout(opts: RenderCalloutOptions, ctx?: EmailRenderContext): SafeHtml {
  const context = resolveEmailRenderContext(ctx);
  const { tones, fontStack } = context.layout.theme;
  const tone = tones[opts.tone];
  const label = opts.label ?? tone.label;
  return html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;">
  <tr>
    <td bgcolor="${tone.tint}" style="background-color:${tone.tint};border-left:4px solid ${tone.color};border-radius:0 8px 8px 0;padding:14px 18px 14px 16px;">
      <div style="padding:0 0 4px 0;font-family:${fontStack};font-size:12px;line-height:16px;font-weight:bold;letter-spacing:0.8px;text-transform:uppercase;color:${tone.color};">${label}</div>
      <div style="font-family:${fontStack};font-size:15px;line-height:22px;">${opts.bodyHtml}</div>
    </td>
  </tr>
</table>`;
}

// Re-exported so `escapeHtml` is reachable from the module #123 names it in,
// alongside `renderLayout`. It is DEFINED in safe-html.ts next to the `html`
// tag that calls it, so the two cannot drift apart.
export { escapeHtml, html, SafeHtml, safeUrl } from './safe-html';
