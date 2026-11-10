// =============================================================================
// Settings write hooks and dismiss-on-disable (issues #1090, #1105)
// =============================================================================
//
// The `notifications` namespaces declare `onWrite`; the settings services run it
// INSIDE the transaction that writes the row, after the row and before commit.
// Unit level, with a recording transaction client: which client each statement
// ran on, and in what order. The real-Postgres proof of atomicity is
// `notification-dismiss-on-disable.db.spec.ts` in test/notifications.
// =============================================================================

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { PLATFORM_PRISMA } from '@marinoscar/platform-api/core';
import { PrincipalCache } from '@marinoscar/platform-api/identity';
import {
  SETTINGS_PROFILE_IMAGES,
  SystemSettingsService,
  UserSettingsService,
} from '@marinoscar/platform-api/settings';

import { PrismaSystemService } from '../../src/prisma/prisma-system.service';
import { AppSettingsProfileImages } from '../../src/platform/settings/settings-profile-images.adapter';
import { DEFAULT_SYSTEM_SETTINGS, DEFAULT_USER_SETTINGS } from '../../src/common/types/settings.types';
import { createMockPrismaService, MockPrismaService } from '../mocks/prisma.mock';
// Side effect: registers the app's notification events (the registry is import-time).
import '../notifications/support/notifications';

const USER = '11111111-1111-4111-8111-111111111111';

/** A transaction client that records the order of the statements run on it. */
function recordingTx(mock: MockPrismaService, log: string[]) {
  return {
    userSettings: {
      update: jest.fn(async (args: unknown) => {
        log.push('tx.userSettings.update');
        return mock.userSettings.update(args as never);
      }),
      upsert: jest.fn(async (args: unknown) => {
        log.push('tx.userSettings.upsert');
        return mock.userSettings.upsert(args as never);
      }),
    },
    systemSettings: {
      update: jest.fn(async (args: unknown) => {
        log.push('tx.systemSettings.update');
        return mock.systemSettings.update(args as never);
      }),
      upsert: jest.fn(async (args: unknown) => {
        log.push('tx.systemSettings.upsert');
        return mock.systemSettings.upsert(args as never);
      }),
    },
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      log.push(`tx.$executeRaw ${strings.join('?').replace(/\s+/g, ' ').trim()} <- ${JSON.stringify(values)}`);
      return 2;
    }),
  };
}

describe('user settings: dismiss-on-disable (issue #1090)', () => {
  let service: UserSettingsService;
  let mockPrisma: MockPrismaService;
  let log: string[];
  let tx: ReturnType<typeof recordingTx>;

  const row = (value: unknown) => ({ id: 's1', userId: USER, value, version: 1, updatedAt: new Date() });

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();
    log = [];
    tx = recordingTx(mockPrisma, log);
    mockPrisma.$transaction.mockImplementation(((fn: (t: unknown) => unknown) => fn(tx)) as never);
    mockPrisma.userSettings.findUnique.mockResolvedValue(row(DEFAULT_USER_SETTINGS) as never);
    mockPrisma.userSettings.update.mockImplementation((async (args: { data: { value: unknown } }) =>
      row(args.data.value)) as never);
    mockPrisma.userSettings.upsert.mockImplementation((async (args: { update: { value: unknown } }) =>
      row(args.update.value)) as never);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserSettingsService,
        { provide: PrincipalCache, useValue: { invalidate: jest.fn() } },
        { provide: PLATFORM_PRISMA, useValue: mockPrisma },
        { provide: PrismaSystemService, useValue: { asSystem: () => mockPrisma } },
        { provide: SETTINGS_PROFILE_IMAGES, useClass: AppSettingsProfileImages },
      ],
    }).compile();
    service = module.get(UserSettingsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('turning an event off dismisses its live rows in the SAME transaction, after the row write', async () => {
    await service.patchSettings(USER, { notifications: { browser: { 'user.welcome': false } } } as never);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(log).toHaveLength(2);
    expect(log[0]).toBe('tx.userSettings.update');
    expect(log[1]).toContain('UPDATE notifications SET dismissed_at = now()');
    expect(log[1]).toContain('updated_at = now()');
    expect(log[1]).toContain(JSON.stringify([USER, ['user.welcome']]));
    // The plain client was never used for the write.
    expect(mockPrisma.userSettings.update).toHaveBeenCalledTimes(1);
  });

  it('a PUT that disables an event takes the same path', async () => {
    await service.replaceSettings(USER, {
      theme: DEFAULT_USER_SETTINGS.theme,
      profile: DEFAULT_USER_SETTINGS.profile,
      notifications: { browser: { 'user.welcome': false } },
    } as never);

    expect(log[0]).toBe('tx.userSettings.upsert');
    expect(log[1]).toContain('UPDATE notifications');
  });

  it('a mandatory event is never dismissed, even with a stored false', async () => {
    await service.patchSettings(USER, { notifications: { browser: { 'security.role_changed': false } } } as never);

    expect(log.filter((l) => l.includes('UPDATE notifications'))).toEqual([]);
  });

  it('a write that leaves the namespace unchanged opens no transaction at all', async () => {
    await service.patchSettings(USER, { theme: 'dark' } as never);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.userSettings.update).toHaveBeenCalledTimes(1);
  });

  it('turning an event back ON dismisses nothing and restores nothing', async () => {
    mockPrisma.userSettings.findUnique.mockResolvedValue(
      row({ ...DEFAULT_USER_SETTINGS, notifications: { browser: { 'user.welcome': false } } }) as never,
    );

    await service.patchSettings(USER, { notifications: { browser: { 'user.welcome': null } } } as never);

    expect(log.filter((l) => l.includes('UPDATE notifications'))).toEqual([]);
  });

  it('a failing hook rejects the write (the transaction callback throws, so Postgres rolls back)', async () => {
    tx.$executeRaw.mockRejectedValueOnce(new Error('dismiss failed'));

    await expect(
      service.patchSettings(USER, { notifications: { browser: { 'user.welcome': false } } } as never),
    ).rejects.toThrow('dismiss failed');
  });
});

