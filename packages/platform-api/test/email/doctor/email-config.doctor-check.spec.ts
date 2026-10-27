import { DoctorCheckOutcome } from '../../../src/doctor/index';
import { DoctorCheckRegistry } from '../../../src/doctor/index';
import { EmailSettingsAdminView, EmailSettingsService } from '../../../src/email/email-settings.service';
import { EmailConfigDoctorCheck, decideEmailConfig } from '../../../src/email/doctor/email-config.doctor-check';
import { registerEmailTransport } from '../../../src/email/transports/email-transport';
import { z } from 'zod';

registerEmailTransport({
  id: 'doctor-spec',
  label: 'Doctor spec relay',
  settingsSchema: z.object({ endpoint: z.string() }),
  defaults: { endpoint: '' },
  secrets: [{ name: 'apiKey', label: 'API key', required: true }],
  summary: (settings) => `Doctor spec relay at ${settings.endpoint as string}`,
  missing: (settings, secrets) => [...(settings.endpoint ? [] : ['relay endpoint']), ...(secrets.apiKey ? [] : ['API key'])],
  build: () => ({ send: async () => ({ success: true }) }),
});

function expectRemedy(outcome: DoctorCheckOutcome): void {
  expect(['warn', 'fail']).toContain(outcome.status);
  expect(outcome.remedy).toEqual(expect.stringMatching(/\S{10,}/));
}

const status = (configured: boolean) => ({
  configured,
  hint: configured ? '••••word' : null,
  updatedAt: null,
  updatedByUserId: null,
});

function view(overrides: Partial<EmailSettingsAdminView> = {}): EmailSettingsAdminView {
  return {
    provider: 'smtp',
    enabled: true,
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpUsername: 'mailer',
    fromAddress: 'no-reply@example.com',
    smtpPasswordStatus: status(true),
    sesSecretAccessKeyStatus: status(false),
    settingsError: null,
    version: 3,
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  } as EmailSettingsAdminView;
}

describe('email.config doctor check', () => {
  it('passes a complete, enabled SMTP configuration', () => {
    const outcome = decideEmailConfig(view());

    expect(outcome).toMatchObject({ status: 'pass', data: { provider: 'smtp' } });
    expect(outcome.detail).toContain('smtp.example.com:587');
  });

  it('never reports the password hint', () => {
    expect(JSON.stringify(decideEmailConfig(view()))).not.toContain('word');
  });

  it('warns when no provider is chosen', () => {
    const outcome = decideEmailConfig(view({ provider: null }));
    expect(outcome.status).toBe('warn');
    expectRemedy(outcome);
  });

  it('warns when configured but switched off', () => {
    const outcome = decideEmailConfig(view({ enabled: false }));
    expect(outcome.status).toBe('warn');
    expectRemedy(outcome);
  });

  it('fails an SMTP username with no stored password', () => {
    const outcome = decideEmailConfig(view({ smtpPasswordStatus: status(false) }));
    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('SMTP password');
    expectRemedy(outcome);
  });

  it('fails SES without a region', () => {
    const outcome = decideEmailConfig(view({ provider: 'ses', sesRegion: undefined }));
    expect(outcome.detail).toContain('SES region');
    expectRemedy(outcome);
  });

  it('fails a stored row that does not validate', () => {
    const outcome = decideEmailConfig(view({ settingsError: 'The stored email configuration is invalid at: smtpPort.' }));
    expect(outcome.status).toBe('fail');
    expectRemedy(outcome);
  });

  describe('a transport an app registered', () => {
    const relay = (overrides: Partial<EmailSettingsAdminView> = {}) =>
      view({
        provider: 'doctor-spec',
        transports: { 'doctor-spec': { endpoint: 'https://relay.example.test' } },
        secretStatuses: { 'doctor-spec': { apiKey: status(true) } },
        ...overrides,
      });

    it('is judged by its own hooks: a complete, enabled configuration passes with its own summary', () => {
      const outcome = decideEmailConfig(relay());

      expect(outcome).toMatchObject({ status: 'pass', data: { provider: 'doctor-spec' } });
      expect(outcome.detail).toBe('Doctor spec relay at https://relay.example.test, from no-reply@example.com');
    });

    it('names what is missing, by the transport own words, after the shared from address', () => {
      const outcome = decideEmailConfig(
        relay({ fromAddress: undefined, transports: { 'doctor-spec': { endpoint: '' } }, secretStatuses: { 'doctor-spec': { apiKey: status(false) } } }),
      );

      expect(outcome.status).toBe('fail');
      expect(outcome.detail).toBe('Email (doctor-spec) is missing: from address, relay endpoint, API key');
      expectRemedy(outcome);
    });

    it('fails a selected transport that is no longer registered, naming the registered ids', () => {
      const outcome = decideEmailConfig(view({ provider: 'gone-plugin' }));

      expect(outcome.status).toBe('fail');
      expect(outcome.detail).toMatch(/"gone-plugin" is selected but not registered \(registered: ses, smtp, doctor-spec\)/);
      expectRemedy(outcome);
    });
  });

  it('reads the admin view (never sends) and registers itself', async () => {
    const describeForAdmin = jest.fn().mockResolvedValue(view());
    const registry = new DoctorCheckRegistry();
    const check = new EmailConfigDoctorCheck(registry, { describeForAdmin } as unknown as EmailSettingsService);
    check.onModuleInit();

    await expect(check.run()).resolves.toMatchObject({ status: 'pass' });
    expect(registry.get('email.config')).toBe(check);
  });
});
