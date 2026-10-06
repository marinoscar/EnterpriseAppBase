import { ConfigService } from '@nestjs/config';

import { InProcessEventBus } from '../../common/event-bus/in-process-event-bus';
import type { EventBus } from '../../common/event-bus/event-bus.interface';
import { FakeEventBusNetwork } from '../../../test/helpers/fake-network-event-bus.helper';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import {
  PRINCIPAL_CACHE_MAX_ENTRIES,
  PRINCIPAL_INVALIDATE_CHANNEL,
  PrincipalCache,
} from './principal-cache.service';

function configWith(ttlSeconds: unknown): ConfigService {
  return {
    get: jest.fn((key: string) => (key === 'auth.principalCacheTtlSeconds' ? ttlSeconds : undefined)),
  } as unknown as ConfigService;
}

function principal(id: string, overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  const now = new Date('2026-10-06T00:00:00.000Z');
  return {
    id,
    email: `${id}@example.test`,
    displayName: null,
    providerDisplayName: null,
    profileImageUrl: null,
    providerProfileImageUrl: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    userRoles: [
      {
        role: {
          id: 'role-viewer',
          name: 'viewer',
          description: null,
          createdAt: now,
          updatedAt: now,
          rolePermissions: [
            { permission: { id: 'perm-1', name: 'users:read', description: null, createdAt: now, updatedAt: now } },
          ],
        },
      },
    ],
    ...overrides,
  } as unknown as AuthenticatedUser;
}

