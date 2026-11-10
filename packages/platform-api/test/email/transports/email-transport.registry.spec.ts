import { z } from 'zod';

import { credentialPurposeRegistry } from '../../../src/credentials/index';
import {
  emailTransportCredentialPurpose,
  emailTransportDefinitions,
  emailTransportIds,
  emailTransportKind,
  emailTransportSecretAddress,
  getEmailTransport,
  labelOfEmailTransport,
  missingEmailTransportFields,
  registerEmailTransport,
  requireEmailTransport,
  type EmailTransportDefinition,
} from '../../../src/email/transports/email-transport';
import '../../../src/email/transports/builtin-email-transports';

const base = (overrides: Partial<EmailTransportDefinition<any>> = {}): EmailTransportDefinition<any> => ({
  id: 'registry-spec',
  label: 'Registry spec',
  settingsSchema: z.object({ host: z.string() }),
  defaults: { host: '' },
  build: () => ({ send: async () => ({ success: true }) }),
  ...overrides,
});

describe('registerEmailTransport', () => {
  it('registers ses and smtp through the same function an app uses, in that order', () => {
    expect(emailTransportIds().slice(0, 2)).toEqual(['ses', 'smtp']);
    expect(emailTransportDefinitions().slice(0, 2).map((d) => d.label)).toEqual(['Amazon SES', 'SMTP']);
  });

  it('keeps the hooks with the registered definition', () => {
    registerEmailTransport(base({ id: 'with-hooks', summary: () => 'hooked', egressCapability: 'Email (Hooked)' }));

    expect(getEmailTransport('with-hooks')?.summary?.({})).toBe('hooked');
    expect(requireEmailTransport('with-hooks').egressCapability).toBe('Email (Hooked)');
    expect(labelOfEmailTransport('with-hooks')).toBe('Registry spec');
  });

  it('labels a built-in before it is registered and an unknown id by itself', () => {
    expect(labelOfEmailTransport('smtp')).toBe('SMTP');
    expect(labelOfEmailTransport('ses')).toBe('Amazon SES');
    expect(labelOfEmailTransport('nobody-here')).toBe('nobody-here');
  });

  it('rejects a duplicate id', () => {
    expect(() => registerEmailTransport(base({ id: 'smtp' }))).toThrow(/Duplicate email-transport implementation "smtp"/);
  });

  it.each(['Upper', 'x', '1abc', 'has space'])('rejects the malformed id %p', (id) => {
    expect(() => registerEmailTransport(base({ id }))).toThrow(/id/i);
  });

  it('rejects a settings field that looks like a secret, pointing at `secrets`', () => {
    for (const field of ['apiKey', 'password', 'token', 'secret', 'secretAccessKey']) {
      expect(() => registerEmailTransport(base({ id: `leaky-${field.toLowerCase().slice(0, 6)}`, settingsSchema: z.object({ [field]: z.string() }), defaults: { [field]: '' } }))).toThrow(
        /looks like a secret.*declare it in `secrets`/s,
      );
    }
  });

  it('allows the SES access key id, which is an identifier', () => {
    expect(emailTransportKind.get('ses').settingsSchema.shape).toHaveProperty('accessKeyId');
  });

  it('rejects defaults that do not parse and a missing build', () => {
    expect(() => registerEmailTransport(base({ id: 'bad-defaults', defaults: { host: 3 } }))).toThrow(/defaults do not parse/);
    expect(() => registerEmailTransport(base({ id: 'no-build', build: undefined as never }))).toThrow(/build must be a function/);
  });

  it('gives a transport with secrets the credential purpose email_<id>, and registers it', () => {
    registerEmailTransport(base({ id: 'with-secret', secrets: [{ name: 'apiKey', label: 'API key', required: true }] }));

    expect(emailTransportCredentialPurpose('with-secret')).toBe('email_with-secret');
    expect(credentialPurposeRegistry.has('email_with-secret')).toBe(true);
    expect(emailTransportSecretAddress(requireEmailTransport('with-secret'), 'apiKey')).toEqual({ purpose: 'email_with-secret', name: 'apiKey', label: 'API key' });
  });

  it('keeps the built-in credential addresses, so a stored SMTP password or SES key keeps working', () => {
    expect(emailTransportSecretAddress(requireEmailTransport('smtp'), 'password')).toEqual({ purpose: 'smtp', name: 'default', label: 'SMTP password' });
    expect(emailTransportSecretAddress(requireEmailTransport('ses'), 'secretAccessKey')).toEqual({
      purpose: 'email_ses',
      name: 'default',
      label: 'SES secret access key',
    });
  });

  describe('missingEmailTransportFields', () => {
    it('defaults to every required secret that is absent, by label', () => {
      const def = base({ id: 'missing-default', secrets: [{ name: 'apiKey', label: 'API key', required: true }, { name: 'extra', label: 'Extra', required: false }] });

      expect(missingEmailTransportFields(def, {}, {})).toEqual(['API key']);
      expect(missingEmailTransportFields(def, {}, { apiKey: true })).toEqual([]);
    });

    it('uses the transport own hook, with the built-in wording', () => {
      expect(missingEmailTransportFields(requireEmailTransport('smtp'), { host: '', username: 'u' }, { password: false })).toEqual(['SMTP host', 'SMTP password']);
      expect(missingEmailTransportFields(requireEmailTransport('ses'), { region: '', accessKeyId: 'AKIA' }, { secretAccessKey: false })).toEqual([
        'SES region',
        'SES secret access key',
      ]);
    });
  });
});
