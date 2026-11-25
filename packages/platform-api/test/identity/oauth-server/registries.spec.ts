// The OAuth scope and protected-resource registries (PP-15.3, #1181): id rules,
// the built-in offline_access scope, and every boot error the issue names
// (unknown permission, overlapping prefixes, forbidden prefixes).
import { Logger } from '@nestjs/common';

import { RegistryError, withTemporaryEntries } from '../../../src/core/index';
import {
  FORBIDDEN_OAUTH_ROUTE_PREFIXES,
  availableScopes,
  OFFLINE_ACCESS_SCOPE,
  findOAuthRegistryProblems,
  oauthResourceRegistry,
  oauthScopeRegistry,
  permissionsOfScopes,
  resourceForPath,
  type OAuthProtectedResourceDefinition,
  type OAuthScopeDefinition,
} from '../../../src/identity/index';
import { OAuthRegistryBootstrapCheck } from '../../../src/identity/oauth-server/oauth-server.module';

const scope = (over: Partial<OAuthScopeDefinition> = {}): OAuthScopeDefinition => ({
  id: 'items:read',
  title: 'Read items',
  description: 'See the items you can see.',
  permissions: ['items:read'],
  risk: 'low',
  default: true,
  ...over,
});

const resource = (over: Partial<OAuthProtectedResourceDefinition> = {}): OAuthProtectedResourceDefinition => ({
  id: 'items',
  path: '/api/items-agent',
  routePrefixes: ['/api/items-agent'],
  scopes: ['items:read'],
  name: 'Items agent',
  ...over,
});

describe('OAuth scope registry', () => {
  it('has the built-in offline_access scope with no permissions', () => {
    expect(oauthScopeRegistry.get(OFFLINE_ACCESS_SCOPE)).toMatchObject({ id: 'offline_access', permissions: [], risk: 'low' });
  });

  it.each(['notes:read', 'runs', 'a_b:c_d', 'x1:y2'])('accepts the id %s', async (id) => {
    await withTemporaryEntries(oauthScopeRegistry, [scope({ id })], () => {
      expect(oauthScopeRegistry.has(id)).toBe(true);
    });
  });

  it.each(['Notes:read', '1notes', 'notes:', ':read', 'a:b:c', 'notes read', `a${'b'.repeat(64)}`])('refuses the id %s', async (id) => {
    await expect(withTemporaryEntries(oauthScopeRegistry, [scope({ id })], () => undefined)).rejects.toBeInstanceOf(RegistryError);
  });

  it('refuses a bad risk, a blank title and a repeated permission', async () => {
    for (const bad of [scope({ risk: 'wild' as never }), scope({ title: ' ' }), scope({ permissions: ['a:b', 'a:b'] })]) {
      await expect(withTemporaryEntries(oauthScopeRegistry, [bad], () => undefined)).rejects.toBeInstanceOf(RegistryError);
    }
  });

  it('refuses a duplicate id', async () => {
    await expect(withTemporaryEntries(oauthScopeRegistry, [scope(), scope()], () => undefined)).rejects.toMatchObject({ code: 'DUPLICATE_ID' });
  });

  it('computes the union of the permissions of the scopes, ignoring an unregistered scope', async () => {
    await withTemporaryEntries(oauthScopeRegistry, [scope({ permissions: ['a:read', 'b:read'] }), scope({ id: 'x:write', permissions: ['b:read', 'x:write'] })], () => {
      expect(permissionsOfScopes(['items:read', 'x:write', 'gone:scope', 'offline_access']).sort()).toEqual(['a:read', 'b:read', 'x:write']);
      expect(permissionsOfScopes([])).toEqual([]);
    });
  });
});

