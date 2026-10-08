import { RegistryError, withTemporaryEntries } from '@marinoscar/platform-api/core';
import type { NotificationChannel } from '../support/notifications';
import type { NotificationChannelSender } from '../support/notifications';
import { NotificationChannelSenderRegistry } from '../support/notifications';
import { notificationChannelRegistry } from '../support/notifications';

// =============================================================================
// NotificationChannelSenderRegistry (issue #678, PP-1.6)
// =============================================================================

function fakeSender(channel: string): NotificationChannelSender {
  return {
    channel: channel as NotificationChannel,
    resolveTo: () => 'to',
    deliver: async () => ({ success: true }),
  };
}

const ANDROID = { id: 'android_app', label: 'Android app', description: 'The paired Android app.' };

function platform(): NotificationChannelSenderRegistry {
  return new NotificationChannelSenderRegistry([
    fakeSender('email'),
    fakeSender('browser'),
    fakeSender('push'),
  ]);
}

function thrown(fn: () => void): RegistryError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(RegistryError);
    return err as RegistryError;
  }
  throw new Error('expected a RegistryError');
}

describe('NotificationChannelSenderRegistry', () => {
  it('registers the platform senders it is constructed with, in order', () => {
    expect(platform().channels()).toEqual(['email', 'browser', 'push']);
  });

  it('refuses two platform senders for one channel with the historical message', () => {
    const err = thrown(() => new NotificationChannelSenderRegistry([fakeSender('email'), fakeSender('email')]));
    expect(err.code).toBe('DUPLICATE_ID');
    expect(err.message).toBe("Duplicate notification channel sender registered for 'email'.");
  });

  it('never hands out a platform sender', () => {
    const registry = platform();
    expect(registry.get('email')).toBeUndefined();
    expect(registry.get('browser')).toBeUndefined();
    expect(registry.get('push')).toBeUndefined();
  });

  it('accepts an app sender for a registered app channel and returns it', async () => {
    await withTemporaryEntries(notificationChannelRegistry, [ANDROID], () => {
      const registry = platform();
      const android = fakeSender('android_app');

      registry.register(android);

      expect(registry.get('android_app')).toBe(android);
      expect(registry.channels()).toEqual(['email', 'browser', 'push', 'android_app']);
    });
  });

  it('refuses an app sender for a channel that already has one (DUPLICATE_ID, same wording)', () => {
    const err = thrown(() => platform().register(fakeSender('email')));
    expect(err.code).toBe('DUPLICATE_ID');
    expect(err.id).toBe('email');
    expect(err.message).toBe("Duplicate notification channel sender registered for 'email'.");
  });

  it('refuses a sender for a channel no registry entry declares (INVALID_ENTRY)', () => {
    const err = thrown(() => platform().register(fakeSender('carrier_pigeon')));
    expect(err.code).toBe('INVALID_ENTRY');
    expect(err.id).toBe('carrier_pigeon');
    expect(err.message).toContain('not a registered notification channel');
  });

  it('freezes on application bootstrap', async () => {
    await withTemporaryEntries(notificationChannelRegistry, [ANDROID], () => {
      const registry = platform();
      registry.onApplicationBootstrap();

      const err = thrown(() => registry.register(fakeSender('android_app')));
      expect(err.code).toBe('FROZEN');
      expect(registry.channels()).toEqual(['email', 'browser', 'push']);
    });
  });
});
