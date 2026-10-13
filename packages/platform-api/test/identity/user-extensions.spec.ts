// The user extensions (PP-14.25): `registerCurrentUserExtension` and
// `registerUserListExtension`, the contribution check (JSON only, bounded, no
// secrets) and the isolated, batched resolution. The wiring into `/auth/me` and
// the user list is covered in auth.service.spec.ts and users.service.spec.ts, and
// against the real application in apps/api/test/examples/identity.

import { USER_EXTENSION_LIMITS } from '@marinoscar/platform-contract/identity';

import { RegistryError, withTemporaryEntries } from '../../src/core';
import {
  checkUserExtensionContribution,
  currentUserExtensionRegistry,
  registerCurrentUserExtension,
  registerUserListExtension,
  resolveCurrentUserExtensions,
  resolveUserListExtensions,
  userListExtensionRegistry,
} from '../../src/identity/extensions/user-extensions';
import type { CurrentUserExtension, UserListExtension } from '../../src/identity/extensions/user-extensions';

const log = { warn: jest.fn<void, [string]>() };

beforeEach(() => log.warn.mockClear());

const me = (extensions: CurrentUserExtension[], fn: () => Promise<void>) => withTemporaryEntries(currentUserExtensionRegistry, extensions, fn);
const list = (extensions: UserListExtension[], fn: () => Promise<void>) => withTemporaryEntries(userListExtensionRegistry, extensions, fn);

describe('registering', () => {
  it('refuses a malformed id, a missing resolver and an out-of-range timeout', async () => {
    expect(() => registerCurrentUserExtension({ id: 'Billing', resolve: () => ({}) })).toThrow(RegistryError);
    expect(() => registerUserListExtension({ id: 'x', resolve: () => new Map() })).toThrow(RegistryError);
    expect(() => registerCurrentUserExtension({ id: 'billing', resolve: undefined as never })).toThrow(/resolve function/);
    expect(() => registerUserListExtension({ id: 'billing', resolve: () => new Map(), timeoutMs: 0 })).toThrow(/timeoutMs/);
    expect(() => registerUserListExtension({ id: 'billing', resolve: () => new Map(), timeoutMs: 60_000 })).toThrow(/timeoutMs/);
  });

  it('refuses a duplicate id within a registry but allows the same id in both', async () => {
    const one: CurrentUserExtension = { id: 'billing', resolve: () => ({ a: 1 }) };
    await me([one], async () => {
      expect(() => currentUserExtensionRegistry.register({ id: 'billing', resolve: () => ({}) })).toThrow(/Duplicate/);
      await list([{ id: 'billing', resolve: () => new Map() }], async () => {
        expect(userListExtensionRegistry.has('billing')).toBe(true);
      });
    });
  });
});

