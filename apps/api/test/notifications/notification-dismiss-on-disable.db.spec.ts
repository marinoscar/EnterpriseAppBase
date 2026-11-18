// =============================================================================
// Real-Postgres test: dismiss-on-disable is atomic with the settings write
// (issues #1090, #1105)
// =============================================================================
//
// A mocked client cannot prove that the settings row and the dismissal share ONE
// transaction. Here the real `UserSettingsService` and `SystemSettingsService`
// write a migrated database, and a failure injected AFTER the dismissal ran
// shows that the settings write is rolled back with it (and the other way
// round: a committed write carries its dismissal).
//
// THIS IS A `*.db.spec.ts` FILE — skipped with a warning when no Postgres is
// reachable; see `test/jobs/db-test-support.ts`.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';

import { PLATFORM_PRISMA } from '@marinoscar/platform-api/core';
import { PrincipalCache } from '@marinoscar/platform-api/identity';
import { SETTINGS_PROFILE_IMAGES, SystemSettingsService, UserSettingsService } from '@marinoscar/platform-api/settings';

import { AppSettingsProfileImages } from '../../src/platform/settings/settings-profile-images.adapter';
import { PrismaSystemService } from '../../src/prisma/prisma-system.service';
import { createDbClient, resolveDbSuite } from '../jobs/db-test-support';
// Side effect: fills the settings namespace registries with the app's manifest.
import '../../src/settings/registry/composed';
// Side effect: registers the app's notification events (the registry is import-time).
import { NotificationStoreService } from './support/notifications';

const { describeWithDb } = resolveDbSuite('notification-dismiss-on-disable.db.spec');

const WELCOME = 'user.welcome';
const MANDATORY = 'security.role_changed';

