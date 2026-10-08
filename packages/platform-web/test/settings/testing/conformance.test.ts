import { describe, expect, it } from 'vitest';

import { settingsAiCardsSuite } from '../../../src/settings/testing/index.js';
import '../../../src/settings/testing/index.js';
import { runPlatformWebConformance, webConformanceSuites } from '../../../src/testing/index.js';
import type { WebConformanceCard, WebConformanceContext } from '../../../src/testing/index.js';
import { failingTests, recordingWebTestApi } from '../../support/web-conformance.js';

// Known-bad proofs for the web conformance suites: a healthy fixture app passes
// every suite, and each suite names the planted violation (and only it) when the
// app is broken. The suites run through the SAME `runPlatformWebConformance` an
// app calls, over a recording test API.

const Icon = () => null;

const card = (title: string, path: string | undefined, extra: Partial<WebConformanceCard> = {}): WebConformanceCard => ({
  title,
  description: `The ${title.toLowerCase()} page configures something worth reading about`,
  Icon,
  ...(path === undefined ? {} : { path }),
  ...extra,
});

/** A small, healthy app: two registries, an AI group, routes, destinations. */
function healthy(): WebConformanceContext {
  return {
    adminSections: [
      {
        label: 'General',
        cards: [
          card('Users', '/admin/settings/users', { permission: 'users:read' }),
          card('Email', '/admin/settings/email', { permission: 'system_settings:read' }),
        ],
      },
      {
        label: 'AI',
        cards: [
          card('AI', '/admin/settings/ai', { permission: 'ai_config:read' }),
          card('AI Models', '/admin/settings/ai/models', { permission: 'ai_config:read', feature: 'ai' }),
          card('AI Usage', '/admin/settings/ai/usage', { permission: 'ai_config:read', feature: 'ai' }),
          card('Organization AI keys', '/admin/settings/ai/organization-keys', { permission: 'org_ai_config:read', feature: 'ai' }),
        ],
      },
    ],
    userSettingsSections: [
      {
        label: 'Account',
        cards: [
          card('Profile', '/settings/profile'),
          card('AI Keys', '/settings/ai', { permission: 'ai:use', feature: 'ai' }),
        ],
      },
    ],
    hubs: { admin: { path: '/admin/settings', title: 'Admin' }, user: { path: '/settings', title: 'Settings' } },
    routes: [
      { path: '/', permission: null },
      { path: '/login', permission: null },
      { path: '/settings', permission: null },
      { path: '/settings/profile', permission: null },
      { path: '/settings/ai', permission: 'ai:use' },
      { path: '/admin', permission: null },
      { path: '/admin/settings', permission: ['users:read', 'system_settings:read'] },
      { path: '/admin/settings/users', permission: 'users:read' },
      { path: '/admin/settings/email', permission: 'system_settings:read' },
      { path: '/admin/settings/ai', permission: 'ai_config:read' },
      { path: '/admin/settings/ai/models', permission: 'ai_config:read' },
      { path: '/admin/settings/ai/usage', permission: 'ai_config:read' },
      { path: '/admin/settings/ai/organization-keys', permission: 'org_ai_config:read' },
    ],
    apiPermissions: [
      'users:read',
      'system_settings:read',
      'ai:use',
      'ai_config:read',
      'ai_config:write',
      'org_ai_config:read',
      'org_ai_config:write',
    ],
    destinations: {
      routes: { home: ['/'], settings: ['/settings'], console: ['/admin'] },
      unowned: ['/login'],
      owns: (prefix, path) => (prefix === '/' ? path === '/' : path === prefix || path.startsWith(`${prefix}/`)),
      resolveActive(pathname) {
        const owners = Object.entries(this.routes).filter(([, prefixes]) => prefixes.some((prefix) => this.owns(prefix, pathname)));
        return owners.length === 1 ? (owners[0] as [string, unknown])[0] : null;
      },
      destinations: [
        { key: 'home', path: '/' },
        { key: 'settings', path: '/settings' },
        { key: 'console', path: '/admin/settings' },
      ],
    },
  };
}

async function run(context: WebConformanceContext, suiteIds?: string[]): Promise<Array<{ name: string; message: string }>> {
  const { api, tests } = recordingWebTestApi();
  const skip = Object.fromEntries(
    webConformanceSuites
      .ids()
      .filter((id) => suiteIds !== undefined && !suiteIds.includes(id))
      .map((id) => [id, { skip: 'not under test here' }]),
  );
  runPlatformWebConformance({ ...context, suites: skip, testApi: api });
  return failingTests(tests);
}

const names = (failing: Array<{ name: string }>): string[] => failing.map((entry) => entry.name.split(' > ').slice(-2).join(' > '));

