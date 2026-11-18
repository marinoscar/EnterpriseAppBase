// =============================================================================
// Real Postgres: the email settings row through the row store (issue #737)
// =============================================================================
//
// The REAL EmailSettingsService and SystemSettingsRowStore over a migrated
// database: the configuration lands in the `email` row of system_settings
// (never the main row), the version starts at 1 and increments, a stale
// If-Match is a 409 that writes nothing, every save is audited as
// `email_settings:replace` with which secret changed (never its value), and the
// admin view names who saved last.
// A `*.db.spec.ts` file: skipped with a warning when no Postgres is reachable.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { EMAIL_SETTINGS_KEY, EmailSettingsService, type EmailPrisma } from '@marinoscar/platform-api/email';
import type { CredentialsService } from '@marinoscar/platform-api/credentials';
import { SystemSettingsRowStore, type SettingsPrisma } from '@marinoscar/platform-api/settings';

import { resolveDbSuite } from '../jobs/db-test-support';
import { createRlsDatabase, rlsServices, type RlsDatabase } from '../helpers/rls-database.helper';

const { describeWithDb } = resolveDbSuite('email-settings.db.spec');

describeWithDb('email settings on the row store (real Postgres)', () => {
  let db: RlsDatabase;
  let app: ReturnType<typeof rlsServices>;
  let service: EmailSettingsService;
  const adminId = randomUUID();
  const setSecret = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    db = await createRlsDatabase('email');
    app = rlsServices(db);
    await app.prisma.user.create({ data: { id: adminId, email: 'email-admin@example.test', providerDisplayName: 'Email Admin' } });
    const credentials = {
      describe: jest.fn().mockResolvedValue(null),
      setSecret,
      getSecret: jest.fn(() => {
        throw new Error('the settings path must never read a secret');
      }),
    } as unknown as CredentialsService;
    const rows = new SystemSettingsRowStore(app.prisma as unknown as SettingsPrisma);
    service = new EmailSettingsService(rows, app.prisma as unknown as EmailPrisma, credentials);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
  }, 60_000);

  it('reads the defaults at version 0 before anything is stored', async () => {
    const view = await service.describeForAdmin();
    expect(view).toMatchObject({ provider: null, enabled: false, version: 0, updatedBy: null, settingsError: null });
    expect(await service.get()).toEqual({ provider: null, enabled: false });
  });

  it('writes the email row (not the main row), versioned and audited, and names who saved', async () => {
    const first = await service.update(
      { provider: 'smtp', enabled: true, smtpHost: 'smtp.example.test', smtpPort: 587, smtpPassword: 'Correct-Horse-9', fromName: '' },
      adminId,
      0,
    );
    expect(first).toMatchObject({ provider: 'smtp', smtpHost: 'smtp.example.test', version: 1 });
    expect(first.updatedBy).toEqual({ id: adminId, email: 'email-admin@example.test' });
    expect(setSecret).toHaveBeenCalledWith('smtp', 'default', 'Correct-Horse-9', expect.objectContaining({ updatedByUserId: adminId }));

    const row = await app.prisma.systemSettings.findUnique({ where: { key: EMAIL_SETTINGS_KEY } });
    // Stored in the current shape: the flat aliases of the PUT are the SMTP transport's settings.
    expect(row?.value).toEqual({
      provider: 'smtp',
      enabled: true,
      transports: { smtp: { host: 'smtp.example.test', port: 587, useTls: true, username: '' } },
    });
    expect(await app.prisma.systemSettings.findUnique({ where: { key: 'global' } })).toBeNull();

    const second = await service.update({ provider: 'smtp', enabled: false, smtpHost: 'smtp.example.test' }, adminId, 1);
    expect(second.version).toBe(2);

    const audits = await app.prisma.auditEvent.findMany({ where: { action: 'email_settings:replace' }, orderBy: { createdAt: 'asc' } });
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ actorUserId: adminId, targetType: 'system_settings', targetId: row?.id });
    expect(audits[0]!.meta).toMatchObject({ key: 'email', version: 1, smtpPasswordChanged: true, sesSecretAccessKeyChanged: false });
    expect(JSON.stringify(audits)).not.toContain('Correct-Horse-9');
  });

  it('refuses a stale If-Match with a 409 and writes nothing', async () => {
    await expect(service.update({ provider: null, enabled: false }, adminId, 1)).rejects.toMatchObject({ status: 409 });
    const row = await app.prisma.systemSettings.findUnique({ where: { key: EMAIL_SETTINGS_KEY } });
    expect(row?.version).toBe(2);
  });

  it('reports a stored row that no longer validates instead of failing the page, and throws on the send path', async () => {
    await app.prisma.systemSettings.update({ where: { key: EMAIL_SETTINGS_KEY }, data: { value: { provider: 'Carrier Pigeon', enabled: true } } });
    const view = await service.describeForAdmin();
    expect(view.settingsError).toContain('provider');
    expect(view.provider).toBeNull();
    await expect(service.get()).rejects.toThrow(/invalid at: provider/);
  });

  it('reads a row an earlier release stored (flat ses* / smtp* fields) and migrates it on the next save', async () => {
    await app.prisma.systemSettings.update({
      where: { key: EMAIL_SETTINGS_KEY },
      data: {
        value: {
          provider: 'smtp',
          enabled: true,
          fromAddress: 'no-reply@example.test',
          smtpHost: 'legacy.example.test',
          smtpPort: 465,
          smtpUseTls: false,
          smtpUsername: 'mailer',
          sesRegion: 'eu-west-1',
        },
      },
    });

    const view = await service.describeForAdmin();
    expect(view.settingsError).toBeNull();
    expect(view).toMatchObject({ provider: 'smtp', smtpHost: 'legacy.example.test', smtpPort: 465, smtpUseTls: false, smtpUsername: 'mailer', sesRegion: 'eu-west-1' });
    expect(view.transports.smtp).toEqual({ host: 'legacy.example.test', port: 465, useTls: false, username: 'mailer' });

    const row = await app.prisma.systemSettings.findUnique({ where: { key: EMAIL_SETTINGS_KEY } });
    await service.update({ provider: 'smtp', enabled: true, fromAddress: 'no-reply@example.test' }, adminId, row?.version);
    const migrated = await app.prisma.systemSettings.findUnique({ where: { key: EMAIL_SETTINGS_KEY } });
    expect(migrated?.value).toEqual({
      provider: 'smtp',
      enabled: true,
      fromAddress: 'no-reply@example.test',
      transports: {
        smtp: { host: 'legacy.example.test', port: 465, useTls: false, username: 'mailer' },
        ses: { region: 'eu-west-1' },
      },
    });
  });
});
