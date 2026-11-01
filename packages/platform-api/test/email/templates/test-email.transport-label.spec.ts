import { z } from 'zod';

import { registerEmailTransport } from '../../../src/email/transports/email-transport';
import { renderEmailTemplate } from '../../../src/email/templates/index';
import { configureTestEmail } from '../support';

configureTestEmail();

registerEmailTransport({
  id: 'label-spec',
  label: 'Label <Spec> Relay',
  settingsSchema: z.object({ host: z.string() }),
  defaults: { host: '' },
  build: () => ({ send: async () => ({ success: true }) }),
});

const data = (providerKind: string) => ({
  recipientEmail: 'admin@example.test',
  providerKind,
  sentAt: new Date('2026-01-01T00:00:00.000Z'),
  triggeredBy: 'admin@example.test',
});

describe('the test email names the transport by its registered label (PP-14.8)', () => {
  it('uses the shipped labels for ses and smtp, even before the built-ins registered', () => {
    expect(renderEmailTemplate('test-email', data('smtp')).text).toContain('SMTP');
    expect(renderEmailTemplate('test-email', data('ses')).text).toContain('Amazon SES');
  });

  it('uses the label a registered transport declares, escaped in the HTML', () => {
    const rendered = renderEmailTemplate('test-email', data('label-spec'));

    expect(rendered.text).toContain('Label <Spec> Relay');
    expect(rendered.html).toContain('Label &lt;Spec&gt; Relay');
    expect(rendered.html).not.toContain('Label <Spec> Relay');
  });

  it('falls back to the id for a transport that is no longer registered', () => {
    expect(renderEmailTemplate('test-email', data('gone-plugin')).text).toContain('gone-plugin');
  });
});