describe('system settings: deployment-wide dismiss-on-disable (issue #1090)', () => {
  let service: SystemSettingsService;
  let mockPrisma: MockPrismaService;
  let log: string[];
  let tx: ReturnType<typeof recordingTx>;

  const row = (value: unknown) => ({
    id: 'g1',
    key: 'global',
    value,
    version: 1,
    updatedAt: new Date(),
    updatedByUserId: USER,
    updatedByUser: { id: USER, email: 'admin@example.test' },
  });

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();
    log = [];
    tx = recordingTx(mockPrisma, log);
    mockPrisma.$transaction.mockImplementation(((fn: (t: unknown) => unknown) => fn(tx)) as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue(row(DEFAULT_SYSTEM_SETTINGS) as never);
    mockPrisma.systemSettings.update.mockImplementation((async (args: { data: { value: unknown } }) =>
      row(args.data.value)) as never);
    mockPrisma.auditEvent.create.mockResolvedValue({} as never);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemSettingsService,
        { provide: PLATFORM_PRISMA, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: jest.fn((_k: string, d?: unknown) => d) } },
      ],
    }).compile();
    service = module.get(SystemSettingsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('adding an event to disabledEvents dismisses its live rows for everyone, in the same transaction', async () => {
    await service.patchSettings({ notifications: { disabledEvents: ['user.welcome'] } } as never, USER);

    expect(log[0]).toBe('tx.systemSettings.update');
    expect(log[1]).toContain('UPDATE notifications SET dismissed_at = now()');
    expect(log[1]).not.toContain('user_id =');
    expect(log[1]).toContain(JSON.stringify([['user.welcome']]));
    // The audit event is written after, on the plain client.
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('a mandatory event named in disabledEvents is not dismissed', async () => {
    await service.patchSettings({ notifications: { disabledEvents: ['security.role_changed'] } } as never, USER);

    expect(log.filter((l) => l.includes('UPDATE notifications'))).toEqual([]);
  });

  it('a write that does not touch the notifications namespace opens no transaction', async () => {
    await service.patchSettings({ nodes: { jobSecretBrokerEnabled: true } } as never, USER);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('a failing hook rejects the write and the audit event is never written', async () => {
    tx.$executeRaw.mockRejectedValueOnce(new Error('dismiss failed'));

    await expect(
      service.patchSettings({ notifications: { disabledEvents: ['user.welcome'] } } as never, USER),
    ).rejects.toThrow('dismiss failed');
    expect(mockPrisma.auditEvent.create).not.toHaveBeenCalled();
  });
});
