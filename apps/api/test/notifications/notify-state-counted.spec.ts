import { PLATFORM_PRISMA } from '@marinoscar/platform-api/core';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../src/prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from '../mocks/prisma.mock';
import {
  DEFAULT_NOTIFICATION_POLICY,
  NOTIFICATION_CHANNEL_SENDERS,
  NotificationDeliveryService,
  NotificationPolicyService,
  NotificationsService,
  registerNotificationEvent,
  type NotificationChannelSender,
  type NotificationDispatchContext,
} from './support/notifications';

// =============================================================================
// notifyState / notifyCounted — the entry points (issue #1077)
// =============================================================================
//
// The dispatcher is real; the browser sender is a fake that records the
// context it was handed, so the assertions are about what the entry points ask
// the inbox to do (the write mode, the dedup key, the narrowing) and about the
// kind assertions. The inbox write itself is covered by
// notification-inbox-writer.spec.ts (fake client) and
// notification-inbox.db.spec.ts (real Postgres).
// =============================================================================

const STATE = 'spec1077.queue_pending';
const COUNTED = 'spec1077.uploads_done';
const PLAIN = 'spec1077.plain_event';
const USER = 'user-1';
const SCOPE = '22222222-2222-4222-8222-222222222222';

const def = (key: string, kind?: 'event' | 'state' | 'counted') => ({
  key,
  label: key,
  description: `${key} description`,
  channels: ['browser' as const],
  defaultEnabled: true,
  ...(kind ? { kind } : {}),
});

registerNotificationEvent(def(STATE, 'state'));
registerNotificationEvent(def(COUNTED, 'counted'));
registerNotificationEvent(def(PLAIN));

