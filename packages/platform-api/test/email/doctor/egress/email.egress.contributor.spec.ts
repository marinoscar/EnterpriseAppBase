import { EgressRegistry } from '../../../../src/doctor/index';

import { EmailSettingsService } from '../../../../src/email/email-settings.service';
import { EmailEgressContributor } from '../../../../src/email/doctor/egress/email.egress.contributor';
import { registerEmailTransport } from '../../../../src/email/transports/email-transport';
import { z } from 'zod';

registerEmailTransport({
  id: 'egress-spec',
  label: 'Egress spec relay',
  settingsSchema: z.object({ apiBase: z.string() }),
  defaults: { apiBase: '' },
  egressHosts: (settings) => (settings.apiBase ? [new URL(settings.apiBase as string).host] : []),
  build: () => ({ send: async () => ({ success: true }) }),
});

function setup(view: Record<string, unknown>, sesRegionFallback = '') {
  const emailSettings = {
    describeForAdmin: jest.fn().mockResolvedValue({ settingsError: null, ...view }),
  } as unknown as EmailSettingsService;
  return new EmailEgressContributor(new EgressRegistry(), emailSettings, { sesRegionFallback: () => sesRegionFallback });
}

describe('EmailEgressContributor (#773)', () => {
  it('enables email.smtp with the relay host only', async () => {
    const [ses, smtp] = await setup({
      provider: 'smtp',
      enabled: true,
      smtpHost: 'smtp.corp.internal',
      smtpPort: 587,
      smtpUsername: 'mailer',
      smtpPasswordStatus: { configured: true, hint: '••••word' },
    }).describe();

    expect(smtp).toMatchObject({ id: 'email.smtp', enabled: true, hosts: ['smtp.corp.internal'], scope: 'private' });
    expect(ses).toMatchObject({ id: 'email.ses', enabled: false });
    expect(JSON.stringify([smtp, ses])).not.toMatch(/mailer|word|587/);
  });

  it('enables email.ses with the regional host, from the setting or the SES_REGION fallback', async () => {
    const [fromSetting] = await setup({ provider: 'ses', enabled: true, sesRegion: 'eu-west-1' }).describe();
    expect(fromSetting).toMatchObject({ enabled: true, hosts: ['email.eu-west-1.amazonaws.com'], scope: 'public' });

    const [fromEnv] = await setup({ provider: 'ses', enabled: true }, 'us-east-2').describe();
    expect(fromEnv).toMatchObject({ hosts: ['email.us-east-2.amazonaws.com'] });

    const [noRegion] = await setup({ provider: 'ses', enabled: true }).describe();
    expect(noRegion).toMatchObject({ hosts: [], scope: 'unknown' });
  });

  it('lists a registered transport by its label and hosts, enabled when it is the selected one', async () => {
    const view = { provider: 'egress-spec', enabled: true, transports: { 'egress-spec': { apiBase: 'https://mail.relay.example.test/v3' } } };

    const dependencies = await setup(view).describe();
    const relay = dependencies.find((dependency) => dependency.id === 'email.egress-spec');

    expect(dependencies.map((dependency) => dependency.id)).toEqual(['email.ses', 'email.smtp', 'email.egress-spec']);
    expect(relay).toMatchObject({ capability: 'Email (Egress spec relay)', enabled: true, hosts: ['mail.relay.example.test'] });
    expect(dependencies.filter((dependency) => dependency.enabled)).toHaveLength(1);
  });

  it('is disabled when email is off or the stored row is damaged', async () => {
    const off = await setup({ provider: 'smtp', enabled: false, smtpHost: 'smtp.example.com' }).describe();
    expect(off.every((d) => !d.enabled)).toBe(true);

    const damaged = await setup({ provider: 'smtp', enabled: true, smtpHost: 'x', settingsError: 'bad' }).describe();
    expect(damaged.every((d) => !d.enabled)).toBe(true);
  });
});
