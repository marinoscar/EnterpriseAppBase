import {
  EVENT_EMAIL_TEMPLATES,
  EmailNotificationChannel,
} from './email-notification.channel';
import { NOTIFICATION_EVENTS } from '../notification-events';
import type {
  NotificationDispatchContext,
  NotificationRecipient,
} from '../notification.types';

// =============================================================================
// EmailNotificationChannel — tests (issue #125, epic #109)
// =============================================================================
//
// #128 wires real templates for the three seeded events; until it does,
// `EVENT_EMAIL_TEMPLATES` is deliberately empty (see that file's header). This
// suite locks in the ONE thing that matters about that state: dispatching an
// event with no registered template must record a failed delivery with a
// clear, specific reason — not throw, and not silently succeed.
//
// `EmailSettingsService`/`SesEmailProvider`/`SmtpEmailProvider` are injected
// as bare `{ get: jest.fn() }`/`{ send: jest.fn() }` stand-ins, following
// email-test-send.service.spec.ts's pattern — this suite is about the
// channel's own branching, not the transports underneath it.
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

describe('EmailNotificationChannel', () => {
  let channel: EmailNotificationChannel;
  let mockEmailSettings: { get: jest.Mock };
  let mockSes: { send: jest.Mock };
  let mockSmtp: { send: jest.Mock };

  beforeEach(() => {
    mockEmailSettings = { get: jest.fn() };
    mockSes = { send: jest.fn() };
    mockSmtp = { send: jest.fn() };

    channel = new EmailNotificationChannel(
      mockEmailSettings as never,
      mockSes as never,
      mockSmtp as never,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('EVENT_EMAIL_TEMPLATES is deliberately empty until #128', () => {
    it('has no entries registered', () => {
      expect(Object.keys(EVENT_EMAIL_TEMPLATES)).toEqual([]);
    });
  });

  describe('deliver() with no registered template', () => {
    it('records a failed result with a clear reason, rather than throwing', async () => {
      const context = contextFor('user.welcome');

      const result = await channel.deliver(context, recipient.email as string);

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        "No email template is registered for event 'user.welcome'.",
      );
    });

    it('does not read email settings or touch a transport before failing', async () => {
      // The template check happens first, before any I/O — a missing
      // template is a code-level omission and should not cost a settings
      // query to discover.
      const context = contextFor('user.welcome');

      await channel.deliver(context, recipient.email as string);

      expect(mockEmailSettings.get).not.toHaveBeenCalled();
      expect(mockSes.send).not.toHaveBeenCalled();
      expect(mockSmtp.send).not.toHaveBeenCalled();
    });

    it('fails the same way for every currently-registered event, since the template map is empty for all of them', async () => {
      for (const event of NOTIFICATION_EVENTS) {
        const context = contextFor(event.key);
        const result = await channel.deliver(context, 'someone@example.com');

        expect(result.success).toBe(false);
        expect(result.error).toBe(
          `No email template is registered for event '${event.key}'.`,
        );
      }
    });

    it('never throws, even though deliver() is awaited directly here (not through the dispatcher\'s try/catch)', async () => {
      const context = contextFor('user.welcome');
      await expect(
        channel.deliver(context, recipient.email as string),
      ).resolves.toMatchObject({ success: false });
    });
  });

  describe('resolveTo', () => {
    it('returns the recipient email address', () => {
      expect(channel.resolveTo(recipient)).toBe('user@example.com');
    });

    it('returns null when the recipient has no email address', () => {
      expect(
        channel.resolveTo({ ...recipient, email: null }),
      ).toBeNull();
    });
  });
});