describe('notifyState / notifyCounted', () => {
  let service: NotificationsService;
  let mockPrisma: MockPrismaService;
  let contexts: NotificationDispatchContext[];
  let raw: Array<{ sql: string; values: unknown[] }>;

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();
    contexts = [];
    raw = [];
    mockPrisma.user.findUnique.mockResolvedValue({ id: USER, email: 'user@example.com', userSettings: null } as never);
    mockPrisma.notificationDelivery.create.mockResolvedValue({ id: 'delivery-1' } as never);
    mockPrisma.notificationDelivery.update.mockResolvedValue({} as never);
    // The dismiss path runs in a transaction that takes the advisory lock.
    mockPrisma.$transaction.mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          raw.push({ sql: strings.join('?').replace(/\s+/g, ' ').trim(), values });
          return 1;
        },
      })) as never);

    const browser: NotificationChannelSender = {
      channel: 'browser',
      resolveTo: (recipient) => recipient.userId,
      deliver: async (context) => {
        contexts.push(context);
        return { success: true, messageId: 'm' };
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        NotificationDeliveryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PLATFORM_PRISMA, useValue: mockPrisma },
        {
          provide: NotificationPolicyService,
          useValue: { getPolicy: jest.fn().mockResolvedValue(DEFAULT_NOTIFICATION_POLICY) },
        },
        { provide: NOTIFICATION_CHANNEL_SENDERS, useValue: [browser] },
      ],
    }).compile();
    service = module.get(NotificationsService);
  });

  describe('notifyState', () => {
    it('asks the inbox for a state upsert keyed by event and scope', async () => {
      await service.notifyState(STATE, USER, { count: 929 }, { scopeId: SCOPE });
      await service.flush();

      expect(contexts).toHaveLength(1);
      expect(contexts[0]!.inbox).toMatchObject({ kind: 'state', count: 929, scopeId: SCOPE, reunreadWhen: 'count-increased' });
      expect(contexts[0]!.inbox!.dedupKey).toContain(STATE);
      expect(contexts[0]!.inbox!.dedupKey).toContain(SCOPE);
      expect(contexts[0]!.data).toEqual({ count: 929 });
    });

    it('passes reunreadWhen through', async () => {
      await service.notifyState(STATE, USER, { count: 1 }, { reunreadWhen: 'never' });
      await service.flush();
      expect(contexts[0]!.inbox).toMatchObject({ reunreadWhen: 'never', scopeId: null });
    });

    it('dismisses the live row when the count drains to zero, without dispatching', async () => {
      await service.notifyState(STATE, USER, { count: 0 }, { scopeId: SCOPE });
      await service.flush();

      expect(contexts).toHaveLength(0);
      expect(raw.some((r) => r.sql.includes('pg_advisory_xact_lock'))).toBe(true);
      const dismiss = raw.find((r) => r.sql.startsWith('UPDATE notifications SET dismissed_at'));
      expect(dismiss?.values[0]).toBe(USER);
      expect(String(dismiss?.values[1])).toContain(SCOPE);
    });

    it.each([
      ['an event not declared state', PLAIN],
      ['a counted event', COUNTED],
      ['an unknown key', 'spec1077.nope'],
    ])('ignores %s', async (_label, key) => {
      await service.notifyState(key, USER, { count: 3 });
      await service.flush();
      expect(contexts).toHaveLength(0);
      expect(raw).toHaveLength(0);
    });

    it('ignores a non-integer count', async () => {
      await service.notifyState(STATE, USER, { count: 1.5 });
      await service.notifyState(STATE, USER, {} as never);
      await service.flush();
      expect(contexts).toHaveLength(0);
    });

    it('never rejects', async () => {
      mockPrisma.user.findUnique.mockRejectedValue(new Error('db down') as never);
      await expect(service.notifyState(STATE, USER, { count: 2 })).resolves.toBeUndefined();
      await expect(service.flush()).resolves.toBeUndefined();
    });
  });

  describe('notifyCounted', () => {
    it('asks the inbox for a counted fold with the window, increment and match in the key', async () => {
      await service.notifyCounted(COUNTED, USER, { uploaderId: 'u' }, { scopeId: SCOPE, windowMs: 900_000, increment: 3, match: { kind: 'import' } });
      await service.flush();

      expect(contexts[0]!.inbox).toMatchObject({ kind: 'counted', scopeId: SCOPE, windowMs: 900_000, increment: 3 });
      expect(contexts[0]!.inbox!.dedupKey).toContain('import');
      expect(contexts[0]!.data).toEqual({ uploaderId: 'u' });
    });

    it('defaults to one occurrence and no window', async () => {
      await service.notifyCounted(COUNTED, USER, {});
      await service.flush();
      expect(contexts[0]!.inbox).toMatchObject({ increment: 1, windowMs: null, scopeId: null });
    });

    it('separates rows by match', async () => {
      await service.notifyCounted(COUNTED, USER, {}, { match: { jobType: 'a' } });
      await service.notifyCounted(COUNTED, USER, {}, { match: { jobType: 'b' } });
      await service.flush();
      expect(contexts[0]!.inbox!.dedupKey).not.toBe(contexts[1]!.inbox!.dedupKey);
    });

    it.each([
      ['a zero increment', { increment: 0 }],
      ['a fractional increment', { increment: 1.5 }],
      ['a non-positive window', { windowMs: 0 }],
    ])('ignores %s', async (_label, options) => {
      await service.notifyCounted(COUNTED, USER, {}, options);
      await service.flush();
      expect(contexts).toHaveLength(0);
    });

    it.each([
      ['a state event', STATE],
      ['an event not declared counted', PLAIN],
    ])('ignores %s', async (_label, key) => {
      await service.notifyCounted(key, USER, {});
      await service.flush();
      expect(contexts).toHaveLength(0);
    });
  });

  describe('notify()', () => {
    it('is unchanged for a plain event: no inbox mode is set', async () => {
      await service.notify(PLAIN, USER, {});
      await service.flush();
      expect(contexts).toHaveLength(1);
      expect(contexts[0]!.inbox).toBeUndefined();
    });

    it.each([STATE, COUNTED])('refuses %s, whose volume guard an append would defeat', async (key) => {
      await service.notify(key, USER, { count: 1 });
      await service.flush();
      expect(contexts).toHaveLength(0);
    });
  });
});
