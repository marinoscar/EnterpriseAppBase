// =============================================================================
// Email layout theme, brand mark and footer (issue #737, PP-8.4)
// =============================================================================
//
// What an app may change about the shell every message shares, without
// forking `layout.ts`: the palette, the callout tones, an optional dark-mode
// block, the font stack, an inline brand mark and the footer. EvoPath rewrote
// the whole layout to get exactly these; the theme covers them as data.
//
// THE DEFAULTS ARE THE PRE-PACKAGE `layout.ts` CONSTANTS, and with default
// options the rendered output is byte-for-byte what it was
// (test/email/templates/templates.snapshot.spec.ts). Every optional part
// (tones, dark, brand mark, footer) adds markup ONLY when it is configured.
//
// VALIDATED, because a theme value lands inside a `style` attribute and, for
// dark mode, inside a `<style>` block where no HTML escaping applies: colours
// are hex only, the font stack is a list of family names.
//
// FRAMEWORK-FREE: types, constants and pure functions.
// =============================================================================

import type { EmailAttachment } from '../email.types';
import type { SafeHtml } from './safe-html';

/**
 * The four callout tones of {@link EmailLayoutTheme.tones}.
 *
 * @stability experimental
 */
export type EmailTone = 'info' | 'success' | 'warning' | 'critical';

/**
 * One callout tone: the status colour (bar and label), the tint behind the
 * text and the label shown above it.
 *
 * @stability experimental
 */
export interface EmailToneStyle {
  /** The status colour, hex. */
  color: string;
  /** The background tint, hex. */
  tint: string;
  /** The label above the callout text, e.g. `Warning`. */
  label: string;
}

/**
 * The palette and type of the email layout. The `layout.theme` option of
 * `EmailModule.forRoot` is merged over {@link DEFAULT_EMAIL_LAYOUT_THEME}.
 *
 * @example
 * ```ts
 * EmailModule.forRoot({ appName: 'Acme', layout: { theme: { colors: { brand: '#0f766e' } } } });
 * ```
 *
 * @extensionPoint theme-token
 * @stability experimental
 */
export interface EmailLayoutTheme {
  /** The light palette, hex colours. Every key has a platform default. */
  colors: {
    /** Page background. */
    background: string;
    /** The body card. */
    card: string;
    /** The card's border. */
    border: string;
    /** Body text. */
    text: string;
    /** The footer and secondary text. */
    muted: string;
    /** The wordmark and the call-to-action button. */
    brand: string;
    /** The call-to-action label, on `brand`. */
    onBrand: string;
  };
  /** The callout tones `renderCallout` uses. Default: {@link DEFAULT_EMAIL_TONES}. */
  tones?: Record<EmailTone, EmailToneStyle>;
  /**
   * Dark-mode values, emitted ONLY when set, as a progressive
   * `@media (prefers-color-scheme: dark)` block (clients that strip `<style>`
   * keep the light palette, which is built to survive forced inversion).
   */
  dark?: { background: string; card: string; border: string; text: string; muted: string; accent: string };
  /** The CSS font stack; families present on every mail client host. */
  fontStack?: string;
}

/**
 * The inline brand mark slot: a PNG shipped INSIDE the message as a
 * `Content-ID` part and referenced as `cid:<cid>`, so it renders without a
 * network fetch and without the recipient clicking "display images" (remote
 * images are blocked by default, and are a tracking signal to spam filters).
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface EmailBrandMark {
  /** The PNG bytes, base64 (no `data:` prefix, no line breaks). */
  pngBase64: string;
  /** The Content-ID, without angle brackets, e.g. `brand-mark`. */
  cid: string;
  /** The rendered width and height in CSS pixels (8 to 256). */
  displaySize: number;
  /** The alt text. Default: empty (the product name is beside it as text). */
  alt?: string;
}

/**
 * The `layout` option of `EmailModule.forRoot`.
 *
 * @stability experimental
 */
export interface EmailLayoutOptions {
  /** Merged over {@link DEFAULT_EMAIL_LAYOUT_THEME}, colour by colour. */
  theme?: Partial<Omit<EmailLayoutTheme, 'colors'>> & { colors?: Partial<EmailLayoutTheme['colors']> };
  /** The inline brand mark, shown above the product name. Default: none. */
  brandMark?: EmailBrandMark;
  /** Replaces the HTML footer text. Build it with the `html` tag. Default: the platform's. */
  footerHtml?: SafeHtml;
  /** Replaces the plain-text footer lines (after the `--` separator). Default: the platform's. */
  footerText?: readonly string[];
}

/**
 * The layout every template renders with: the theme with every default
 * filled in, the brand mark, the footer overrides and the inline parts the
 * brand mark needs.
 *
 * @stability experimental
 */
export interface ResolvedEmailLayout {
  /** The complete theme. */
  readonly theme: Readonly<Required<Omit<EmailLayoutTheme, 'dark'>>> & Pick<EmailLayoutTheme, 'dark'>;
  /** The brand mark, or `null`. */
  readonly brandMark: Readonly<EmailBrandMark> | null;
  /** The HTML footer override, or `null` for the platform's. */
  readonly footerHtml: SafeHtml | null;
  /** The plain-text footer override, or `null` for the platform's. */
  readonly footerText: readonly string[] | null;
  /** The inline parts a rendered message referencing them must carry (the brand mark). */
  readonly attachments: readonly EmailAttachment[];
}

