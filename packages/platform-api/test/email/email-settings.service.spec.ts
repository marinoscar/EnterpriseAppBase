import { Test, TestingModule } from '@nestjs/testing';

import { EMAIL_SETTINGS_KEY, EmailSettingsService } from '../../src/email/email-settings.service';
import {
  DEFAULT_EMAIL_SETTINGS,
  EMAIL_SETTINGS_CARRIES_NO_SECRET,
  emailSettingsSchema,
} from '../../src/email/email-settings.schema';
import { PLATFORM_PRISMA } from '../../src/core/index';
import { CredentialsService } from '../../src/credentials/index';
import { SystemSettingsRowStore } from '../../src/settings/index';
// The built-in transports register on import; the service validates against the registry.
import '../../src/email/transports/builtin-email-transports';

/**
 * The tables the email settings path reaches through the row store and the
 * service (#737): the `email` row, the audit trail and `updatedBy`'s address.
 */
function createMockPrismaService() {
  return {
    systemSettings: { findUnique: jest.fn(), upsert: jest.fn() },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
  };
}
type MockPrismaService = ReturnType<typeof createMockPrismaService>;

// =============================================================================
// EmailSettingsService — tests (issue #122, epic #109)
// =============================================================================
//
// Two things this service exists to guarantee, both asserted below:
//
//   1. Email configuration lives in its OWN system_settings row (key
//      'email'), never inside the 'global' row the rest of the settings UI
//      writes to — see the file-header comment in email-settings.service.ts
//      for why sharing the row would let an unrelated save silently wipe it.
//   2. A stored-but-invalid row throws rather than silently falling back to
//      defaults, and the thrown message names only the failing field PATHS,
//      never the invalid values themselves.
// =============================================================================