describe('checkUserExtensionContribution', () => {
  const ok = (value: unknown, max = 4096) => checkUserExtensionContribution(value, max);

  it('accepts JSON and returns a clean deep copy that drops undefined', () => {
    const input = { plan: 'pro', seats: 5, active: true, owner: null, tags: ['a', 'b'], limits: { api: { calls: 100 } }, gone: undefined };
    const result = ok(input);
    expect(result).toMatchObject({ ok: true, value: { plan: 'pro', seats: 5, active: true, owner: null, tags: ['a', 'b'], limits: { api: { calls: 100 } } } });
    if (result.ok) {
      expect(result.value).not.toHaveProperty('gone');
      expect(result.value).not.toBe(input);
      expect(result.value.limits).not.toBe(input.limits);
    }
  });

  it.each([
    ['null', null],
    ['an array', [1]],
    ['a string', 'x'],
    ['a Date', new Date()],
    ['a class instance', new (class Thing { a = 1; })()],
    ['a Map', new Map()],
  ])('refuses %s as the contribution', (_name, value) => {
    expect(ok(value)).toMatchObject({ ok: false });
  });

  it.each([
    ['a function', { f: () => 1 }],
    ['a bigint', { n: BigInt(1) }],
    ['a symbol', { s: Symbol('x') }],
    ['NaN', { n: NaN }],
    ['Infinity', { n: Infinity }],
    ['a nested Date', { d: new Date() }],
    ['a nested class instance', { d: { nested: new (class Thing {})() } }],
  ])('refuses %s inside the contribution', (_name, value) => {
    expect(ok(value)).toMatchObject({ ok: false });
  });

  it('refuses a cycle by the depth bound', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(ok(cyclic)).toMatchObject({ ok: false, reason: expect.stringContaining('deeper') });
  });

  it('refuses nesting deeper than the bound and accepts exactly the bound', () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let level = 1; level < USER_EXTENSION_LIMITS.maxDepth; level += 1) deep = { child: deep };
    expect(ok(deep)).toMatchObject({ ok: true });
    expect(ok({ child: deep })).toMatchObject({ ok: false });
  });

  it.each([
    'password',
    'Password',
    'apiKey',
    'api_key',
    'API-KEY',
    'token',
    'accessToken',
    'refresh_token',
    'clientSecret',
    'secret',
    'privateKey',
    'signingKey',
    'authorization',
    'Cookie',
    'credentials',
    'slackBotToken',
  ])('refuses a key named like a secret: %s (at any depth)', (key) => {
    expect(ok({ [key]: 'x' })).toMatchObject({ ok: false, reason: expect.stringContaining('named like a secret') });
    expect(ok({ a: { b: [{ [key]: 'x' }] } })).toMatchObject({ ok: false });
  });

  it('accepts a presence flag and a count that merely mention a secret word', () => {
    expect(ok({ hasToken: true, hasApiKey: false, tokenCount: 3, passwordPolicy: 'strict' })).toMatchObject({ ok: true });
  });

  it.each([
    ['a JWT', { v: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl' }],
    ['a bearer header', { v: 'Bearer abcdefghijklmnop' }],
    ['a PEM private key', { v: '-----BEGIN RSA PRIVATE KEY-----\nMIIB' }],
    ['a platform PAT', { v: 'pat_AbCdEfGhIjKlMnOpQrStUv' }],
    ['a node token', { v: 'nod_AbCdEfGhIjKlMnOpQrStUv' }],
    ['a link token', { v: 'lnk_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789' }],
  ])('refuses a value that is plainly %s', (_name, value) => {
    expect(ok(value)).toMatchObject({ ok: false, reason: expect.stringContaining('credential') });
  });

  it.each(['__proto__', 'constructor', 'prototype'])('refuses the key %s', (key) => {
    const poisoned = JSON.parse(`{"${key}": {"polluted": true}}`) as unknown;
    expect(ok(poisoned)).toMatchObject({ ok: false });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses a contribution over the byte bound and counts bytes, not characters', () => {
    expect(ok({ text: 'a'.repeat(100) }, 50)).toMatchObject({ ok: false, reason: expect.stringContaining('byte bound') });
    // 4 UTF-8 bytes per character: 30 chars is over a 100 byte bound, 20 is under.
    expect(ok({ t: '😀'.repeat(30) }, 100)).toMatchObject({ ok: false });
    expect(ok({ t: '😀'.repeat(20) }, 100)).toMatchObject({ ok: true });
  });
});

