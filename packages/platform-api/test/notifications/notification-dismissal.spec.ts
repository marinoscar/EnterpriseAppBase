import {
  dismissEventsForUser,
  dismissEventsGlobally,
  dismissibleEventKeys,
  inboxDisabledEventKeys,
} from '../../src/notifications/notification-dismissal';
import type { NotificationsTx } from '../../src/notifications/data/notifications-db';
import { registerTestNotifications } from './support';

// Dismiss-on-disable helpers (issue #1090): which events a write switched off,
// and the two statements that dismiss their live rows.

beforeAll(() => registerTestNotifications());

function fakeTx(count = 3) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const tx = {
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join('?').replace(/\s+/g, ' ').trim(), values });
      return count;
    }),
  } as unknown as NotificationsTx;
  return { tx, calls };
}

describe('inboxDisabledEventKeys', () => {
  it('returns the registered events with a stored false for the in-app inbox', () => {
    expect(inboxDisabledEventKeys({ browser: { 'user.welcome': false } })).toEqual(['user.welcome']);
  });

  it('ignores a true, a mandatory event, an unknown event and other channels', () => {
    expect(
      inboxDisabledEventKeys({
        browser: { 'user.welcome': true, 'security.role_changed': false, 'not.registered': false },
        email: { 'user.welcome': false },
      }),
    ).toEqual([]);
  });

  it('is empty for an absent or malformed namespace', () => {
    expect(inboxDisabledEventKeys(undefined)).toEqual([]);
    expect(inboxDisabledEventKeys('nope')).toEqual([]);
    expect(inboxDisabledEventKeys({ browser: 'nope' })).toEqual([]);
  });
});

describe('dismissibleEventKeys', () => {
  it('drops mandatory events and keeps the rest, unknown keys included', () => {
    expect(dismissibleEventKeys(['user.welcome', 'security.role_changed', 'not.registered'])).toEqual([
      'user.welcome',
      'not.registered',
    ]);
  });
});

describe('dismissEventsForUser / dismissEventsGlobally', () => {
  it('dismisses live rows of the user, implies read, and sets updated_at explicitly', async () => {
    const { tx, calls } = fakeTx(5);

    await expect(dismissEventsForUser(tx, 'u1', ['user.welcome'])).resolves.toBe(5);

    expect(calls[0]!.sql).toContain('SET dismissed_at = now(), read_at = COALESCE(read_at, now()), updated_at = now()');
    expect(calls[0]!.sql).toContain('user_id = ?::uuid');
    expect(calls[0]!.sql).toContain('dismissed_at IS NULL');
    expect(calls[0]!.values).toEqual(['u1', ['user.welcome']]);
  });

  it('the global form has no user predicate', async () => {
    const { tx, calls } = fakeTx();

    await dismissEventsGlobally(tx, ['user.welcome']);

    expect(calls[0]!.sql).not.toContain('user_id');
    expect(calls[0]!.sql).toContain('event_key = ANY(?::text[])');
    expect(calls[0]!.values).toEqual([['user.welcome']]);
  });

  it('runs no statement for an empty list', async () => {
    const { tx, calls } = fakeTx();

    expect(await dismissEventsForUser(tx, 'u1', [])).toBe(0);
    expect(await dismissEventsGlobally(tx, [])).toBe(0);
    expect(calls).toEqual([]);
  });
});
