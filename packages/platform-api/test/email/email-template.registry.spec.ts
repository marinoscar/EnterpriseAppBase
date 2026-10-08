// The email template registry (issue #737): an app template typed by
// augmenting EmailTemplateDataMap, the duplicate rule, the explicit override
// (and its bootstrap log), the idempotent platform registration, and the
// runtime lookup by string.
import { Logger } from '@nestjs/common';

import { RegistryError, withTemporaryEntries } from '../../src/core/registry/index';
import { EmailTemplateOverrideReporter } from '../../src/email/email.module';
import {
  emailTemplateOverrideRegistry,
  emailTemplateRegistry,
  findEmailTemplate,
  isEmailTemplateName,
  listEmailTemplateOverrides,
  registerEmailTemplate,
  registerPlatformEmailTemplates,
  renderEmailTemplate,
} from '../../src/email/templates/email-template.registry';
import type { EmailTemplate, RenderedEmail } from '../../src/email/templates/email-template.types';
import { html, plainText, renderLayout } from '../../src/email/templates/layout';
import { PLATFORM_EMAIL_TEMPLATES } from '../../src/email/templates/platform-email-templates';
import { resolveEmailRenderContext, type EmailRenderContext } from '../../src/email/templates/render-context';
import { TEST_APP_NAME, configureTestEmail } from './support';

configureTestEmail();

// ---- an app template, typed by augmentation ------------------------------------------
interface RegistryDigestData {
  week: string;
  items: string[];
}

declare module '../../src/email/templates/email-template.registry' {
  interface EmailTemplateDataMap {
    'registry-spec-digest': RegistryDigestData;
  }
}

function digestEmail(data: RegistryDigestData, ctx?: EmailRenderContext): RenderedEmail {
  const context = resolveEmailRenderContext(ctx);
  const title = `Your week of ${data.week}`;
  return {
    subject: `${context.appName}: ${title}`,
    html: renderLayout({ title, bodyHtml: html`<p>${data.items.join(', ')}</p>` }, context),
    text: plainText({ title, lines: [data.items.join(', ')] }, context),
  };
}

/** Runs `fn` with the base and override registries open, and restores both afterwards. */
function withOpenRegistries<R>(fn: () => R | Promise<R>): Promise<R> {
  return withTemporaryEntries(emailTemplateRegistry, [], () => withTemporaryEntries(emailTemplateOverrideRegistry, [], fn));
}

function registryError(fn: () => void): RegistryError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(RegistryError);
    return err as RegistryError;
  }
  throw new Error('expected a RegistryError');
}