describe('the web settings suites on a healthy app', () => {
  it('register under their ids', () => {
    expect(webConformanceSuites.ids()).toEqual([
      'settings-registry-gates',
      'settings-registry-shape',
      'settings-ai-cards',
      'settings-card-routes',
      'settings-route-ownership',
    ]);
    expect(settingsAiCardsSuite.id).toBe('settings-ai-cards');
  });

  it('pass every case', async () => {
    expect(await run(healthy())).toEqual([]);
  });

  it('pass when the route table is the TEXT of the route file, parsed live', async () => {
    const appTsx = `
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/settings" element={<S />} />
        <Route path="/settings/profile" element={<P />} />
        <Route path="/settings/ai" element={<RequirePermission permission="ai:use"><A /></RequirePermission>} />
        <Route path="/admin" element={<Navigate to="/admin/settings" />} />
        <Route path="/admin/settings" element={<RequirePermission permissions={['users:read', 'system_settings:read']}><H /></RequirePermission>} />
        <Route path="/admin/settings/users" element={<RequirePermission permission="users:read"><U /></RequirePermission>} />
        <Route path="/admin/settings/email" element={<RequirePermission permission="system_settings:read"><E /></RequirePermission>} />
        <Route path="/admin/settings/ai" element={<RequirePermission permission="ai_config:read"><A /></RequirePermission>} />
        <Route path="/admin/settings/ai/models" element={<RequirePermission permission="ai_config:read"><M /></RequirePermission>} />
        <Route path="/admin/settings/ai/usage" element={<RequirePermission permission="ai_config:read"><U /></RequirePermission>} />
        <Route path="/admin/settings/ai/organization-keys" element={<RequirePermission permission="org_ai_config:read"><K /></RequirePermission>} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>`;

    expect(await run({ ...healthy(), routes: { appTsx } })).toEqual([]);
  });
});

