import {
  BrowserNotificationChannel,
  EVENT_BROWSER_TEMPLATES,
  sanitizeLink,
} from './browser-notification.channel';
import { NOTIFICATION_EVENTS } from '../notification-events';
import type {
  NotificationDispatchContext,
  NotificationRecipient,
} from '../notification.types';

// =============================================================================
// BrowserNotificationChannel — tests (issue #127, epic #109)
// =============================================================================
//
// `mockStream = { publish: jest.fn() }` — a plain jest mock, not a real
// `NotificationStreamService`. This suite is about the channel's own
// branching (render fallback, ordering, truncation, link sanitisation), not
// about the stream registry (see notification-stream.service.spec.ts for
// that).
//
// THE ORDERING CENTREPIECE: `prisma.notification.create` must be called and
// awaited BEFORE `stream.publish` — a durable row for a crashed/never-open
// stream, never the reverse. See the source file's header for why.
// =============================================================================

const recipient: NotificationRecipient = {
  userId: 'user-1',
  email: 'user@example.com',
  preferences: {},
};

function contextFor(eventKey: string, data: unknown = {}): NotificationDispatchContext {
  const event = NOTIFICATION_EVENTS.find((e) => e.key === eventKey);
  if (!event) {
    throw new Error(`Test fixture error: no such event '${eventKey}' in the registry.`);
  }
  return { event, recipient, data };
}