/**
 * The platform's callout tones.
 *
 * @stability experimental
 */
export const DEFAULT_EMAIL_TONES: Readonly<Record<EmailTone, EmailToneStyle>> = Object.freeze({
  info: { color: '#2f4f8f', tint: '#eef2fa', label: 'Info' },
  success: { color: '#1f6f43', tint: '#ecf7f0', label: 'Success' },
  warning: { color: '#8a5a00', tint: '#fdf6e7', label: 'Warning' },
  critical: { color: '#b42318', tint: '#fdeeed', label: 'Critical' },
});

/**
 * The platform theme: the colours and font stack the layout has always used.
 * Deep `brand` so an inverted button still contrasts with its white label;
 * near-black text on near-white, never a mid-grey, so forced dark mode keeps
 * the contrast.
 *
 * @stability experimental
 */
export const DEFAULT_EMAIL_LAYOUT_THEME: Readonly<Required<Omit<EmailLayoutTheme, 'dark'>>> = Object.freeze({
  colors: Object.freeze({
    background: '#f4f5f7',
    card: '#ffffff',
    border: '#e2e5ea',
    text: '#1f2937',
    muted: '#4b5563',
    brand: '#2f4f8f',
    onBrand: '#ffffff',
  }),
  tones: DEFAULT_EMAIL_TONES,
  fontStack: 'Arial, Helvetica, sans-serif',
});

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FONT_STACK = /^[A-Za-z0-9 ,'"-]{1,200}$/;
const CONTENT_ID = /^[A-Za-z0-9._-]{1,64}(?:@[A-Za-z0-9.-]{1,190})?$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function assertHex(value: unknown, where: string): asserts value is string {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
    throw new Error(`Email layout: ${where} must be a hex colour such as #2f4f8f (got ${JSON.stringify(value)}).`);
  }
}

/**
 * Resolves the `layout` option: merges the theme over the defaults, checks
 * every value and builds the brand mark's inline part.
 *
 * @param options - the `layout` option; omitted means the platform defaults.
 * @returns the resolved layout (frozen).
 * @throws Error naming the offending field when a colour, the font stack or
 *   the brand mark is invalid.
 *
 * @stability experimental
 */
export function resolveEmailLayout(options: EmailLayoutOptions = {}): ResolvedEmailLayout {
  const theme = options.theme ?? {};
  const colors = { ...DEFAULT_EMAIL_LAYOUT_THEME.colors, ...(theme.colors ?? {}) };
  for (const [key, value] of Object.entries(colors)) assertHex(value, `theme.colors.${key}`);

  const tones = { ...DEFAULT_EMAIL_TONES, ...(theme.tones ?? {}) } as Record<EmailTone, EmailToneStyle>;
  for (const [tone, style] of Object.entries(tones)) {
    assertHex(style?.color, `theme.tones.${tone}.color`);
    assertHex(style?.tint, `theme.tones.${tone}.tint`);
    if (typeof style.label !== 'string' || style.label.trim() === '') {
      throw new Error(`Email layout: theme.tones.${tone}.label must be a non-empty string.`);
    }
  }

  if (theme.dark !== undefined) {
    for (const key of ['background', 'card', 'border', 'text', 'muted', 'accent'] as const) {
      assertHex(theme.dark[key], `theme.dark.${key}`);
    }
  }

  const fontStack = theme.fontStack ?? DEFAULT_EMAIL_LAYOUT_THEME.fontStack;
  if (!FONT_STACK.test(fontStack)) {
    throw new Error('Email layout: theme.fontStack must be a comma-separated list of font family names.');
  }

  let brandMark: EmailBrandMark | null = null;
  const attachments: EmailAttachment[] = [];
  if (options.brandMark !== undefined) {
    const mark = options.brandMark;
    if (typeof mark.pngBase64 !== 'string' || mark.pngBase64.length === 0 || !BASE64.test(mark.pngBase64)) {
      throw new Error('Email layout: brandMark.pngBase64 must be base64 PNG bytes (no data: prefix, no line breaks).');
    }
    if (typeof mark.cid !== 'string' || !CONTENT_ID.test(mark.cid)) {
      throw new Error('Email layout: brandMark.cid must be a Content-ID such as "brand-mark" (no angle brackets).');
    }
    if (!Number.isInteger(mark.displaySize) || mark.displaySize < 8 || mark.displaySize > 256) {
      throw new Error('Email layout: brandMark.displaySize must be an integer between 8 and 256.');
    }
    brandMark = Object.freeze({ ...mark, alt: mark.alt ?? '' });
    attachments.push(
      Object.freeze({
        filename: `${mark.cid.split('@')[0]}.png`,
        contentType: 'image/png',
        contentBase64: mark.pngBase64,
        contentId: mark.cid,
        disposition: 'inline' as const,
      }),
    );
  }

  return Object.freeze({
    theme: Object.freeze({
      colors: Object.freeze(colors),
      tones: Object.freeze(tones),
      fontStack,
      ...(theme.dark !== undefined ? { dark: Object.freeze({ ...theme.dark }) } : {}),
    }),
    brandMark,
    footerHtml: options.footerHtml ?? null,
    footerText: options.footerText !== undefined ? Object.freeze([...options.footerText]) : null,
    attachments: Object.freeze(attachments),
  });
}