describe('each suite fails on a planted violation, by name', () => {
  it('settings-card-routes: a card whose route is missing, and a card whose permission differs from its route’s', async () => {
    const context = healthy();
    context.routes = (context.routes as Array<{ path: string; permission?: unknown }>)
      .filter((route) => route.path !== '/admin/settings/ai/usage')
      .map((route) => (route.path === '/admin/settings/email' ? { ...route, permission: 'users:read' } : route)) as never;

    const failing = await run(context, ['settings-card-routes']);

    expect(names(failing)).toEqual(['the admin registry > routes every card path, under the exact permission the card declares']);
    expect(failing[0]?.message).toContain('AI Usage → /admin/settings/ai/usage has no route');
    expect(failing[0]?.message).toContain('Email → /admin/settings/email: card declares "system_settings:read", route gates "users:read"');
  });

  it('settings-card-routes: a card outside the destination that owns its hub', async () => {
    const context = healthy();
    context.adminSections[0]!.cards.push(card('Stray', '/admin/settings/stray', { permission: 'users:read' }));
    context.routes = [...(context.routes as Array<{ path: string; permission?: unknown }>), { path: '/admin/settings/stray', permission: 'users:read' }] as never;
    context.destinations!.routes = { ...context.destinations!.routes, console: ['/admin/settings/users', '/admin/settings/email', '/admin/settings/ai', '/admin'] };
    // /admin/settings/stray is still under /admin, so move the destination off it:
    context.destinations!.owns = (prefix, path) => (prefix === '/' ? path === '/' : (path === prefix || path.startsWith(`${prefix}/`)) && path !== '/admin/settings/stray');

    const failing = await run(context, ['settings-card-routes']);

    expect(failing.map((entry) => entry.message).join('\n')).toContain('/admin/settings/stray activates null');
  });

  it('settings-route-ownership: a route claimed by two destinations, one claimed by none, and an unowned route that activates something', async () => {
    const context = healthy();
    context.destinations!.routes = { home: ['/', '/settings/profile'], settings: ['/settings'], console: ['/admin'] };
    context.routes = [...(context.routes as Array<{ path: string }>), { path: '/orphan' }] as never;
    context.destinations!.unowned = ['/login', '/settings'];

    const failing = await run(context, ['settings-route-ownership']);
    const message = failing.map((entry) => entry.message).join('\n');

    expect(names(failing)).toContain('destinations: route ownership > claims every route exactly once, or deliberately not at all');
    expect(message).toContain('/orphan should be owned by exactly one destination, owners: []');
    expect(message).toContain('/settings is listed as unowned but settings claims it');
    expect(message).toContain('/orphan is neither owned by a destination nor listed as unowned');
  });

  it('settings-route-ownership: a prefix match that ignores segment boundaries', async () => {
    const context = healthy();
    context.destinations!.owns = (prefix, path) => (prefix === '/' ? path === '/' : path.startsWith(prefix));

    const failing = await run(context, ['settings-route-ownership']);

    expect(names(failing)).toContain('destinations: route ownership > matches a prefix only at a segment boundary');
  });

  it('settings-route-ownership: refuses to run without a destination table unless the app skips it', () => {
    const context = healthy();
    delete context.destinations;

    expect(() => runPlatformWebConformance({ ...context, testApi: recordingWebTestApi().api })).toThrow('passed no `destinations`');
  });

  it('settings-registry-shape: an invented permission, a card outside its hub, a duplicate route, a half-declared inert card', async () => {
    const context = healthy();
    context.adminSections[0]!.cards.push(
      card('Invented', '/admin/settings/invented', { permission: 'made:up' }),
      card('Outside', '/somewhere/else'),
      card('Twin', '/admin/settings/users'),
      card('Half', '/admin/settings/half', { disabled: true }),
      card('Never', undefined),
    );

    const failing = await run(context, ['settings-registry-shape']);

    expect(names(failing)).toEqual([
      'the admin registry > routes every card under the hub, and none outside it',
      'the admin registry > keeps `disabled` and `path` coupled: a card declared ahead of its page has no route, a routed card is not inert',
      'the admin registry > declares each route once',
      'the admin registry > declares only permissions the API enforces: every `permission` is in the generated catalog, none invented',
    ]);
    const byName = Object.fromEntries(failing.map((entry) => [entry.name.split(' > ').slice(-1)[0], entry.message]));
    expect(byName['declares only permissions the API enforces: every `permission` is in the generated catalog, none invented']).toContain('Invented: "made:up"');
    expect(byName['declares each route once']).toContain('/admin/settings/users: Users and Twin');
  });

  it('settings-registry-shape: a card whose icon is a rendered element, and an empty section', async () => {
    const context = healthy();
    context.userSettingsSections[0]!.cards.push({ ...card('Rendered', '/settings/rendered'), Icon: { type: 'svg', props: {} } });
    context.userSettingsSections.push({ label: 'Empty', cards: [] });

    const failing = await run(context, ['settings-registry-shape']);

    expect(names(failing)).toEqual([
      'the user registry > gives every section a label and at least one card',
      'the user registry > gives every card a title, a description and an icon component (never a rendered element)',
    ]);
  });

  it('settings-ai-cards: an AI card with no feature, one on alwaysShow, an admin card on ai:use, the switch gated, a user card on a deployment permission', async () => {
    const context = healthy();
    const ai = context.adminSections[1] as { cards: WebConformanceCard[] };
    ai.cards[1] = card('AI Models', '/admin/settings/ai/models', { permission: 'ai_config:read' });
    ai.cards[2] = card('AI Usage', '/admin/settings/ai/usage', { permission: 'ai:use', feature: 'ai', alwaysShow: true });
    ai.cards[0] = card('AI', '/admin/settings/ai', { permission: 'ai_config:read', feature: 'ai' });
    context.userSettingsSections[0]!.cards[1] = card('AI Keys', '/settings/ai', { permission: 'ai_config:read', feature: 'ai' });

    const failing = await run(context, ['settings-ai-cards']);
    const byName = Object.fromEntries(failing.map((entry) => [entry.name.split(' > ').slice(-1)[0], entry.message]));

    expect(byName['every AI-tagged card declares feature "ai", except the admin AI card itself']).toContain('AI Models');
    expect(byName['every AI card is deniable: none is an alwaysShow escape hatch']).toContain('AI Usage');
    expect(byName['is never confused with ai:use: an admin AI card must not mirror the per-user permission']).toContain('AI Usage');
    expect(byName['the admin AI card (the switch itself) deliberately carries no feature gate']).toBeDefined();
    expect(byName['declares exactly ai:use, the string the per-user AI routes enforce']).toContain('AI Keys');
    expect(byName['is never confused with ai_config:*: a per-user card must not mirror a deployment-wide permission']).toContain('AI Keys');
  });

  it('settings-ai-cards: a permission no AI route enforces (x-rbac), and one the catalog does not know', async () => {
    const context = healthy();
    context.openApiDocument = {
      paths: {
        '/api/admin/ai/config': { get: { 'x-rbac': { permissions: ['ai_config:read'] } } },
        '/api/ai/responses': { post: { 'x-rbac': { permissions: ['ai:use'] } } },
      },
    };
    context.adminSections[1]!.cards.push(card('AI Extra', '/admin/settings/ai/extra', { permission: 'ai_config:write', feature: 'ai' }));
    context.apiPermissions = context.apiPermissions.filter((permission) => permission !== 'org_ai_config:write');

    const failing = await run(context, ['settings-ai-cards']);
    const byName = Object.fromEntries(failing.map((entry) => [entry.name.split(' > ').slice(-1)[0], entry.message]));

    expect(byName['declares permissions that routes of the AI surface really enforce (x-rbac), when the OpenAPI document is given']).toContain(
      'AI Extra: ai_config:write',
    );
    expect(byName['knows the AI permissions the cards are checked against, so a broken catalog import cannot pass vacuously']).toContain('org_ai_config:write');
  });

  it('settings-ai-cards: an AI card the registry forgot to find (a broken discovery cannot pass vacuously)', async () => {
    const context = healthy();
    context.adminSections.splice(1, 1);

    const failing = await run(context, ['settings-ai-cards']);

    expect(names(failing)).toContain('AI settings cards: permission parity with the API, and feature gating > finds the AI-tagged cards at all, so a broken discovery cannot pass vacuously');
  });
});