describe('BrowserNotificationChannel', () => {
  let channel: BrowserNotificationChannel;
  let mockPrisma: { notification: { create: jest.Mock } };
  let mockStream: { publish: jest.Mock };

  beforeEach(() => {
    mockPrisma = { notification: { create: jest.fn() } };
    mockStream = { publish: jest.fn() };

    channel = new BrowserNotificationChannel(mockPrisma as never, mockStream as never);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // resolveTo
  // ==========================================================================

  describe('resolveTo', () => {
    it('returns the recipient userId', () => {
      expect(channel.resolveTo(recipient)).toBe('user-1');
    });

    it('returns null when the recipient has no account (userId: null)', () => {
      expect(channel.resolveTo({ ...recipient, userId: null })).toBeNull();
    });
  });

  // ==========================================================================
  // EVENT_BROWSER_TEMPLATES is empty until #128
  // ==========================================================================

  describe('EVENT_BROWSER_TEMPLATES is deliberately empty until #128', () => {
    it('has no entries registered', () => {
      expect(Object.keys(EVENT_BROWSER_TEMPLATES)).toEqual([]);
    });
  });

  // ==========================================================================
  // ORDERING CENTREPIECE: create() awaited BEFORE publish()
  // ==========================================================================

  describe('deliver() ordering: the row is written before the stream is published to', () => {
    it('calls prisma.notification.create and awaits it before calling stream.publish', async () => {
      const callOrder: string[] = [];

      mockPrisma.notification.create.mockImplementation(async () => {
        callOrder.push('create');
        return { id: 'notif-1', createdAt: new Date('2026-01-01T00:00:00.000Z') };
      });
      mockStream.publish.mockImplementation(() => {
        callOrder.push('publish');
        return 1;
      });

      const context = contextFor('user.welcome');
      const result = await channel.deliver(context, 'user-1');

      expect(callOrder).toEqual(['create', 'publish']);
      expect(result).toEqual({ success: true, messageId: 'notif-1' });
    });
  });

  // ==========================================================================
  // Render fallback: a miss falls back to the registry's label/description
  // ==========================================================================

  describe('render() fallback when no template is registered (true for every current event)', () => {
    it('deliver() succeeds using event.label/event.description as title/body', async () => {
      mockPrisma.notification.create.mockResolvedValue({
        id: 'notif-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      mockStream.publish.mockReturnValue(0);

      const event = NOTIFICATION_EVENTS.find((e) => e.key === 'user.welcome')!;
      const context = contextFor('user.welcome');

      const result = await channel.deliver(context, 'user-1');

      expect(result.success).toBe(true);
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: event.label,
            body: event.description,
          }),
        }),
      );
    });

    it('does not throw, for every currently-registered event', async () => {
      mockPrisma.notification.create.mockResolvedValue({
        id: 'notif-x',
        createdAt: new Date(),
      });
      mockStream.publish.mockReturnValue(0);

      for (const event of NOTIFICATION_EVENTS) {
        const context = contextFor(event.key);
        await expect(channel.deliver(context, 'user-1')).resolves.toMatchObject({
          success: true,
        });
      }
    });
  });

  // ==========================================================================
  // Database failure: create() rejects
  // ==========================================================================

  describe('when prisma.notification.create rejects', () => {
    it('returns { success: false, error } and never calls stream.publish', async () => {
      mockPrisma.notification.create.mockRejectedValue(new Error('db unavailable'));

      const context = contextFor('user.welcome');
      const result = await channel.deliver(context, 'user-1');

      expect(result.success).toBe(false);
      expect((result as { error: string }).error).toContain('db unavailable');
      expect(mockStream.publish).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Truncation, and a throwing template
  // ==========================================================================
  //
  // `EVENT_BROWSER_TEMPLATES` is a plain (non-frozen) object exported for
  // #128 to populate later. It is empty today, but nothing stops a test from
  // registering a temporary entry at runtime to exercise `render()`'s other
  // two branches — a template that returns oversized content, and one that
  // throws — without touching the source file. Removed in `afterEach` so it
  // never leaks into another test.
  // ==========================================================================

  describe('title/body truncation (registered template returns oversized content)', () => {
    const EVENT_KEY = 'user.welcome';

    afterEach(() => {
      delete EVENT_BROWSER_TEMPLATES[EVENT_KEY];
    });

    it('caps title at 200 chars and body at 2000 chars, each ending with an ellipsis', async () => {
      const oversizedTitle = 'T'.repeat(250);
      const oversizedBody = 'B'.repeat(2500);

      EVENT_BROWSER_TEMPLATES[EVENT_KEY] = () => ({
        title: oversizedTitle,
        body: oversizedBody,
      });

      mockPrisma.notification.create.mockResolvedValue({
        id: 'notif-1',
        createdAt: new Date(),
      });
      mockStream.publish.mockReturnValue(0);

      const context = contextFor(EVENT_KEY);
      await channel.deliver(context, 'user-1');

      const [[createArgs]] = mockPrisma.notification.create.mock.calls as unknown as [
        [{ data: { title: string; body: string } }],
      ];

      expect(createArgs.data.title).toHaveLength(200);
      expect(createArgs.data.title.endsWith('…')).toBe(true);
      expect(createArgs.data.body).toHaveLength(2000);
      expect(createArgs.data.body.endsWith('…')).toBe(true);
    });

    it('leaves content under the cap untouched, with no ellipsis added', async () => {
      EVENT_BROWSER_TEMPLATES[EVENT_KEY] = () => ({
        title: 'Short title',
        body: 'Short body.',
      });

      mockPrisma.notification.create.mockResolvedValue({
        id: 'notif-1',
        createdAt: new Date(),
      });
      mockStream.publish.mockReturnValue(0);

      const context = contextFor(EVENT_KEY);
      await channel.deliver(context, 'user-1');

      const [[createArgs]] = mockPrisma.notification.create.mock.calls as unknown as [
        [{ data: { title: string; body: string } }],
      ];
      expect(createArgs.data.title).toBe('Short title');
      expect(createArgs.data.body).toBe('Short body.');
    });
  });

  describe('when a registered template throws', () => {
    const EVENT_KEY = 'user.welcome';

    afterEach(() => {
      delete EVENT_BROWSER_TEMPLATES[EVENT_KEY];
    });

    it('deliver() returns { success: false, error } WITHOUT ever calling prisma.notification.create', async () => {
      EVENT_BROWSER_TEMPLATES[EVENT_KEY] = () => {
        throw new Error('template blew up');
      };

      const context = contextFor(EVENT_KEY);
      const result = await channel.deliver(context, 'user-1');

      expect(result.success).toBe(false);
      expect((result as { error: string }).error).toContain('template blew up');
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
      expect(mockStream.publish).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // sanitizeLink — exported, tested directly
  // ==========================================================================

  describe('sanitizeLink', () => {
    describe('accepted', () => {
      it.each([
        ['/settings', '/settings'],
        ['/admin/users?tab=roles', '/admin/users?tab=roles'],
        ['/x#frag', '/x#frag'],
        [' /settings ', '/settings'], // trimmed then accepted
      ])('accepts %j -> %j', (input, expected) => {
        expect(sanitizeLink(input)).toBe(expected);
      });
    });

    describe('rejected -> null', () => {
      it.each([
        ['protocol-relative', '//evil.example/x'],
        ['absolute https URL', 'https://evil/x'],
        ['javascript scheme', 'javascript:alert(1)'],
        ['data URL', 'data:text/html,x'],
        ['relative without leading slash', 'settings'],
        ['backslash after slash', '/\\evil.example'],
        ['embedded tab', '/settings\tpath'],
        ['embedded newline', '/settings\npath'],
        ['embedded carriage return', '/settings\rpath'],
        ['empty string', ''],
      ])('rejects %s (%j) -> null', (_label, input) => {
        expect(sanitizeLink(input)).toBeNull();
      });

      it('rejects undefined -> null', () => {
        expect(sanitizeLink(undefined)).toBeNull();
      });
    });
  });
});
