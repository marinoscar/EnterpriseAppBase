import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';

import { PLATFORM_PRISMA } from '../../src/core/index';
import { CredentialsService } from '../../src/credentials/index';
import { EMAIL_SETTINGS_KEY, EmailSettingsService } from '../../src/email/email-settings.service';
import { SystemSettingsRowStore } from '../../src/settings/index';
import { emailTransportKind, registerEmailTransport } from '../../src/email/transports/email-transport';
// The built-in transports register on import; the service validates against the registry.
import '../../src/email/transports/builtin-email-transports';

// =============================================================================
// The `transports` record and the read-compat for the flat `ses*`/`smtp*` fields (PP-14.8)
// =============================================================================
//
// The `email` row stores `{ provider, enabled, fromAddress, fromName, transports }`.
// A row written by an earlier release stored six flat fields instead: it must
// still load (folded into `transports.ses` / `transports.smtp`), be served in
// the old flat shape on the response, and a PUT in the old shape must still
// work. A transport registered by an app is configured through the same record.
// =============================================================================

registerEmailTransport({
  id: 'spec-relay',
  label: 'Spec relay',
  settingsSchema: z.object({ endpoint: z.string().describe('Relay URL'), retries: z.number().int().min(0).max(5) }),
  defaults: { endpoint: '', retries: 1 },
  secrets: [{ name: 'apiKey', label: 'API key', required: true }],
  build: () => ({ send: async () => ({ success: true }) }),
});

/** A row exactly as an earlier release stored it: flat fields, no `transports`. */
const TODAYS_STORED_ROW = {
  provider: 'smtp',
  enabled: true,
  fromAddress: 'no-reply@example.test',
  fromName: 'Example App',
  sesRegion: 'eu-west-1',
  sesAccessKeyId: 'AKIAEXAMPLEKEYID0001',
  smtpHost: 'smtp.example.test',
  smtpPort: 465,
  smtpUseTls: false,
  smtpUsername: 'mailer',
};