describe('email template registry', () => {
  it('holds the nine platform templates in order', () => {
    expect(emailTemplateRegistry.ids()).toEqual(Object.keys(PLATFORM_EMAIL_TEMPLATES));
  });

  it('registers an app template, typed by the data map, and renders it through the registry', async () => {
    await withOpenRegistries(() => {
      registerEmailTemplate('registry-spec-digest', digestEmail, { registrant: 'spec' });

      expect(isEmailTemplateName('registry-spec-digest')).toBe(true);
      const rendered = renderEmailTemplate('registry-spec-digest', { week: '2026-W41', items: ['<b>run</b>'] });
      expect(rendered.subject).toBe(`${TEST_APP_NAME}: Your week of 2026-W41`);
      expect(rendered.html).toContain('&lt;b&gt;run&lt;/b&gt;');
      expect(findEmailTemplate('registry-spec-digest')?.({ week: 'x', items: [] }).text).toContain('Your week of x');
    });
    expect(isEmailTemplateName('registry-spec-digest')).toBe(false);
  });

  it('rejects the wrong data shape at compile time', () => {
    // Never run: the assertions are `tsc` (npm run typecheck covers test/).
    const typeOnly = (): void => {
      // @ts-expect-error `items` must be a string array.
      renderEmailTemplate('registry-spec-digest', { week: '2026-W41', items: 3 });
      // @ts-expect-error a template whose data does not match the name's.
      registerEmailTemplate('registry-spec-digest', (data: { other: number }) => ({ subject: String(data.other), html: '', text: '' }));
      // @ts-expect-error an undeclared name.
      registerEmailTemplate('never-declared', digestEmail);
      // @ts-expect-error a platform name with another template's data.
      renderEmailTemplate('broadcast', { recipientEmail: 'x@example.test', roles: [] });
    };
    expect(typeof typeOnly).toBe('function');
  });

  it('throws DUPLICATE_ID naming the template when a name is registered twice without override', async () => {
    await withOpenRegistries(() => {
      const err = registryError(() => registerEmailTemplate('broadcast', PLATFORM_EMAIL_TEMPLATES['user-welcome'] as never));
      expect(err.code).toBe('DUPLICATE_ID');
      expect(err.message).toContain('"broadcast"');
      expect(err.message).toContain('override: true');
    });
  });

  it('lets an explicit override win, for both lookups, and lists it for the bootstrap log', async () => {
    const branded: EmailTemplate<unknown> = () => ({ subject: 'Branded', html: '<!doctype html><p>b</p>', text: 'b' });
    await withOpenRegistries(() => {
      registerEmailTemplate('broadcast', branded as never, { override: true, registrant: 'acme' });

      expect(renderEmailTemplate('broadcast', { title: 't', body: 'b' }).subject).toBe('Branded');
      expect(findEmailTemplate('broadcast')?.({ title: 't', body: 'b' }).subject).toBe('Branded');
      // The base registry keeps the platform's renderer and its order.
      expect(emailTemplateRegistry.require('broadcast').render).toBe(PLATFORM_EMAIL_TEMPLATES.broadcast);
      expect(listEmailTemplateOverrides()).toEqual([{ name: 'broadcast', registrant: 'acme' }]);

      // One override per name.
      expect(registryError(() => registerEmailTemplate('broadcast', branded as never, { override: true })).code).toBe('DUPLICATE_ID');
    });
    expect(findEmailTemplate('broadcast')?.({ title: 't', body: 'b' }).subject).toBe('t');
  });

  it('refuses to override a name nothing registered', async () => {
    await withOpenRegistries(() => {
      const err = registryError(() => registerEmailTemplate('registry-spec-digest', digestEmail, { override: true }));
      expect(err.code).toBe('INVALID_ENTRY');
      expect(err.message).toContain('nothing to override');
    });
  });

  it('logs each override once at bootstrap, naming the template and the registrant', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const branded: EmailTemplate<unknown> = () => ({ subject: 'B', html: '', text: '' });
    await withOpenRegistries(() => {
      registerEmailTemplate('test-email', branded as never, { override: true, registrant: 'spec-override' });
      const reporter = new EmailTemplateOverrideReporter();
      reporter.onApplicationBootstrap();
      reporter.onApplicationBootstrap();
    });
    const lines = log.mock.calls.map(([message]) => String(message)).filter((m) => m.includes('spec-override'));
    expect(lines).toEqual(['Email template "test-email" is overridden by spec-override.']);
    log.mockRestore();
  });

  it('registers the platform templates idempotently (forRoot and a manifest may both call it)', async () => {
    await withOpenRegistries(() => {
      registerPlatformEmailTemplates();
      registerPlatformEmailTemplates();
      expect(emailTemplateRegistry.ids()).toEqual(Object.keys(PLATFORM_EMAIL_TEMPLATES));
      // Nothing left to register, so even a frozen registry is no obstacle.
      emailTemplateRegistry.freeze();
      expect(() => registerPlatformEmailTemplates()).not.toThrow();
    });
  });

  it('findEmailTemplate returns undefined for an unknown name and never throws', () => {
    expect(findEmailTemplate('decommissioned-template')).toBeUndefined();
  });

  it('is frozen after bootstrap: a late registration throws FROZEN', async () => {
    await withOpenRegistries(() => {
      emailTemplateRegistry.freeze();
      expect(registryError(() => registerEmailTemplate('registry-spec-digest', digestEmail)).code).toBe('FROZEN');
    });
  });
});
