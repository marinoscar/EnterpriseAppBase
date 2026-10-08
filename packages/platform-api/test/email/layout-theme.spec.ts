// The layout theme (issue #737): the defaults are the pre-package constants,
// a custom theme changes the colours, tones and dark mode are optional and add
// markup only when set, the footer can be replaced, and bad values are refused
// before they reach a style attribute.
import { renderEmailTemplate } from '../../src/email/templates/email-template.registry';
import { renderCallout, renderLayout, plainText } from '../../src/email/templates/layout';
import { DEFAULT_EMAIL_LAYOUT_THEME, resolveEmailLayout } from '../../src/email/templates/layout-theme';
import { createEmailRenderContext } from '../../src/email/templates/render-context';
import { html } from '../../src/email/templates/safe-html';
import { TEST_APP_NAME, TEST_RENDER_CONTEXT, configureTestEmail } from './support';

configureTestEmail();

const BODY = { title: 'Hello', bodyHtml: html`<p>Body</p>`, ctaLabel: 'Open', ctaUrl: 'https://app.example.test' };

describe('email layout theme', () => {
  it('defaults to the colours and font stack the layout always used', () => {
    expect(DEFAULT_EMAIL_LAYOUT_THEME.colors).toEqual({
      background: '#f4f5f7',
      card: '#ffffff',
      border: '#e2e5ea',
      text: '#1f2937',
      muted: '#4b5563',
      brand: '#2f4f8f',
      onBrand: '#ffffff',
    });
    expect(DEFAULT_EMAIL_LAYOUT_THEME.fontStack).toBe('Arial, Helvetica, sans-serif');
  });

  it('renders the same document with an explicit default theme as with none', () => {
    const explicit = createEmailRenderContext({ appName: TEST_APP_NAME, layout: { theme: { colors: { ...DEFAULT_EMAIL_LAYOUT_THEME.colors } } } });
    expect(renderLayout(BODY, explicit)).toBe(renderLayout(BODY, TEST_RENDER_CONTEXT));
  });

  it('a custom theme changes the colours and the font stack, and merges over the defaults', () => {
    const ctx = createEmailRenderContext({
      appName: TEST_APP_NAME,
      layout: { theme: { colors: { brand: '#0f766e', background: '#fafafa' }, fontStack: 'Georgia, serif' } },
    });
    const doc = renderLayout(BODY, ctx);
    expect(doc).toContain('bgcolor="#0f766e"');
    expect(doc).toContain('background:#fafafa;');
    expect(doc).toContain('font-family:Georgia, serif;');
    expect(doc).not.toContain('#2f4f8f');
    expect(doc).not.toContain('#f4f5f7');
    // Untouched colours keep their defaults.
    expect(doc).toContain('#1f2937');
  });

  it('changes the colours of every template rendered with the theme', () => {
    const ctx = createEmailRenderContext({ appName: TEST_APP_NAME, layout: { theme: { colors: { brand: '#0f766e' } } } });
    const message = renderEmailTemplate('broadcast', { title: 'News', body: 'Hello', ctaUrl: 'https://app.example.test/n' }, ctx);
    expect(message.html).toContain('#0f766e');
    expect(message.html).not.toContain('#2f4f8f');
  });

  it('emits no <style> block and no class hook without dark mode, and both with it', () => {
    expect(renderLayout(BODY, TEST_RENDER_CONTEXT)).not.toMatch(/<style|class="/);

    const dark = createEmailRenderContext({
      appName: TEST_APP_NAME,
      layout: { theme: { dark: { background: '#0b1220', card: '#111827', border: '#1f2937', text: '#e5e7eb', muted: '#9ca3af', accent: '#5eead4' } } },
    });
    const doc = renderLayout(BODY, dark);
    expect(doc).toContain('<style>@media (prefers-color-scheme: dark){');
    expect(doc).toContain('.em-card{background:#111827!important;');
    expect(doc).toContain('.em-brand{color:#5eead4!important;}');
    expect(doc).toContain('<body class="em-bg"');
    expect(doc).toContain('class="em-card"');
    // The inline light palette is still there for clients that strip <style>.
    expect(doc).toContain('background:#f4f5f7;');
  });

  it('renders a callout in the theme tones, defaulting to the platform tones', () => {
    const callout = renderCallout({ tone: 'warning', bodyHtml: html`Expires <b>soon</b>` }, TEST_RENDER_CONTEXT).toString();
    expect(callout).toContain('#8a5a00');
    expect(callout).toContain('>Warning</div>');
    expect(callout).toContain('Expires <b>soon</b>');

    const ctx = createEmailRenderContext({
      appName: TEST_APP_NAME,
      layout: { theme: { tones: { ...DEFAULT_EMAIL_LAYOUT_THEME.tones, warning: { color: '#b45309', tint: '#fffbeb', label: 'Heads up' } } } },
    });
    const custom = renderCallout({ tone: 'warning', bodyHtml: html`x` }, ctx).toString();
    expect(custom).toContain('#b45309');
    expect(custom).toContain('>Heads up</div>');
  });

  it('replaces the footer in both parts when told to', () => {
    const ctx = createEmailRenderContext({
      appName: TEST_APP_NAME,
      layout: { footerHtml: html`Sent by Acme Ltd, 1 Main St.`, footerText: ['Sent by Acme Ltd, 1 Main St.'] },
    });
    expect(renderLayout(BODY, ctx)).toContain('Sent by Acme Ltd, 1 Main St.');
    expect(renderLayout(BODY, ctx)).not.toContain('This is an automated message');
    const text = plainText({ title: 'Hello', lines: ['Body'] }, ctx);
    expect(text.endsWith('--\r\nSent by Acme Ltd, 1 Main St.')).toBe(true);
  });

  it('names the product from the context in the wordmark, the footer and the text part', () => {
    const ctx = createEmailRenderContext({ appName: 'Acme Portal' });
    expect(renderLayout(BODY, ctx)).toContain('This is an automated message from Acme Portal.');
    expect(plainText({ title: 'Hello', lines: ['Body'] }, ctx).startsWith('Acme Portal\r\n')).toBe(true);
  });

  it.each([
    [{ theme: { colors: { brand: 'red;background:url(https://evil.test)' } } }, 'theme.colors.brand'],
    [{ theme: { fontStack: 'Arial;}</style><script>' } }, 'theme.fontStack'],
    [{ theme: { dark: { background: 'black', card: '#000', border: '#000', text: '#fff', muted: '#ccc', accent: '#fff' } } }, 'theme.dark.background'],
    [{ brandMark: { pngBase64: 'not base64!', cid: 'brand-mark', displaySize: 40 } }, 'brandMark.pngBase64'],
    [{ brandMark: { pngBase64: 'iVBORw0KGgo=', cid: '<brand-mark>', displaySize: 40 } }, 'brandMark.cid'],
    [{ brandMark: { pngBase64: 'iVBORw0KGgo=', cid: 'brand-mark', displaySize: 4 } }, 'brandMark.displaySize'],
  ])('refuses an invalid layout option (%#)', (layout, field) => {
    expect(() => resolveEmailLayout(layout as never)).toThrow(field);
  });

  it('requires a product name', () => {
    expect(() => createEmailRenderContext({ appName: '  ' })).toThrow('product name');
  });
});
