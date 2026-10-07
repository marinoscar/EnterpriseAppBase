import { ConfigService } from '@nestjs/config';

import { EgressRegistry } from '@marinoscar/platform-api/doctor';

import { EmailSettingsService } from '../../email-settings.service';
import { EmailEgressContributor } from './email.egress.contributor';

function setup(view: Record<string, unknown>, sesRegionFallback = '') {
  const emailSettings = {
    describeForAdmin: jest.fn().mockResolvedValue({ settingsError: null, ...view }),
  } as unknown as EmailSettingsService;
  const config = { get: jest.fn().mockReturnValue(sesRegionFallback) } as unknown as ConfigService;
  return new EmailEgressContributor(new EgressRegistry(), emailSettings, config);
}

describe('EmailEgressContributor (#773)', () => {
  it('enables email.smtp with the relay host only', async () => {
    const [smtp, ses] = await setup({
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
    const [, fromSetting] = await setup({ provider: 'ses', enabled: true, sesRegion: 'eu-west-1' }).describe();
    expect(fromSetting).toMatchObject({ enabled: true, hosts: ['email.eu-west-1.amazonaws.com'], scope: 'public' });

    const [, fromEnv] = await setup({ provider: 'ses', enabled: true }, 'us-east-2').describe();
    expect(fromEnv).toMatchObject({ hosts: ['email.us-east-2.amazonaws.com'] });

    const [, noRegion] = await setup({ provider: 'ses', enabled: true }).describe();
    expect(noRegion).toMatchObject({ hosts: [], scope: 'unknown' });
  });

  it('is disabled when email is off or the stored row is damaged', async () => {
    const off = await setup({ provider: 'smtp', enabled: false, smtpHost: 'smtp.example.com' }).describe();
    expect(off.every((d) => !d.enabled)).toBe(true);

    const damaged = await setup({ provider: 'smtp', enabled: true, smtpHost: 'x', settingsError: 'bad' }).describe();
    expect(damaged.every((d) => !d.enabled)).toBe(true);
  });
});