describe('OAuth protected-resource registry', () => {
  it('registers a resource and finds it by path: exactly the prefix or beneath it', async () => {
    await withTemporaryEntries(oauthResourceRegistry, [resource()], () => {
      expect(resourceForPath('/api/items-agent')?.id).toBe('items');
      expect(resourceForPath('/api/items-agent/run/1')?.id).toBe('items');
      // not a bare startsWith
      expect(resourceForPath('/api/items-agentX')).toBeUndefined();
      expect(resourceForPath('/api/items-agent-other')).toBeUndefined();
      expect(resourceForPath('/api/items')).toBeUndefined();
      expect(resourceForPath('/')).toBeUndefined();
    });
  });

  it.each(['/api/oauth', '/api/oauth/token', '/api/auth', '/api/auth/me', '/api/nodes', '/api/nodes/1/jobs', '/api'])(
    'refuses the forbidden or covering prefix %s',
    async (prefix) => {
      await expect(withTemporaryEntries(oauthResourceRegistry, [resource({ routePrefixes: [prefix] })], () => undefined)).rejects.toBeInstanceOf(RegistryError);
    },
  );

  it('lists the three forbidden prefixes', () => {
    expect([...FORBIDDEN_OAUTH_ROUTE_PREFIXES].sort()).toEqual(['/api/auth', '/api/nodes', '/api/oauth']);
  });

  it('refuses a second resource that shares or nests a prefix, in either order, and names both', async () => {
    // One `registerOAuthProtectedResource` call at a time, as an app registers them
    // (a `registerAll` batch is validated against the registry as it was before the batch).
    const second = (first: OAuthProtectedResourceDefinition, next: OAuthProtectedResourceDefinition) =>
      withTemporaryEntries(oauthResourceRegistry, [first], () => withTemporaryEntries(oauthResourceRegistry, [next], () => undefined));
    await expect(second(resource(), resource({ id: 'items2', routePrefixes: ['/api/items-agent'] }))).rejects.toThrow(/overlaps.*items/);
    await expect(second(resource(), resource({ id: 'items2', routePrefixes: ['/api/items-agent/deep'] }))).rejects.toBeInstanceOf(RegistryError);
    await expect(second(resource({ routePrefixes: ['/api/items-agent/deep'] }), resource({ id: 'items2', routePrefixes: ['/api/items-agent'] }))).rejects.toBeInstanceOf(
      RegistryError,
    );
  });

  it('refuses overlapping prefixes inside one resource, a trailing slash, a dot segment and no prefix', async () => {
    for (const bad of [
      resource({ routePrefixes: ['/api/a', '/api/a/b'] }),
      resource({ routePrefixes: ['/api/a/'] }),
      resource({ routePrefixes: ['/api/../auth'] }),
      resource({ routePrefixes: [] }),
      resource({ scopes: [] }),
      resource({ path: 'api/x' }),
    ]) {
      await expect(withTemporaryEntries(oauthResourceRegistry, [bad], () => undefined)).rejects.toBeInstanceOf(RegistryError);
    }
  });

  it('allows two resources on sibling prefixes', async () => {
    await withTemporaryEntries(oauthResourceRegistry, [resource()], () =>
      withTemporaryEntries(oauthResourceRegistry, [resource({ id: 'other', routePrefixes: ['/api/other-agent'] })], () => {
        expect(resourceForPath('/api/other-agent/x')?.id).toBe('other');
        expect(resourceForPath('/api/items-agent/x')?.id).toBe('items');
      }),
    );
  });
});

