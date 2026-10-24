// The email conformance suite (#737): it passes a conformant app and fails
// each violation.
import { withTemporaryEntries } from '../../src/core/registry/index';
import {
  checkEmailSettingsSchemas,
  checkEmailTemplateRendering,
  checkPlatformEmailTemplates,
  emailConformanceSuite,
} from '../../src/email/testing/index';
import { emailTemplateRegistry } from '../../src/email/templates/email-template.registry';
import type { EmailTemplate } from '../../src/email/templates/email-template.types';
import { conformanceSuites } from '../../src/testing/index';
import { configureTestEmail } from './support';

configureTestEmail();

const context = { sourceRoots: [__dirname] };

describe('the email conformance suite', () => {
  it('is registered by importing the testing entry', () => {
    expect(conformanceSuites.get('email')).toBe(emailConformanceSuite);
  });

  it('passes an app with the platform templates registered and rendering configured', () => {
    const report = emailConformanceSuite.check(context, {});
    expect(report.findings).toEqual([]);
    expect(report.scanned).toEqual({ templates: 9, samples: 9, schemas: 2 });
  });

  it('fails a missing platform template', () => {
    expect(checkPlatformEmailTemplates(['test-email'])).toHaveLength(8);
    expect(checkPlatformEmailTemplates(['test-email'])[0]!.message).toContain('"user-welcome" is not registered');
  });

  it('fails a template that puts markup from its data into the HTML unescaped, or renders an empty part', async () => {
    const leaky: EmailTemplate<{ name: string }> = (data) => ({
      subject: 'Hi',
      html: `<!doctype html><p>${data.name}</p>`,
      text: '',
    });
    await withTemporaryEntries(emailTemplateRegistry, [{ name: 'leaky', render: leaky as EmailTemplate<never> }], () => {
      const messages = checkEmailTemplateRendering({ leaky: { name: '<script>alert(1)</script>' } }).map((f) => f.message);
      expect(messages).toEqual([
        expect.stringContaining('"leaky" renders an empty text part'),
        expect.stringContaining('"leaky" puts markup from its data into the HTML unescaped'),
      ]);
    });
  });

  it('fails a sample naming an unregistered template', () => {
    expect(checkEmailTemplateRendering({ ghost: {} })[0]!.message).toContain('"ghost", which is not registered');
  });

  it('finds no secret-bearing field in the email settings schemas', () => {
    expect(checkEmailSettingsSchemas()).toEqual([]);
  });

  it('skips the defaults check for an app that opted out of them', () => {
    expect(emailConformanceSuite.check(context, { withoutDefaultTemplates: true }).scanned.samples).toBe(0);
  });
});