describe('EmailSettingsService: transports', () => {
  let service: EmailSettingsService;
  let prisma: {
    systemSettings: { findUnique: jest.Mock; upsert: jest.Mock };
    auditEvent: { create: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let credentials: { describe: jest.Mock; setSecret: jest.Mock; getSecret: jest.Mock };
  const userId = 'admin-user-id';

  const store = (value: unknown, version = 4) => {
    prisma.systemSettings.findUnique.mockResolvedValue({ value, version, updatedAt: new Date(), updatedByUserId: null, updatedByUser: null });
    prisma.systemSettings.upsert.mockResolvedValue({
      id: 'settings-email',
      key: 'email',
      value: {},
      version: version + 1,
      updatedAt: new Date(),
      updatedByUserId: userId,
      updatedByUser: { id: userId, email: 'admin@example.com' },
    });
  };

  /** The `value` the last write stored. */
  const written = (): Record<string, any> => prisma.systemSettings.upsert.mock.calls[0]![0].update.value;

  beforeEach(async () => {
    prisma = {
      systemSettings: { findUnique: jest.fn(), upsert: jest.fn() },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    credentials = {
      describe: jest.fn().mockResolvedValue(null),
      setSecret: jest.fn().mockResolvedValue(undefined),
      getSecret: jest.fn(() => {
        throw new Error('EmailSettingsService must never read plaintext');
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [EmailSettingsService, SystemSettingsRowStore, { provide: PLATFORM_PRISMA, useValue: prisma }, { provide: CredentialsService, useValue: credentials }],
    }).compile();
    service = module.get(EmailSettingsService);
  });

  describe("reads the row an earlier release stored (fixture of today's shape)", () => {
    it('folds the flat fields into transports.ses and transports.smtp', async () => {
      store(TODAYS_STORED_ROW);

      const settings = await service.get();

      expect(settings.transports).toEqual({
        ses: { region: 'eu-west-1', accessKeyId: 'AKIAEXAMPLEKEYID0001' },
        smtp: { host: 'smtp.example.test', port: 465, useTls: false, username: 'mailer' },
      });
      expect(settings.provider).toBe('smtp');
    });

    it('serves the deprecated flat view unchanged, so an old client reads what it always read', async () => {
      store(TODAYS_STORED_ROW);

      const view = await service.describeForAdmin();

      expect(view).toMatchObject({
        provider: 'smtp',
        enabled: true,
        fromAddress: 'no-reply@example.test',
        fromName: 'Example App',
        sesRegion: 'eu-west-1',
        sesAccessKeyId: 'AKIAEXAMPLEKEYID0001',
        smtpHost: 'smtp.example.test',
        smtpPort: 465,
        smtpUseTls: false,
        smtpUsername: 'mailer',
        settingsError: null,
        version: 4,
      });
    });

    it('describes every registered transport with its defaults filled, built-ins first', async () => {
      store(TODAYS_STORED_ROW);

      const view = await service.describeForAdmin();

      expect(view.descriptors.map((descriptor) => descriptor.id)).toEqual(['ses', 'smtp', 'spec-relay']);
      expect(view.descriptors.map((descriptor) => descriptor.label)).toEqual(['Amazon SES', 'SMTP', 'Spec relay']);
      expect(view.transports['spec-relay']).toEqual({ endpoint: '', retries: 1 });
      expect(view.transports.smtp).toEqual({ host: 'smtp.example.test', port: 465, useTls: false, username: 'mailer' });
    });

    it('does not add flat fields a row never stored (a fresh row serves { provider, enabled } only)', async () => {
      store({ provider: 'ses', enabled: true });

      const view = await service.describeForAdmin();

      expect(view).not.toHaveProperty('smtpPort');
      expect(view).not.toHaveProperty('smtpUseTls');
      expect(view).not.toHaveProperty('sesRegion');
    });

    it('a transports entry wins over the flat alias for the same setting', async () => {
      store({ provider: 'smtp', enabled: true, smtpHost: 'old.example.test', transports: { smtp: { host: 'new.example.test' } } });

      expect((await service.get()).transports?.smtp).toEqual({ host: 'new.example.test' });
    });

    it('reports a stored transport setting its own schema refuses, naming only the path', async () => {
      store({ provider: 'smtp', enabled: true, transports: { smtp: { port: 'not-a-port' } } });

      await expect(service.get()).rejects.toThrow(/transports\.smtp\.port/);
      await expect(service.get()).rejects.not.toThrow(/not-a-port/);
      const view = await service.describeForAdmin();
      expect(view.settingsError).toContain('transports.smtp.port');
      expect(view.provider).toBeNull();
    });

    it('keeps and ignores the settings of a transport that is no longer registered (removing a plugin never bricks the row)', async () => {
      store({ provider: 'ses', enabled: true, transports: { ses: { region: 'us-east-1' }, 'gone-plugin': { anything: true } } });

      const settings = await service.get();
      const view = await service.describeForAdmin();

      expect(settings.provider).toBe('ses');
      expect(view.settingsError).toBeNull();
      expect(view.transports).not.toHaveProperty('gone-plugin');
    });

    it('accepts a selected provider nobody registers (the Doctor and the send report it)', async () => {
      store({ provider: 'gone-plugin', enabled: true });

      await expect(service.get()).resolves.toMatchObject({ provider: 'gone-plugin' });
    });
  });

  describe('PUT in the old flat shape', () => {
    it('stores the flat fields as the built-in transports settings, and never writes a flat field', async () => {
      store(null as never, 0);
      prisma.systemSettings.findUnique.mockResolvedValue(null);

      await service.update(
        { provider: 'smtp', enabled: true, fromAddress: 'no-reply@example.test', smtpHost: 'smtp.example.test', smtpPort: 465, smtpUseTls: false, smtpUsername: 'mailer', sesRegion: 'eu-west-1' },
        userId,
      );

      expect(written()).toEqual({
        provider: 'smtp',
        enabled: true,
        fromAddress: 'no-reply@example.test',
        transports: {
          smtp: { host: 'smtp.example.test', port: 465, useTls: false, username: 'mailer' },
          ses: { region: 'eu-west-1', accessKeyId: '' },
        },
      });
      for (const flat of ['sesRegion', 'sesAccessKeyId', 'smtpHost', 'smtpPort', 'smtpUseTls', 'smtpUsername']) {
        expect(written()).not.toHaveProperty(flat);
      }
    });

    it('migrates an old row on its next save: the flat fields are folded in and dropped', async () => {
      store(TODAYS_STORED_ROW);

      await service.update({ provider: 'smtp', enabled: true, fromAddress: 'no-reply@example.test', smtpHost: 'relay.example.test' }, userId);

      expect(written().transports.smtp).toEqual({ host: 'relay.example.test', port: 465, useTls: false, username: 'mailer' });
      expect(written().transports.ses).toEqual({ region: 'eu-west-1', accessKeyId: 'AKIAEXAMPLEKEYID0001' });
      expect(written()).not.toHaveProperty('smtpHost');
    });

    it('a blank alias resets that setting to the transport default (what clearing a field meant)', async () => {
      store(TODAYS_STORED_ROW);

      await service.update({ provider: 'smtp', enabled: true, smtpHost: '', smtpPort: '', smtpUseTls: null, smtpUsername: '' }, userId);

      expect(written().transports.smtp).toEqual({ host: '', port: 587, useTls: true, username: '' });
    });
  });

  describe('PUT transports', () => {
    it('merges a patch over the stored settings, validated by the transport that owns them', async () => {
      store({ provider: 'spec-relay', enabled: true, transports: { 'spec-relay': { endpoint: 'https://relay.example.test', retries: 2 } } });

      await service.update({ provider: 'spec-relay', enabled: true, transports: { 'spec-relay': { retries: 3 } } }, userId);

      expect(written().transports['spec-relay']).toEqual({ endpoint: 'https://relay.example.test', retries: 3 });
    });

    it('null removes a transport settings (back to its defaults)', async () => {
      store({ provider: 'smtp', enabled: true, transports: { smtp: { host: 'h.example.test', port: 25, useTls: true, username: '' } } });

      await service.update({ provider: 'smtp', enabled: true, transports: { smtp: null } }, userId);

      expect(written().transports).not.toHaveProperty('smtp');
    });

    it('transports.<id> wins over a legacy alias for the same setting', async () => {
      store(null as never, 0);
      prisma.systemSettings.findUnique.mockResolvedValue(null);

      await service.update({ provider: 'smtp', enabled: true, smtpHost: 'alias.example.test', transports: { smtp: { host: 'record.example.test' } } }, userId);

      expect(written().transports.smtp.host).toBe('record.example.test');
    });

    it('answers 400 EMAIL_UNKNOWN_TRANSPORT for a transport nobody registered, and writes nothing', async () => {
      store({ provider: 'smtp', enabled: true });

      const error = await service.update({ provider: 'smtp', enabled: true, transports: { nobody: { a: 1 } } }, userId).catch((e) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({ details: { reason: 'EMAIL_UNKNOWN_TRANSPORT', transport: 'nobody' } });
      expect(prisma.systemSettings.upsert).not.toHaveBeenCalled();
    });

    it('answers 400 EMAIL_UNKNOWN_TRANSPORT for a provider nobody registered', async () => {
      store({ provider: 'smtp', enabled: true });

      const error = await service.update({ provider: 'nobody', enabled: true }, userId).catch((e) => e);

      expect((error as BadRequestException).getResponse()).toMatchObject({ details: { reason: 'EMAIL_UNKNOWN_TRANSPORT' } });
      expect(prisma.systemSettings.upsert).not.toHaveBeenCalled();
    });

    it('answers 400 EMAIL_TRANSPORT_SETTINGS_INVALID naming the fields, and writes nothing', async () => {
      store({ provider: 'smtp', enabled: true });

      const error = await service.update({ provider: 'spec-relay', enabled: true, transports: { 'spec-relay': { retries: 99 } } }, userId).catch((e) => e);

      expect((error as BadRequestException).getResponse()).toMatchObject({
        details: { reason: 'EMAIL_TRANSPORT_SETTINGS_INVALID', transport: 'spec-relay', fields: ['retries'] },
      });
      expect(prisma.systemSettings.upsert).not.toHaveBeenCalled();
    });

    it('keeps the stored settings of an unregistered transport when saving', async () => {
      store({ provider: 'ses', enabled: true, transports: { 'gone-plugin': { keep: 'me' } } });

      await service.update({ provider: 'ses', enabled: true }, userId);

      expect(written().transports['gone-plugin']).toEqual({ keep: 'me' });
    });
  });

  describe('PUT secrets', () => {
    it("stores a registered transport's secret at (email_<id>, <name>), write-only, with the secret's label", async () => {
      store({ provider: 'spec-relay', enabled: true });

      const view = await service.update({ provider: 'spec-relay', enabled: true, secrets: { 'spec-relay': { apiKey: 'relay-key-Zq81-do-not-leak' } } }, userId);

      expect(credentials.setSecret).toHaveBeenCalledWith('email_spec-relay', 'apiKey', 'relay-key-Zq81-do-not-leak', { label: 'API key', updatedByUserId: userId });
      expect(JSON.stringify(view)).not.toContain('relay-key-Zq81-do-not-leak');
      expect(JSON.stringify(prisma.auditEvent.create.mock.calls)).not.toContain('relay-key-Zq81-do-not-leak');
      expect(prisma.auditEvent.create.mock.calls[0]![0].data.meta.secretsChanged).toEqual(['spec-relay.apiKey']);
    });

    it('a blank secret preserves the stored one: setSecret is not called', async () => {
      store({ provider: 'spec-relay', enabled: true });

      await service.update({ provider: 'spec-relay', enabled: true, secrets: { 'spec-relay': { apiKey: '' } } }, userId);
      await service.update({ provider: 'spec-relay', enabled: true, secrets: { 'spec-relay': { apiKey: null } } }, userId);

      expect(credentials.setSecret).not.toHaveBeenCalled();
    });

    it('the built-in secrets keep their credential addresses, via secrets.<id> as well as the legacy aliases', async () => {
      store({ provider: 'ses', enabled: true });

      await service.update({ provider: 'ses', enabled: true, secrets: { smtp: { password: 'pw-from-secrets-record' }, ses: { secretAccessKey: 'ses-from-secrets-record' } } }, userId);

      expect(credentials.setSecret).toHaveBeenCalledWith('smtp', 'default', 'pw-from-secrets-record', expect.objectContaining({ updatedByUserId: userId }));
      expect(credentials.setSecret).toHaveBeenCalledWith('email_ses', 'default', 'ses-from-secrets-record', expect.objectContaining({ updatedByUserId: userId }));
    });

    it('answers 400 EMAIL_UNKNOWN_SECRET for a secret the transport never declared, before anything is written', async () => {
      store({ provider: 'spec-relay', enabled: true });

      const error = await service.update({ provider: 'spec-relay', enabled: true, secrets: { 'spec-relay': { typo: 'value' } } }, userId).catch((e) => e);

      expect((error as BadRequestException).getResponse()).toMatchObject({ details: { reason: 'EMAIL_UNKNOWN_SECRET', transport: 'spec-relay', secret: 'typo' } });
      expect(credentials.setSecret).not.toHaveBeenCalled();
      expect(prisma.systemSettings.upsert).not.toHaveBeenCalled();
    });

    it('validates the settings before it writes any secret', async () => {
      store({ provider: 'spec-relay', enabled: true });

      await service
        .update({ provider: 'spec-relay', enabled: true, transports: { 'spec-relay': { retries: 99 } }, secrets: { 'spec-relay': { apiKey: 'a-fine-key-value' } } }, userId)
        .catch(() => undefined);

      expect(credentials.setSecret).not.toHaveBeenCalled();
    });

    it('describes every declared secret as a masked status and a presence flag, never a value', async () => {
      store({ provider: 'spec-relay', enabled: true });
      credentials.describe.mockImplementation(async (purpose: string, name: string) =>
        purpose === 'email_spec-relay' && name === 'apiKey'
          ? { hint: '••••abcd', updatedAt: new Date('2026-01-01T00:00:00.000Z'), updatedByUserId: userId }
          : null,
      );

      const view = await service.describeForAdmin();

      expect(view.secretStatuses['spec-relay']!.apiKey).toMatchObject({ configured: true, hint: '••••abcd' });
      expect(view.secretStatuses.smtp!.password!.configured).toBe(false);
      expect(view.smtpPasswordStatus.configured).toBe(false);
      const relay = view.descriptors.find((descriptor) => descriptor.id === 'spec-relay');
      expect(relay?.fields.find((field) => field.name === 'apiKey')).toMatchObject({ kind: 'secret', hasValue: true, required: true });
      expect(JSON.stringify(view)).not.toMatch(/"(value|ciphertext|secretValue)"/);
    });
  });

  it('the registry holds the built-ins and the spec transport, in registration order', () => {
    expect(emailTransportKind.ids()).toEqual(['ses', 'smtp', 'spec-relay']);
    expect(EMAIL_SETTINGS_KEY).toBe('email');
  });
});