describe('cross-registry boot checks', () => {
  const known = (ids: string[]) => (id: string) => ids.includes(id);

  it('reports a scope naming an unregistered permission, naming the scope', async () => {
    await withTemporaryEntries(oauthScopeRegistry, [scope({ id: 'ghost:read', permissions: ['ghost:read'] })], () => {
      const problems = findOAuthRegistryProblems(known([]));
      expect(problems).toContainEqual(expect.objectContaining({ kind: 'scope', id: 'ghost:read', message: expect.stringContaining('ghost:read') }));
      expect(findOAuthRegistryProblems(known(['ghost:read']))).toEqual([]);
    });
  });

  it('reports a resource naming an unregistered scope or with no default scope', async () => {
    await withTemporaryEntries(oauthScopeRegistry, [scope({ default: false })], async () => {
      await withTemporaryEntries(oauthResourceRegistry, [resource({ scopes: ['items:read', 'nope:read'] })], () => {
        const messages = findOAuthRegistryProblems(known(['items:read'])).map((p) => p.message);
        expect(messages).toEqual(
          expect.arrayContaining([expect.stringContaining('unregistered scope "nope:read"'), expect.stringContaining('no scope with default: true')]),
        );
      });
    });
  });

  it('accepts offline_access on any resource', async () => {
    await withTemporaryEntries(oauthScopeRegistry, [scope()], async () => {
      await withTemporaryEntries(oauthResourceRegistry, [resource({ scopes: ['items:read', 'offline_access'] })], () => {
        expect(findOAuthRegistryProblems(known(['items:read']))).toEqual([]);
      });
    });
  });

  it('the module bootstrap check stops the application, naming the scope', async () => {
    await withTemporaryEntries(oauthScopeRegistry, [scope({ id: 'ghost:read', permissions: ['ghost:read'] })], () => {
      expect(() => new OAuthRegistryBootstrapCheck().onModuleInit()).toThrow(/OAuth scope "ghost:read" names the unregistered permission "ghost:read"/);
    });
    expect(() => new OAuthRegistryBootstrapCheck().onModuleInit()).not.toThrow();
  });
});