describe('EmailSettingsService', () => {
  let service: EmailSettingsService;
  let mockPrisma: MockPrismaService;
  let mockCredentials: {
    describe: jest.Mock;
    setSecret: jest.Mock;
    getSecret: jest.Mock;
  };

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();
    mockCredentials = {
      describe: jest.fn().mockResolvedValue(null),
      setSecret: jest.fn().mockResolvedValue(undefined),
      // NEVER legitimate on a settings path: `getSecret` is the only method
      // that returns plaintext. Throwing makes an accidental call a failed
      // test rather than a silent widening of where the password can travel.
      getSecret: jest.fn(() => {
        throw new Error('EmailSettingsService must never read the SMTP plaintext');
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailSettingsService,
        // The `email` row goes through the settings slice's row store (#737),
        // here the real one over the mocked tables.
        SystemSettingsRowStore,
        { provide: PLATFORM_PRISMA, useValue: mockPrisma },
        // #124 gave the service its write path, which routes the SMTP password
        // to the credential store. `get` -- everything this suite exercises --
        // never touches it, so a stub that fails loudly if it ever is called
        // keeps that separation asserted rather than assumed.
        { provide: CredentialsService, useValue: mockCredentials },
      ],
    }).compile();

    service = module.get<EmailSettingsService>(EmailSettingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // Reads its own row, keyed 'email', not 'global'
  // ==========================================================================

  describe('reads its own row', () => {
    it('reads system_settings by the "email" key, through the row store (#737)', async () => {
      mockPrisma.systemSettings.findUnique.mockResolvedValue(null);

      await service.get();

      expect(mockPrisma.systemSettings.findUnique).toHaveBeenCalledWith({
        where: { key: EMAIL_SETTINGS_KEY },
      });
    });

    it('the key is "email", never "global" (the key SystemSettingsService writes to)', () => {
      expect(EMAIL_SETTINGS_KEY).toBe('email');
      expect(EMAIL_SETTINGS_KEY).not.toBe('global');
    });
  });

  // ==========================================================================
  // Absent row → default settings, not an error
  // ==========================================================================

  describe('when no row exists', () => {
    it('returns DEFAULT_EMAIL_SETTINGS rather than throwing', async () => {
      mockPrisma.systemSettings.findUnique.mockResolvedValue(null);

      await expect(service.get()).resolves.toEqual(DEFAULT_EMAIL_SETTINGS);
    });
  });

  // ==========================================================================
  // Valid row → validated settings
  // ==========================================================================

  describe('when a valid row exists', () => {
    it('returns the parsed settings', async () => {
      const value = { provider: 'ses', enabled: true, sesRegion: 'us-east-1' };
      mockPrisma.systemSettings.findUnique.mockResolvedValue({ value } as any);

      // The flat `sesRegion` is read into `transports.ses` (and still served as the deprecated view).
      await expect(service.get()).resolves.toEqual({ ...value, transports: { ses: { region: 'us-east-1' } } });
    });

    it('strips unknown keys via Zod parsing rather than passing them through', async () => {
      const value = {
        provider: 'smtp',
        enabled: false,
        smtpHost: 'smtp.example.com',
        somethingUnexpected: 'should not survive parsing',
      };
      mockPrisma.systemSettings.findUnique.mockResolvedValue({ value } as any);

      const result = await service.get();

      expect(result).not.toHaveProperty('somethingUnexpected');
    });
  });

  // ==========================================================================
  // Invalid row → throws, naming field paths, never values
  // ==========================================================================

  describe('when a stored row fails validation', () => {
    it('throws rather than silently falling back to defaults', async () => {
      mockPrisma.systemSettings.findUnique.mockResolvedValue({
        value: { provider: 'Not A Provider', enabled: true }, // not a well-formed transport id
      } as any);

      await expect(service.get()).rejects.toThrow();
    });

    it('names the failing field path in the thrown message', async () => {
      mockPrisma.systemSettings.findUnique.mockResolvedValue({
        value: { provider: 'Not A Provider', enabled: true },
      } as any);

      await expect(service.get()).rejects.toThrow(/provider/);
    });

    it('never includes the invalid stored value in the thrown error message', async () => {
      const suspiciousValue = 'Not A Real Provider But Suspicious Value XYZ';
      mockPrisma.systemSettings.findUnique.mockResolvedValue({
        value: { provider: suspiciousValue, enabled: true },
      } as any);

      let thrown: unknown;
      try {
        await service.get();
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      expect(message).not.toContain(suspiciousValue);
      expect(message).toContain('provider');
    });

    it('names every failing field path when several fields are invalid', async () => {
      mockPrisma.systemSettings.findUnique.mockResolvedValue({
        value: {
          provider: 'smtp',
          enabled: true,
          smtpPort: 99999, // out of range (max 65535)
          fromAddress: 'not-an-email',
        },
      } as any);

      let thrown: unknown;
      try {
        await service.get();
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      expect(message).toContain('fromAddress');
      // The flat port is read as the SMTP transport's `port`, which that transport's own schema refuses.
      expect(message).toContain('transports.smtp.port');
    });

    it('the thrown error tells the admin to re-save the configuration, without echoing the bad value', async () => {
      mockPrisma.systemSettings.findUnique.mockResolvedValue({
        value: { provider: true, enabled: 'not-a-boolean' },
      } as any);

      await expect(service.get()).rejects.toThrow(/re-save/i);
    });
  });

  // ==========================================================================
  // EMAIL_SETTINGS_CARRIES_NO_SECRET — compile-time proof
  // ==========================================================================

  // ==========================================================================
  // describeForAdmin (#124) — the GET /api/email-settings body
  // ==========================================================================

  describe('describeForAdmin', () => {
    it('reports smtpPasswordStatus.configured: true when a password is stored', async () => {
      mockPrisma.systemSettings.findUnique.mockResolvedValue({
        version: 1,
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedByUser: null,
        value: { provider: 'smtp', enabled: true, smtpHost: 'smtp.example.com' },
      } as any);
      mockCredentials.describe.mockResolvedValue({
        purpose: 'smtp',
        name: 'default',
        hint: '••••x9fQ',
        label: 'SMTP password',
        updatedByUserId: 'user-1',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      });

      const view = await service.describeForAdmin();

      expect(view.smtpPasswordStatus).toEqual({
        configured: true,
        hint: '••••x9fQ',
        updatedAt: new Date('2024-01-02T00:00:00.000Z'),
        updatedByUserId: 'user-1',
      });
    });

    it('reports smtpPasswordStatus.configured: false when nothing is stored', async () => {
      mockPrisma.systemSettings.findUnique.mockResolvedValue(null);
      mockCredentials.describe.mockResolvedValue(null);

      const view = await service.describeForAdmin();

      expect(view.smtpPasswordStatus).toEqual({
        configured: false,
        hint: null,
        updatedAt: null,
        updatedByUserId: null,
      });
    });

    it('degrades on a stored-but-invalid row: does NOT throw, returns defaults plus settingsError', async () => {
      mockPrisma.systemSettings.findUnique.mockResolvedValue({
        version: 4,
        updatedAt: new Date(),
        updatedByUser: null,
        value: { provider: 'Not A Real Provider', enabled: true },
      } as any);
      mockCredentials.describe.mockResolvedValue(null);

      // The send path (`get`) throws on the identical row — see the suite
      // above. This is the REPAIR path and a 500 here would take down the one
      // screen that can fix the row, so it must resolve, not reject.
      const view = await service.describeForAdmin();

      expect(view.provider).toBe(DEFAULT_EMAIL_SETTINGS.provider);
      expect(view.enabled).toBe(DEFAULT_EMAIL_SETTINGS.enabled);
      expect(view.settingsError).toEqual(expect.stringContaining('provider'));
      // Still carries the row's real provenance — the admin needs to know
      // WHICH row is broken, and re-saving still targets it via `version`.
      expect(view.version).toBe(4);
    });

    it('settingsError is null on the normal (valid-row) path', async () => {
      mockPrisma.systemSettings.findUnique.mockResolvedValue({
        version: 2,
        updatedAt: new Date(),
        updatedByUser: null,
        value: { provider: 'ses', enabled: true, sesRegion: 'us-east-1' },
      } as any);
      mockCredentials.describe.mockResolvedValue(null);

      const view = await service.describeForAdmin();

      expect(view.settingsError).toBeNull();
    });

    it('reports sesSecretAccessKeyStatus.configured: true when a secret is stored', async () => {
      mockPrisma.systemSettings.findUnique.mockResolvedValue({
        version: 1,
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedByUser: null,
        value: { provider: 'ses', enabled: true, sesRegion: 'us-east-1' },
      } as any);
      mockCredentials.describe.mockImplementation((purpose: string) =>
        Promise.resolve(
          purpose === 'email_ses'
            ? {
                purpose: 'email_ses',
                name: 'default',
                hint: '••••x9fQ',
                label: 'SES secret access key',
                updatedByUserId: 'user-1',
                createdAt: new Date('2024-01-01T00:00:00.000Z'),
                updatedAt: new Date('2024-01-02T00:00:00.000Z'),
              }
            : null,
        ),
      );

      const view = await service.describeForAdmin();

      expect(view.sesSecretAccessKeyStatus).toEqual({
        configured: true,
        hint: '••••x9fQ',
        updatedAt: new Date('2024-01-02T00:00:00.000Z'),
        updatedByUserId: 'user-1',
      });
      expect(mockCredentials.describe).toHaveBeenCalledWith('email_ses', 'default');
    });

    it('reports sesSecretAccessKeyStatus.configured: false when nothing is stored', async () => {
      mockPrisma.systemSettings.findUnique.mockResolvedValue(null);
      mockCredentials.describe.mockResolvedValue(null);

      const view = await service.describeForAdmin();

      expect(view.sesSecretAccessKeyStatus).toEqual({
        configured: false,
        hint: null,
        updatedAt: null,
        updatedByUserId: null,
      });
    });

    it('the SMTP password and the SES secret access key are reported independently', async () => {
      mockPrisma.systemSettings.findUnique.mockResolvedValue({
        version: 1,
        updatedAt: new Date(),
        updatedByUser: null,
        value: { provider: 'smtp', enabled: true, smtpHost: 'smtp.example.com' },
      } as any);
      mockCredentials.describe.mockImplementation((purpose: string) =>
        Promise.resolve(
          purpose === 'smtp'
            ? {
                purpose: 'smtp',
                name: 'default',
                hint: '••••ab12',
                label: 'SMTP password',
                updatedByUserId: 'user-1',
                createdAt: new Date(),
                updatedAt: new Date(),
              }
            : null,
        ),
      );

      const view = await service.describeForAdmin();

      expect(view.smtpPasswordStatus.configured).toBe(true);
      expect(view.sesSecretAccessKeyStatus.configured).toBe(false);
    });

    it('never leaks the SMTP password: JSON.stringify of the admin view never contains a known plaintext', async () => {
      const suspiciousPlaintext = 'do-not-leak-this-smtp-password-Xk9!q2';
      mockPrisma.systemSettings.findUnique.mockResolvedValue({
        version: 1,
        updatedAt: new Date(),
        updatedByUser: { id: 'user-1', email: 'admin@example.com' },
        value: { provider: 'smtp', enabled: true, smtpHost: 'smtp.example.com' },
      } as any);
      // `describe` is the masked read; it MUST NOT be capable of returning
      // the plaintext at all (CredentialInfo has no such field), but the
      // assertion below does not rely on that being true by construction —
      // it greps the entire serialised response for the value, so a leak
      // arriving under any key, present or future, is caught.
      mockCredentials.describe.mockResolvedValue({
        purpose: 'smtp',
        name: 'default',
        hint: '••••2!q2',
        label: 'SMTP password',
        updatedByUserId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const view = await service.describeForAdmin();

      expect(JSON.stringify(view)).not.toContain(suspiciousPlaintext);
      // getSecret (the plaintext read) must never be called by this path.
      expect(mockCredentials.getSecret).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // update (#124) — the PUT /api/email-settings write path
  // ==========================================================================

  describe('update', () => {
    const userId = 'admin-user-id';

    function existingRow(version = 0) {
      mockPrisma.systemSettings.findUnique.mockResolvedValue(
        version === 0 ? null : ({ version } as any),
      );
      mockPrisma.systemSettings.upsert.mockResolvedValue({
        id: 'settings-email',
        key: 'email',
        value: {},
        version: version + 1,
        updatedAt: new Date(),
        updatedByUserId: userId,
        updatedByUser: { id: userId, email: 'admin@example.com' },
      } as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);
    }

    it('blank password ("") preserves the stored credential: setSecret is not called', async () => {
      existingRow(1);

      await service.update(
        { provider: 'smtp', enabled: true, smtpHost: 'smtp.example.com', smtpPassword: '' },
        userId,
      );

      expect(mockCredentials.setSecret).not.toHaveBeenCalled();
    });

    it('blank password (null) preserves the stored credential: setSecret is not called', async () => {
      existingRow(1);

      await service.update(
        { provider: 'smtp', enabled: true, smtpHost: 'smtp.example.com', smtpPassword: null },
        userId,
      );

      expect(mockCredentials.setSecret).not.toHaveBeenCalled();
    });

    it('blank password (key absent) preserves the stored credential: setSecret is not called', async () => {
      existingRow(1);

      await service.update(
        { provider: 'smtp', enabled: true, smtpHost: 'smtp.example.com' },
        userId,
      );

      expect(mockCredentials.setSecret).not.toHaveBeenCalled();
    });

    it('a non-blank password replaces the stored credential: setSecret is called with the exact value', async () => {
      existingRow(1);

      await service.update(
        {
          provider: 'smtp',
          enabled: true,
          smtpHost: 'smtp.example.com',
          smtpPassword: 'new-plaintext-password',
        },
        userId,
      );

      expect(mockCredentials.setSecret).toHaveBeenCalledTimes(1);
      expect(mockCredentials.setSecret).toHaveBeenCalledWith(
        'smtp',
        'default',
        'new-plaintext-password',
        expect.objectContaining({ updatedByUserId: userId }),
      );
    });

    it('never leaks the submitted SMTP password: JSON.stringify of the returned view never contains it', async () => {
      existingRow(1);
      const submittedPlaintext = 'submitted-plaintext-Xk9!q2-do-not-leak';

      const view = await service.update(
        {
          provider: 'smtp',
          enabled: true,
          smtpHost: 'smtp.example.com',
          smtpPassword: submittedPlaintext,
        },
        userId,
      );

      expect(JSON.stringify(view)).not.toContain(submittedPlaintext);
    });

    it('blank SES secret access key ("") preserves the stored credential: setSecret is not called for it', async () => {
      existingRow(1);

      await service.update(
        {
          provider: 'ses',
          enabled: true,
          sesRegion: 'us-east-1',
          sesAccessKeyId: 'AKIAEXAMPLE',
          sesSecretAccessKey: '',
        },
        userId,
      );

      expect(mockCredentials.setSecret).not.toHaveBeenCalled();
    });

    it('blank SES secret access key (null) preserves the stored credential: setSecret is not called for it', async () => {
      existingRow(1);

      await service.update(
        {
          provider: 'ses',
          enabled: true,
          sesRegion: 'us-east-1',
          sesAccessKeyId: 'AKIAEXAMPLE',
          sesSecretAccessKey: null,
        },
        userId,
      );

      expect(mockCredentials.setSecret).not.toHaveBeenCalled();
    });

    it('blank SES secret access key (key absent) preserves the stored credential: setSecret is not called for it', async () => {
      existingRow(1);

      await service.update(
        {
          provider: 'ses',
          enabled: true,
          sesRegion: 'us-east-1',
          sesAccessKeyId: 'AKIAEXAMPLE',
        },
        userId,
      );

      expect(mockCredentials.setSecret).not.toHaveBeenCalled();
    });

    it('a non-blank SES secret access key replaces the stored credential: setSecret is called with the exact value', async () => {
      existingRow(1);

      await service.update(
        {
          provider: 'ses',
          enabled: true,
          sesRegion: 'us-east-1',
          sesAccessKeyId: 'AKIAEXAMPLE',
          sesSecretAccessKey: 'new-plaintext-secret-access-key',
        },
        userId,
      );

      expect(mockCredentials.setSecret).toHaveBeenCalledTimes(1);
      expect(mockCredentials.setSecret).toHaveBeenCalledWith(
        'email_ses',
        'default',
        'new-plaintext-secret-access-key',
        expect.objectContaining({ updatedByUserId: userId }),
      );
    });

    it('both secrets can be set independently in the same submission', async () => {
      existingRow(1);

      await service.update(
        {
          provider: 'smtp',
          enabled: true,
          smtpHost: 'smtp.example.com',
          smtpPassword: 'new-smtp-password',
          sesAccessKeyId: 'AKIAEXAMPLE',
          sesSecretAccessKey: 'new-ses-secret',
        },
        userId,
      );

      expect(mockCredentials.setSecret).toHaveBeenCalledTimes(2);
      expect(mockCredentials.setSecret).toHaveBeenCalledWith(
        'smtp',
        'default',
        'new-smtp-password',
        expect.objectContaining({ updatedByUserId: userId }),
      );
      expect(mockCredentials.setSecret).toHaveBeenCalledWith(
        'email_ses',
        'default',
        'new-ses-secret',
        expect.objectContaining({ updatedByUserId: userId }),
      );
    });

    it('never leaks the submitted SES secret access key: JSON.stringify of the returned view never contains it', async () => {
      existingRow(1);
      const submittedPlaintext = 'submitted-ses-secret-Xk9!q2-do-not-leak';

      const view = await service.update(
        {
          provider: 'ses',
          enabled: true,
          sesRegion: 'us-east-1',
          sesAccessKeyId: 'AKIAEXAMPLE',
          sesSecretAccessKey: submittedPlaintext,
        },
        userId,
      );

      expect(JSON.stringify(view)).not.toContain(submittedPlaintext);
    });

    it('writes the row through the row store, audited as email_settings:replace with which secrets changed, never their value (#737)', async () => {
      existingRow(2);

      await service.update(
        { provider: 'smtp', enabled: true, smtpHost: 'smtp.example.com', smtpPassword: 'Correct-Horse-9' },
        userId,
        2,
      );

      expect(mockPrisma.systemSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: EMAIL_SETTINGS_KEY },
          update: expect.objectContaining({ updatedByUserId: userId, version: { increment: 1 } }),
        }),
      );
      const audit = mockPrisma.auditEvent.create.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(audit.data).toMatchObject({
        actorUserId: userId,
        action: 'email_settings:replace',
        targetType: 'system_settings',
        targetId: 'settings-email',
        meta: {
          key: 'email',
          version: 3,
          // The legacy `smtpHost` alias is stored as the SMTP transport's `host`.
          newValue: {
            provider: 'smtp',
            enabled: true,
            transports: { smtp: { host: 'smtp.example.com', port: 587, useTls: true, username: '' } },
          },
          smtpPasswordChanged: true,
          sesSecretAccessKeyChanged: false,
          secretsChanged: ['smtp.password'],
        },
      });
      expect(JSON.stringify(audit)).not.toContain('Correct-Horse-9');
    });

    it('reports who saved last as { id, email }, looked up by id (#737)', async () => {
      existingRow(1);
      mockPrisma.user.findUnique.mockResolvedValue({ id: userId, email: 'admin@example.com' });

      const view = await service.update({ provider: null, enabled: false }, userId);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: userId }, select: { id: true, email: true } });
      expect(view.updatedBy).toEqual({ id: userId, email: 'admin@example.com' });
      expect(view.version).toBe(2);
    });

    it('a version mismatch (If-Match) throws rather than silently overwriting', async () => {
      existingRow(3);

      await expect(
        service.update(
          { provider: 'smtp', enabled: true, smtpHost: 'smtp.example.com' },
          userId,
          1, // expected 1, current is 3
        ),
      ).rejects.toThrow(/version mismatch/i);

      expect(mockCredentials.setSecret).not.toHaveBeenCalled();
    });
  });

  describe('EMAIL_SETTINGS_CARRIES_NO_SECRET', () => {
    it('is true at runtime; the actual guarantee is enforced by `tsc`, not by this assertion', () => {
      // EMAIL_SETTINGS_CARRIES_NO_SECRET is a COMPILE-TIME proof, not a
      // runtime check. `EmailSettingsCarriesNoSecret` (see
      // email-settings.schema.ts) resolves to the type `never` the instant
      // any of the banned field names (smtpPassword, password, secret,
      // apiKey, accessKeyId, secretAccessKey) is added to
      // `emailSettingsSchema`, and assigning a `never`-typed value to a
      // `true`-typed constant fails to compile — `npx tsc --noEmit` breaks
      // the build at the moment of the mistake, for this file and everything
      // that imports it.
      //
      // Jest cannot exercise a type error: there is no runtime code path
      // where the schema "has" a banned field to assert against, because a
      // schema that did would never reach this test — it would already have
      // failed `tsc --noEmit`. This assertion only pins the runtime value
      // (`true`) so the constant cannot be silently deleted or its
      // right-hand side changed without a test noticing; the real guarantee
      // is verified separately, by running `npx tsc --noEmit` as part of
      // this task's typecheck step.
      expect(EMAIL_SETTINGS_CARRIES_NO_SECRET).toBe(true);
    });

    it('as far as a runtime check can go: the schema keys contain none of the known secret field names', () => {
      const secretFieldNames = [
        'smtpPassword',
        'password',
        'secret',
        'apiKey',
        'accessKeyId',
        'secretAccessKey',
      ];
      const schemaKeys = Object.keys(emailSettingsSchema.shape);

      for (const name of secretFieldNames) {
        expect(schemaKeys).not.toContain(name);
      }
    });
  });
});