/** Waits for the bus's microtask delivery. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('PrincipalCache (PP-1.12, #683)', () => {
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000_000;
  });

  function cache(ttlSeconds: unknown = 30, bus: EventBus = new InProcessEventBus()): PrincipalCache {
    const c = new PrincipalCache(configWith(ttlSeconds), bus, now);
    c.onModuleInit();
    return c;
  }

  function store(c: PrincipalCache, value: AuthenticatedUser) {
    return c.set(value.id, value, c.generation(value.id));
  }

  describe('TTL', () => {
    it('defaults to 30 seconds and honours a configured value', () => {
      expect(cache(undefined).ttlMs).toBe(30_000);
      expect(cache(5).ttlMs).toBe(5_000);
    });

    it('falls back to the default for a negative or non-integer value', () => {
      expect(cache(-1).ttlMs).toBe(30_000);
      expect(cache(1.5).ttlMs).toBe(30_000);
      expect(cache('abc').ttlMs).toBe(30_000);
    });

    it('serves an entry until the TTL passes, then misses (injected clock)', () => {
      const c = cache(30);
      store(c, principal('u1'));

      clock += 29_999;
      expect(c.get('u1')?.id).toBe('u1');

      clock += 1;
      expect(c.get('u1')).toBeUndefined();
      expect(c.stats().size).toBe(0);
    });

    it('counts hits and misses', () => {
      const c = cache();
      expect(c.get('u1')).toBeUndefined();
      store(c, principal('u1'));
      c.get('u1');
      c.get('u1');
      expect(c.stats()).toMatchObject({ hits: 2, misses: 1, size: 1 });
    });
  });

  describe('bound', () => {
    it(`never holds more than ${PRINCIPAL_CACHE_MAX_ENTRIES} entries, evicting the oldest first`, () => {
      const c = cache();
      for (let i = 0; i < PRINCIPAL_CACHE_MAX_ENTRIES + 25; i += 1) {
        store(c, principal(`u${i}`));
      }

      expect(c.stats().size).toBe(PRINCIPAL_CACHE_MAX_ENTRIES);
      expect(c.get('u0')).toBeUndefined();
      expect(c.get('u24')).toBeUndefined();
      expect(c.get('u25')?.id).toBe('u25');
      expect(c.get(`u${PRINCIPAL_CACHE_MAX_ENTRIES + 24}`)).toBeDefined();
    });

    it('moves a re-stored key to the back of the eviction order', () => {
      const c = cache();
      for (let i = 0; i < PRINCIPAL_CACHE_MAX_ENTRIES; i += 1) {
        store(c, principal(`u${i}`));
      }
      store(c, principal('u0'));
      store(c, principal('new'));

      expect(c.get('u0')).toBeDefined();
      expect(c.get('u1')).toBeUndefined();
    });
  });

  describe('frozen values', () => {
    it('stores a deep-frozen copy and leaves the caller’s object alone', () => {
      const c = cache();
      const original = principal('u1');
      const stored = store(c, original)!;

      expect(stored).not.toBe(original);
      expect(Object.isFrozen(original)).toBe(false);
      expect(Object.isFrozen(stored)).toBe(true);
      expect(Object.isFrozen(stored.userRoles[0].role.rolePermissions[0].permission)).toBe(true);
      expect(stored.createdAt).toBeInstanceOf(Date);

      expect(() => {
        (stored as { isActive: boolean }).isActive = false;
      }).toThrow(TypeError);
      expect(() => {
        (stored.userRoles as unknown[]).push({});
      }).toThrow(TypeError);
      expect(c.get('u1')?.isActive).toBe(true);
    });
  });

  describe('generation guard (the in-flight read race)', () => {
    it('refuses to store a value read before an invalidation of that user', () => {
      const c = cache();
      const before = c.generation('u1');

      // ... the database read is in flight, then an admin demotes the user:
      c.invalidate({ userId: 'u1' });

      expect(c.set('u1', principal('u1'), before)).toBeUndefined();
      expect(c.get('u1')).toBeUndefined();

      // A read that starts after the invalidation stores normally.
      expect(c.set('u1', principal('u1'), c.generation('u1'))).toBeDefined();
    });

    it('refuses after an `all` invalidation too', () => {
      const c = cache();
      const before = c.generation('u1');
      c.invalidate({ all: true });
      expect(c.set('u1', principal('u1'), before)).toBeUndefined();
    });

    it('refuses after a REMOTE invalidation that lands mid-read', async () => {
      const network = new FakeEventBusNetwork();
      const a = cache(30, network.join('a'));
      const b = cache(30, network.join('b'));

      const before = b.generation('u1');
      a.invalidate({ userId: 'u1' });
      await flush();

      expect(b.set('u1', principal('u1'), before)).toBeUndefined();
    });

    it('is unaffected by an invalidation of a different user', () => {
      const c = cache();
      const before = c.generation('u1');
      c.invalidate({ userId: 'u2' });
      expect(c.set('u1', principal('u1'), before)).toBeDefined();
    });
  });

  describe('invalidation', () => {
    it('drops locally and synchronously, then publishes the same target', () => {
      const bus = new InProcessEventBus();
      const publish = jest.spyOn(bus, 'publish');
      const c = cache(30, bus);
      store(c, principal('u1'));
      store(c, principal('u2'));

      c.invalidate({ userId: 'u1' });

      // No await between the call and these assertions: local drop is synchronous.
      expect(c.get('u1')).toBeUndefined();
      expect(c.get('u2')).toBeDefined();
      expect(publish).toHaveBeenCalledWith(PRINCIPAL_INVALIDATE_CHANNEL, { userId: 'u1' });

      c.invalidate({ all: true });
      expect(c.stats().size).toBe(0);
      expect(publish).toHaveBeenLastCalledWith(PRINCIPAL_INVALIDATE_CHANNEL, { all: true });
      expect(c.stats().invalidations).toBe(2);
    });

    it('applies a remote invalidation (another replica, same bus network)', async () => {
      const network = new FakeEventBusNetwork();
      const a = cache(30, network.join('a'));
      const b = cache(30, network.join('b'));
      store(a, principal('u1'));
      store(b, principal('u1'));
      store(b, principal('u2'));

      a.invalidate({ userId: 'u1' });
      expect(b.get('u1')).toBeDefined(); // not yet: delivery is asynchronous
      await flush();

      expect(a.get('u1')).toBeUndefined();
      expect(b.get('u1')).toBeUndefined();
      expect(b.get('u2')).toBeDefined();

      a.invalidate({ all: true });
      await flush();
      expect(b.stats().size).toBe(0);
    });

    it('does not apply its own echo twice', async () => {
      const c = cache();
      c.invalidate({ userId: 'u1' });
      await flush();
      expect(c.stats().invalidations).toBe(1);
    });

    it('ignores a malformed remote message', async () => {
      const network = new FakeEventBusNetwork();
      const a = network.join('a');
      const b = cache(30, network.join('b'));
      store(b, principal('u1'));

      await a.publish(PRINCIPAL_INVALIDATE_CHANNEL, { userId: '' });
      await a.publish(PRINCIPAL_INVALIDATE_CHANNEL, { all: 'yes' });
      await a.publish(PRINCIPAL_INVALIDATE_CHANNEL, 'u1');
      await flush();

      expect(b.get('u1')).toBeDefined();
    });

    it('never throws, even when the bus does', () => {
      const bus = {
        adapter: 'in-process',
        origin: 'x',
        publish: jest.fn(() => {
          throw new Error('broken adapter');
        }),
        subscribe: jest.fn(() => () => undefined),
        health: jest.fn(),
      } as unknown as EventBus;
      const c = cache(30, bus);
      store(c, principal('u1'));

      expect(() => c.invalidate({ userId: 'u1' })).not.toThrow();
      expect(c.get('u1')).toBeUndefined();
    });

    it('works without an EVENT_BUS provider (a feature-module test graph): local-only', () => {
      const c = new PrincipalCache(configWith(30), undefined, now);
      c.onModuleInit();
      store(c, principal('u1'));
      expect(() => c.invalidate({ userId: 'u1' })).not.toThrow();
      expect(c.get('u1')).toBeUndefined();
      expect(c.busHealth().adapter).toBe('in-process');
    });

    it('unsubscribes on module destroy', async () => {
      const bus = new InProcessEventBus();
      const c = cache(30, bus);
      expect(bus.handlerCount(PRINCIPAL_INVALIDATE_CHANNEL)).toBe(1);
      c.onModuleDestroy();
      expect(bus.handlerCount(PRINCIPAL_INVALIDATE_CHANNEL)).toBe(0);
    });
  });

  describe('disabled (TTL 0)', () => {
    it('never stores and always misses, without counting', () => {
      const c = cache(0);
      expect(c.enabled).toBe(false);
      expect(c.ttlMs).toBe(0);
      expect(store(c, principal('u1'))).toBeUndefined();
      expect(c.get('u1')).toBeUndefined();
      expect(c.stats()).toEqual({ size: 0, hits: 0, misses: 0, invalidations: 0 });
    });

    it('still publishes invalidations, so a mixed-TTL fleet mid-rollout stays safe', () => {
      const bus = new InProcessEventBus();
      const publish = jest.spyOn(bus, 'publish');
      cache(0, bus).invalidate({ userId: 'u1' });
      expect(publish).toHaveBeenCalledWith(PRINCIPAL_INVALIDATE_CHANNEL, { userId: 'u1' });
    });
  });
});