describe('OAuth scope availability', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  const SECRET_USER = 'user-secret-123';
  const SECRET_ORG = 'org-secret-456';
  const withScopes = <T>(entries: OAuthScopeDefinition[], fn: () => Promise<T>) => withTemporaryEntries(oauthScopeRegistry, entries, fn) as Promise<T>;

  it.each([['a string', 'yes'], ['true', true], ['an object', {}]])('refuses an available that is %s at register time', async (_label, bad) => {
    await expect(withTemporaryEntries(oauthScopeRegistry, [scope({ available: bad as never })], () => undefined)).rejects.toBeInstanceOf(RegistryError);
  });

  it('accepts a sync and an async predicate at register time', async () => {
    await withScopes([scope({ id: 'a:one', available: () => true }), scope({ id: 'a:two', available: async () => true })], async () => {
      expect(oauthScopeRegistry.has('a:one')).toBe(true);
      expect(oauthScopeRegistry.has('a:two')).toBe(true);
    });
  });

  it('keeps the order of the ids it is given and drops a scope whose predicate says false', async () => {
    await withScopes(
      [scope({ id: 'a:one', available: () => true }), scope({ id: 'b:two', available: () => false }), scope({ id: 'c:three', available: async () => true })],
      async () => {
        expect(await availableScopes(['c:three', 'b:two', 'a:one'], {})).toEqual(['c:three', 'a:one']);
        expect(warn).not.toHaveBeenCalled();
      },
    );
  });

  it('counts only a literal true as available', async () => {
    await withScopes(
      [
        scope({ id: 'a:truthy', available: (() => 1) as never }),
        scope({ id: 'b:string', available: (() => 'true') as never }),
        scope({ id: 'c:undef', available: (() => undefined) as never }),
        scope({ id: 'd:yes', available: () => true }),
      ],
      async () => {
        expect(await availableScopes(['a:truthy', 'b:string', 'c:undef', 'd:yes'], {})).toEqual(['d:yes']);
      },
    );
  });

  it('drops a scope whose predicate throws, with one warning naming the scope and no context values', async () => {
    await withScopes(
      [
        scope({ id: 'a:boom', available: () => { throw new Error('predicate exploded'); } }),
        scope({ id: 'b:ok', available: () => true }),
      ],
      async () => {
        expect(await availableScopes(['a:boom', 'b:ok'], { userId: SECRET_USER, orgId: SECRET_ORG })).toEqual(['b:ok']);
        expect(warn).toHaveBeenCalledTimes(1);
        const message = String(warn.mock.calls[0]![0]);
        expect(message).toContain('a:boom');
        expect(message).not.toContain('b:ok');
        expect(message).not.toContain(SECRET_USER);
        expect(message).not.toContain(SECRET_ORG);
        expect(message).not.toContain('predicate exploded');
      },
    );
  });

  it('drops a scope whose predicate rejects, with one warning naming the scope and no context values', async () => {
    await withScopes([scope({ id: 'a:reject', available: async () => { throw new Error('nope'); } })], async () => {
      expect(await availableScopes(['a:reject'], { userId: SECRET_USER, orgId: SECRET_ORG })).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]![0]);
      expect(message).toContain('a:reject');
      expect(message).not.toContain(SECRET_USER);
      expect(message).not.toContain(SECRET_ORG);
    });
  });

  it('writes ONE warning per call for several failing scopes, naming each', async () => {
    await withScopes(
      [scope({ id: 'a:x', available: () => { throw new Error('1'); } }), scope({ id: 'b:y', available: async () => { throw new Error('2'); } })],
      async () => {
        expect(await availableScopes(['a:x', 'b:y'], {})).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]![0])).toMatch(/a:x.*b:y/);
      },
    );
  });

  it('passes unregistered ids, scopes without a predicate and offline_access through', async () => {
    await withScopes([scope({ id: 'a:plain' }), scope({ id: 'b:off', available: () => false })], async () => {
      expect(oauthScopeRegistry.get(OFFLINE_ACCESS_SCOPE)?.available).toBeUndefined();
      expect(await availableScopes(['gone:scope', 'b:off', 'a:plain', OFFLINE_ACCESS_SCOPE], {})).toEqual(['gone:scope', 'a:plain', OFFLINE_ACCESS_SCOPE]);
      expect(await availableScopes([], {})).toEqual([]);
    });
  });

  it('hands the exact context to the predicate, and an async predicate is awaited', async () => {
    const seen = jest.fn(async (_ctx: unknown) => true);
    await withScopes([scope({ id: 'a:ctx', available: seen })], async () => {
      const ctx = { userId: 'u-1', orgId: 'o-1' };
      expect(await availableScopes(['a:ctx'], ctx)).toEqual(['a:ctx']);
      expect(seen).toHaveBeenCalledWith(ctx);
      await availableScopes(['a:ctx'], {});
      expect(seen).toHaveBeenLastCalledWith({});
      await availableScopes(['a:ctx'], { userId: 'u-1', orgId: null });
      expect(seen).toHaveBeenLastCalledWith({ userId: 'u-1', orgId: null });
    });
  });

  it('can depend on the context (true for one org, false for another)', async () => {
    await withScopes([scope({ id: 'a:org', available: (ctx) => ctx.orgId === 'org-a' })], async () => {
      expect(await availableScopes(['a:org'], { orgId: 'org-a' })).toEqual(['a:org']);
      expect(await availableScopes(['a:org'], { orgId: 'org-b' })).toEqual([]);
      expect(await availableScopes(['a:org'], {})).toEqual([]);
    });
  });

  it('leaves permissionsOfScopes synchronous and unchanged by a predicate', async () => {
    await withScopes([scope({ id: 'a:off', permissions: ['a:read'], available: () => false })], async () => {
      const permissions = permissionsOfScopes(['a:off']);
      expect(Array.isArray(permissions)).toBe(true);
      expect(permissions).toEqual(['a:read']);
    });
  });

  it('does not leak a temporary scope out of the registry', () => {
    expect(oauthScopeRegistry.has('a:one')).toBe(false);
    expect(oauthScopeRegistry.has('a:org')).toBe(false);
  });
});
