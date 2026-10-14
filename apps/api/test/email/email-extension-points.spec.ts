import { RegistryError, withTemporaryEntries } from '@marinoscar/platform-api/core';
import {
  createEmailRenderContext,
  emailTemplateOverrideRegistry,
  emailTemplateRegistry,
  findEmailTemplate,
  listEmailTemplateOverrides,
  registerEmailTemplate,
  renderEmailTemplate,
} from '@marinoscar/platform-api/email';
import { APP_NAME } from '@app/shared';

// The notification manifest: configures rendering and registers every template.
import '../../src/platform/notifications';
import { BRANDED_EMAIL_LAYOUT } from '../../src/platform-extensions/email/examples/branded-layout.example';
import {
  EXAMPLE_DIGEST_EMAIL_TEMPLATE,
  exampleDigestEmail,
} from '../../src/platform-extensions/email/examples/example-digest.email';
import { supportTestEmail } from '../../src/platform-extensions/email/examples/test-email.override.example';

// =============================================================================
// The email slice's extension points, as the reference app uses them (#737)
// =============================================================================
//
// The three examples under src/platform-extensions/email/examples are compiled
// with the app but not wired; this suite wires each one for its duration:
//   - an app template typed by augmenting EmailTemplateDataMap;
//   - a layout theme with dark mode and an inline brand mark;
//   - an override of a platform template (`test-email`), in a test only.
// =============================================================================

const DIGEST = { recipientName: '<b>Grace</b>', week: '2026-W41', items: ['Ran 5k', 'Lifted <script>'] };

/** Runs `fn` with the template registries open, restoring both afterwards. */
function withOpenEmailRegistries<R>(fn: () => R | Promise<R>): Promise<R> {
  return withTemporaryEntries(emailTemplateRegistry, [], () => withTemporaryEntries(emailTemplateOverrideRegistry, [], fn));
}

describe('email extension points (reference app)', () => {
  it('registers the platform, slice-owned and app templates through the manifest, with the app name', () => {
    expect(emailTemplateRegistry.ids()).toEqual([
      'test-email',
      'user-welcome',
      'allowlist-invitation',
      'role-changed',
      'broadcast',
      'job-failed',
      'node-offline',
      'backup-failed',
      'restore-completed',
      'org-invitation',
      'group-invitation',
      'shared-with-you',
    ]);
    expect(renderEmailTemplate('user-welcome', { recipientEmail: 'a@example.test', roles: [] }).subject).toBe(`Welcome to ${APP_NAME}`);
  });

  it('an app template: registered by name, typed by the data map, rendered through the registry', async () => {
    await withOpenEmailRegistries(() => {
      registerEmailTemplate('example-digest', exampleDigestEmail);

      const message = renderEmailTemplate('example-digest', DIGEST);
      expect(message.subject).toBe(`Your ${APP_NAME} week (2026-W41)`);
      expect(message.html).toContain('Hello &lt;b&gt;Grace&lt;/b&gt;,');
      expect(message.html).not.toContain('<script>');
      expect(message.text).toContain('- Lifted <script>');
      expect(findEmailTemplate('example-digest')).toBeDefined();
    });
    expect(findEmailTemplate('example-digest')).toBeUndefined();
  });

  it('the same template as an APP_EMAIL_TEMPLATES entry', async () => {
    await withTemporaryEntries(emailTemplateRegistry, [EXAMPLE_DIGEST_EMAIL_TEMPLATE], () => {
      expect(findEmailTemplate('example-digest')?.(DIGEST).subject).toContain('2026-W41');
    });
  });

  it('a layout theme with a brand mark: new colours, dark mode, an inline part the HTML references', () => {
    const branded = createEmailRenderContext({ appName: APP_NAME, layout: BRANDED_EMAIL_LAYOUT });
    const message = renderEmailTemplate('broadcast', { title: 'News', body: 'Hello', ctaUrl: 'https://app.example.test/n' }, branded);

    expect(message.html).toContain('bgcolor="#0f766e"');
    expect(message.html).toContain('@media (prefers-color-scheme: dark)');
    expect(message.html).toContain('<img src="cid:brand-mark"');
    expect(message.html).toContain('Sent by Example Ltd, 1 Main Street.');
    expect(message.attachments).toEqual([expect.objectContaining({ contentId: 'brand-mark', disposition: 'inline', contentType: 'image/png' })]);

    // The production wiring keeps the platform layout.
    const plain = renderEmailTemplate('broadcast', { title: 'News', body: 'Hello' });
    expect(plain.html).not.toContain('cid:');
    expect(plain).not.toHaveProperty('attachments');
  });

  it('an override of test-email: refused without override: true, wins with it, listed for the bootstrap log', async () => {
    await withOpenEmailRegistries(() => {
      let refused: unknown;
      try {
        registerEmailTemplate('test-email', supportTestEmail);
      } catch (err) {
        refused = err;
      }
      expect(refused).toBeInstanceOf(RegistryError);
      expect((refused as RegistryError).code).toBe('DUPLICATE_ID');
      expect((refused as Error).message).toContain('"test-email"');

      registerEmailTemplate('test-email', supportTestEmail, { override: true, registrant: 'reference-app-test' });
      const message = renderEmailTemplate('test-email', { recipientEmail: 'admin@example.test', providerKind: 'smtp', sentAt: new Date(0) });
      expect(message.text).toContain('Problems? Write to support@example.test.');
      expect(listEmailTemplateOverrides()).toEqual([{ name: 'test-email', registrant: 'reference-app-test' }]);
    });
    expect(listEmailTemplateOverrides()).toEqual([]);
  });
});