describeWithDb('dismiss-on-disable (real Postgres)', () => {
  let client: PrismaClient;
  let failAfterDismissal = false;
  let userSettings: UserSettingsService;
  let systemSettings: SystemSettingsService;
  let userId: string;
  let otherUserId: string;
  let hadGlobalRow = false;

  /**
   * The client the services get: the real one, except that while
   * `failAfterDismissal` is set the transaction's `$executeRaw` runs the real
   * statement and THEN throws, as a hook failing late would.
   */
  const faultyClient = new Proxy({} as PrismaClient, {
    get(_target, prop) {
      if (prop === '$transaction') {
        return (fn: (tx: unknown) => Promise<unknown>) =>
          client.$transaction(async (tx) => {
            const wrapped = new Proxy(tx, {
              get(inner, key) {
                if (key === '$executeRaw') {
                  return async (...args: unknown[]) => {
                    const touched = await (inner as never as { $executeRaw: (...a: unknown[]) => Promise<number> }).$executeRaw(...args);
                    if (failAfterDismissal) throw new Error('hook failed after the dismissal ran');
                    return touched;
                  };
                }
                const value = Reflect.get(inner, key);
                return typeof value === 'function' ? value.bind(inner) : value;
              },
            });
            return fn(wrapped);
          });
      }
      const value = Reflect.get(client, prop);
      return typeof value === 'function' ? value.bind(client) : value;
    },
  });

  const live = (id: string, eventKey: string) =>
    client.notification.count({ where: { userId: id, eventKey, dismissedAt: null } });
  const dismissed = (id: string, eventKey: string) =>
    client.notification.count({ where: { userId: id, eventKey, dismissedAt: { not: null } } });

  async function seedRows() {
    await client.notification.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    for (const id of [userId, otherUserId]) {
      for (const eventKey of [WELCOME, MANDATORY, 'spec1090.other']) {
        await client.notification.create({ data: { userId: id, eventKey, title: 't', body: 'b' } });
      }
    }
  }

  beforeAll(async () => {
    client = createDbClient();
    const module = await Test.createTestingModule({
      providers: [
        UserSettingsService,
        SystemSettingsService,
        { provide: PrincipalCache, useValue: { invalidate: jest.fn() } },
        { provide: PLATFORM_PRISMA, useValue: faultyClient },
        { provide: PrismaSystemService, useValue: { asSystem: () => client } },
        { provide: SETTINGS_PROFILE_IMAGES, useClass: AppSettingsProfileImages },
        { provide: ConfigService, useValue: { get: (_key: string, fallback?: unknown) => fallback } },
      ],
    }).compile();
    userSettings = module.get(UserSettingsService);
    systemSettings = module.get(SystemSettingsService);

    userId = (await client.user.create({ data: { email: `dod-${randomUUID().slice(0, 8)}@example.test` }, select: { id: true } })).id;
    otherUserId = (await client.user.create({ data: { email: `dod-${randomUUID().slice(0, 8)}@example.test` }, select: { id: true } })).id;
    hadGlobalRow = (await client.systemSettings.count({ where: { key: 'global' } })) > 0;
  });

  afterAll(async () => {
    await client.notification.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await client.userSettings.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await client.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    if (!hadGlobalRow) await client.systemSettings.deleteMany({ where: { key: 'global' } });
    await client.$disconnect();
  });

  beforeEach(async () => {
    failAfterDismissal = false;
    await seedRows();
    await client.userSettings.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  });

  describe('per user', () => {
    it('disabling an event for the inbox dismisses that user’s live rows of it, and only those', async () => {
      await userSettings.getSettings(userId);

      await userSettings.patchSettings(userId, { notifications: { browser: { [WELCOME]: false } } } as never);

      expect(await live(userId, WELCOME)).toBe(0);
      expect(await dismissed(userId, WELCOME)).toBe(1);
      const row = await client.notification.findFirstOrThrow({ where: { userId, eventKey: WELCOME } });
      expect(row.readAt).not.toBeNull();
      // Another event of the same user, and the same event of another user, are untouched.
      expect(await live(userId, 'spec1090.other')).toBe(1);
      expect(await live(otherUserId, WELCOME)).toBe(1);
    });

    it('re-enabling the event restores nothing', async () => {
      await userSettings.getSettings(userId);
      await userSettings.patchSettings(userId, { notifications: { browser: { [WELCOME]: false } } } as never);

      await userSettings.patchSettings(userId, { notifications: { browser: { [WELCOME]: null } } } as never);

      expect(await live(userId, WELCOME)).toBe(0);
      expect(await dismissed(userId, WELCOME)).toBe(1);
    });

    it('never dismisses a mandatory event, whatever is stored for it', async () => {
      await userSettings.getSettings(userId);

      await userSettings.patchSettings(userId, { notifications: { browser: { [MANDATORY]: false } } } as never);

      expect(await live(userId, MANDATORY)).toBe(1);
    });

    it('rolls the settings write back when the hook fails after dismissing: neither commits', async () => {
      await userSettings.getSettings(userId);
      failAfterDismissal = true;

      await expect(
        userSettings.patchSettings(userId, { notifications: { browser: { [WELCOME]: false } } } as never),
      ).rejects.toThrow('hook failed after the dismissal ran');

      expect(await live(userId, WELCOME)).toBe(1);
      const stored = await client.userSettings.findUniqueOrThrow({ where: { userId } });
      expect((stored.value as { notifications?: unknown }).notifications).toBeUndefined();
      expect(stored.version).toBe(1);
    });

    it('a successful write commits the settings and the dismissal together', async () => {
      await userSettings.getSettings(userId);

      await userSettings.patchSettings(userId, { notifications: { browser: { [WELCOME]: false } } } as never);

      const stored = await client.userSettings.findUniqueOrThrow({ where: { userId } });
      expect((stored.value as { notifications?: unknown }).notifications).toEqual({ browser: { [WELCOME]: false } });
      expect(stored.version).toBe(2);
      expect(await live(userId, WELCOME)).toBe(0);
    });
  });

  describe('deployment-wide', () => {
    beforeEach(async () => {
      await systemSettings.patchSettings({ notifications: { disabledEvents: [] } } as never, userId);
    });

    it('adding an event to disabledEvents dismisses its live rows for every user; a mandatory event survives', async () => {
      await systemSettings.patchSettings({ notifications: { disabledEvents: [WELCOME, MANDATORY] } } as never, userId);

      expect(await live(userId, WELCOME)).toBe(0);
      expect(await live(otherUserId, WELCOME)).toBe(0);
      expect(await live(userId, MANDATORY)).toBe(1);
      expect(await live(otherUserId, 'spec1090.other')).toBe(1);
    });

    it('removing it from disabledEvents restores nothing', async () => {
      await systemSettings.patchSettings({ notifications: { disabledEvents: [WELCOME] } } as never, userId);
      await systemSettings.patchSettings({ notifications: { disabledEvents: [] } } as never, userId);

      expect(await live(userId, WELCOME)).toBe(0);
      expect(await dismissed(userId, WELCOME)).toBe(1);
    });

    it('rolls the system settings write back when the hook fails after dismissing', async () => {
      const before = await client.systemSettings.findUniqueOrThrow({ where: { key: 'global' } });
      failAfterDismissal = true;

      await expect(
        systemSettings.patchSettings({ notifications: { disabledEvents: [WELCOME] } } as never, userId),
      ).rejects.toThrow('hook failed after the dismissal ran');

      expect(await live(userId, WELCOME)).toBe(1);
      expect(await live(otherUserId, WELCOME)).toBe(1);
      const after = await client.systemSettings.findUniqueOrThrow({ where: { key: 'global' } });
      expect(after.version).toBe(before.version);
      expect(after.value).toEqual(before.value);
    });
  });

  describe('dismiss-all and the dismissed listing', () => {
    it('dismisses only the caller’s live rows, optionally by scope, and lists them under status=dismissed only', async () => {
      const store = new NotificationStoreService(client as never);
      const scopeA = randomUUID();
      await client.notification.update({
        where: { id: (await client.notification.findFirstOrThrow({ where: { userId, eventKey: WELCOME } })).id },
        data: { scopeId: scopeA },
      });

      const scoped = await store.dismissAll(userId, scopeA);
      expect(scoped.dismissed).toBe(1);
      expect(await live(userId, WELCOME)).toBe(0);
      expect(await live(userId, MANDATORY)).toBe(1);

      const all = await store.dismissAll(userId);
      expect(all).toEqual({ dismissed: 2, unreadCount: 0 });
      expect(await live(otherUserId, WELCOME)).toBe(1);

      const base = { page: 1, pageSize: 50, unreadOnly: false } as never;
      const dismissedList = await store.list(userId, { ...(base as object), status: 'dismissed' } as never);
      expect(dismissedList.total).toBe(3);
      expect(dismissedList.items.every((item) => item.dismissedAt !== null)).toBe(true);
      expect((await store.list(userId, { ...(base as object), status: 'all' } as never)).total).toBe(0);
      expect((await store.list(otherUserId, { ...(base as object), status: 'dismissed' } as never)).total).toBe(0);
    });
  });
});