describe('resolveCurrentUserExtensions', () => {
  it('answers undefined when nothing is registered, so the payload is unchanged', async () => {
    await expect(resolveCurrentUserExtensions('u1', { orgId: null }, log)).resolves.toBeUndefined();
  });

  it('merges the contributions by id in registration order and passes the user and the organization', async () => {
    const billing = jest.fn(async (userId: string, ctx: { orgId: string | null }) => ({ plan: 'pro', for: userId, org: ctx.orgId }));
    await me(
      [
        { id: 'billing', resolve: billing },
        { id: 'team', resolve: () => ({ name: 'Core' }) },
      ],
      async () => {
        const result = await resolveCurrentUserExtensions('u1', { orgId: 'org-1' }, log);
        expect(Object.keys(result ?? {})).toEqual(['billing', 'team']);
        expect(result).toEqual({ billing: { plan: 'pro', for: 'u1', org: 'org-1' }, team: { name: 'Core' } });
      },
    );
    expect(billing).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('skips an extension that throws or rejects, logs its id and reason, and keeps the others', async () => {
    await me(
      [
        { id: 'broken', resolve: () => { throw new Error('synchronous boom'); } },
        { id: 'rejects', resolve: async () => { throw new Error('async boom'); } },
        { id: 'fine', resolve: () => ({ ok: true }) },
      ],
      async () => {
        await expect(resolveCurrentUserExtensions('u1', { orgId: null }, log)).resolves.toEqual({ fine: { ok: true } });
      },
    );
    const messages = log.warn.mock.calls.map(([message]) => message);
    expect(messages.some((m) => m.includes('"broken"') && m.includes('synchronous boom'))).toBe(true);
    expect(messages.some((m) => m.includes('"rejects"') && m.includes('async boom'))).toBe(true);
  });

  it('skips an extension that times out and aborts its signal', async () => {
    let signal: AbortSignal | undefined;
    await me(
      [
        {
          id: 'slow',
          timeoutMs: 20,
          resolve: (_userId, ctx) => {
            signal = ctx.signal;
            return new Promise(() => undefined);
          },
        },
        { id: 'fast', resolve: () => ({ ok: 1 }) },
      ],
      async () => {
        await expect(resolveCurrentUserExtensions('u1', { orgId: null }, log)).resolves.toEqual({ fast: { ok: 1 } });
      },
    );
    expect(signal?.aborted).toBe(true);
    expect(log.warn.mock.calls.some(([m]) => m.includes('"slow"') && m.includes('timed out'))).toBe(true);
  });

  it('skips a contribution the contract refuses without echoing its data, and treats null as none', async () => {
    await me(
      [
        { id: 'leaky', resolve: () => ({ apiKey: 'sk-live-should-never-leave' }) },
        { id: 'huge', resolve: () => ({ blob: 'x'.repeat(USER_EXTENSION_LIMITS.currentUserBytes + 1) }) },
        { id: 'nothing', resolve: () => null },
        { id: 'fine', resolve: () => ({ ok: true }) },
      ],
      async () => {
        await expect(resolveCurrentUserExtensions('u1', { orgId: null }, log)).resolves.toEqual({ fine: { ok: true } });
      },
    );
    const logged = log.warn.mock.calls.map(([m]) => m).join('\n');
    expect(logged).toContain('"leaky"');
    expect(logged).toContain('"huge"');
    expect(logged).not.toContain('sk-live-should-never-leave');
    expect(logged).not.toContain('"nothing"');
  });

  it('drops an extension that would push the total over the bound, keeping the ones registered first', async () => {
    const chunk = 'x'.repeat(USER_EXTENSION_LIMITS.currentUserBytes - 100);
    const count = Math.floor(USER_EXTENSION_LIMITS.currentUserTotalBytes / USER_EXTENSION_LIMITS.currentUserBytes) + 1;
    const extensions = Array.from({ length: count }, (_, index) => ({ id: `ext-${index}`, resolve: () => ({ chunk }) }));
    await me(extensions, async () => {
      const result = await resolveCurrentUserExtensions('u1', { orgId: null }, log);
      expect(Object.keys(result ?? {}).length).toBe(count - 1);
      expect(result).not.toHaveProperty(`ext-${count - 1}`);
    });
    expect(log.warn.mock.calls.some(([m]) => m.includes(`ext-${count - 1}`) && m.includes('together'))).toBe(true);
  });
});

describe('resolveUserListExtensions', () => {
  const ids = ['u1', 'u2', 'u3'];

  it('answers an empty map when nothing is registered or the page is empty, without calling anything', async () => {
    await expect(resolveUserListExtensions(ids, { viewerId: 'a', orgId: null }, log)).resolves.toEqual(new Map());
    const resolve = jest.fn(() => new Map());
    await list([{ id: 'billing', resolve }], async () => {
      await expect(resolveUserListExtensions([], { viewerId: 'a', orgId: null }, log)).resolves.toEqual(new Map());
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('calls each extension once with every id of the page (never per row) and merges per user', async () => {
    const billing = jest.fn(async (userIds: readonly string[]) => new Map(userIds.map((id) => [id, { plan: id === 'u2' ? 'free' : 'pro' }])));
    const team = jest.fn(() => new Map([['u1', { name: 'Core' }]]));
    await list(
      [
        { id: 'billing', resolve: billing },
        { id: 'team', resolve: team },
      ],
      async () => {
        const result = await resolveUserListExtensions(ids, { viewerId: 'admin', orgId: 'org-1' }, log);
        expect(result.get('u1')).toEqual({ billing: { plan: 'pro' }, team: { name: 'Core' } });
        expect(result.get('u2')).toEqual({ billing: { plan: 'free' } });
        expect(result.get('u3')).toEqual({ billing: { plan: 'pro' } });
      },
    );
    expect(billing).toHaveBeenCalledTimes(1);
    expect(team).toHaveBeenCalledTimes(1);
    expect(billing).toHaveBeenCalledWith(ids, expect.objectContaining({ viewerId: 'admin', orgId: 'org-1' }));
  });

  it('ignores an answer for a user that is not on the page', async () => {
    await list([{ id: 'billing', resolve: () => new Map([['stranger', { plan: 'secret-plan' }], ['u1', { plan: 'pro' }]]) }], async () => {
      const result = await resolveUserListExtensions(ids, { viewerId: 'a', orgId: null }, log);
      expect([...result.keys()]).toEqual(['u1']);
    });
  });

  it('skips an extension that throws, times out or does not answer a Map, and keeps the others', async () => {
    await list(
      [
        { id: 'broken', resolve: () => { throw new Error('boom'); } },
        { id: 'slow', timeoutMs: 20, resolve: () => new Promise(() => undefined) },
        { id: 'wrong', resolve: (() => ({ u1: { a: 1 } })) as never },
        { id: 'fine', resolve: () => new Map([['u1', { ok: true }]]) },
      ],
      async () => {
        const result = await resolveUserListExtensions(ids, { viewerId: 'a', orgId: null }, log);
        expect(result.get('u1')).toEqual({ fine: { ok: true } });
      },
    );
    const logged = log.warn.mock.calls.map(([m]) => m).join('\n');
    expect(logged).toContain('"broken"');
    expect(logged).toContain('"slow"');
    expect(logged).toContain('"wrong"');
  });

  it('skips only the row whose contribution is refused', async () => {
    await list(
      [
        {
          id: 'billing',
          resolve: () =>
            new Map<string, Record<string, unknown>>([
              ['u1', { plan: 'pro' }],
              ['u2', { password: 'hunter2' }],
              ['u3', { blob: 'x'.repeat(USER_EXTENSION_LIMITS.userListBytes + 1) }],
            ]),
        },
      ],
      async () => {
        const result = await resolveUserListExtensions(ids, { viewerId: 'a', orgId: null }, log);
        expect([...result.keys()]).toEqual(['u1']);
      },
    );
    expect(log.warn.mock.calls.map(([m]) => m).join('\n')).not.toContain('hunter2');
  });

  it('bounds the extensions of one row together', async () => {
    const chunk = 'x'.repeat(USER_EXTENSION_LIMITS.userListBytes - 50);
    const count = Math.floor(USER_EXTENSION_LIMITS.userListTotalBytes / USER_EXTENSION_LIMITS.userListBytes) + 1;
    const extensions = Array.from({ length: count }, (_, index) => ({ id: `ext-${index}`, resolve: () => new Map([['u1', { chunk }]]) }));
    await list(extensions, async () => {
      const result = await resolveUserListExtensions(ids, { viewerId: 'a', orgId: null }, log);
      expect(Object.keys(result.get('u1') ?? {}).length).toBe(count - 1);
    });
  });
});
