import { describe, expect, it, vi } from 'vitest';

import { runPlatformWebConformance } from '../../../src/testing/index.js';
import '../../../src/settings/testing/index.js';
import { failingTests, recordingWebTestApi } from '../../support/web-conformance.js';

// Known-bad proof for `settings-registry-gates`: the suite checks the REAL
// `visibleSettingsSections` and `settingsPageTitle`, so it can only fail if one
// of them is wrong. Here the module is replaced by a gate that forgets the
// feature axis and a title resolver that ignores segment boundaries, and the
// suite must name both.

vi.mock('../../../src/settings/ui/registry.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/settings/ui/registry.js')>();

  return {
    ...original,
    // Forgets the feature gate: shows every feature card whatever the map says.
    visibleSettingsSections: (
      sections: Parameters<typeof original.visibleSettingsSections>[0],
      hasPermission: (permission: string) => boolean,
      query = '',
    ) => original.visibleSettingsSections(sections, hasPermission, query, { ai: true }),
    // A bare `startsWith` on the card path: `/x-archive` is titled after `/x`.
    settingsPageTitle: (
      sections: Parameters<typeof original.settingsPageTitle>[0],
      hubPath: string,
      hubTitle: string,
      pathname: string,
    ) => {
      if (pathname !== hubPath && !pathname.startsWith(`${hubPath}/`)) return null;
      let best: { title: string; length: number } | null = null;
      for (const section of sections) {
        for (const card of section.cards) {
          if (card.path && pathname.startsWith(card.path) && (!best || card.path.length > best.length)) {
            best = { title: card.title, length: card.path.length };
          }
        }
      }
      return best?.title ?? hubTitle;
    },
  };
});

const Icon = () => null;

describe('the gate suite fails when the shared gate is broken', () => {
  it('names the fixture and registry cases that a gate without the feature axis and with bare-prefix titles breaks', async () => {
    const { api, tests } = recordingWebTestApi();
    const card = (title: string, path: string, extra = {}) => ({ title, description: `${title} page text`, Icon, path, ...extra });

    runPlatformWebConformance({
      adminSections: [
        { label: 'General', cards: [card('Users', '/admin/settings/users', { permission: 'users:read' })] },
        { label: 'AI', cards: [card('AI', '/admin/settings/ai', { permission: 'ai_config:read', feature: 'ai' })] },
      ],
      userSettingsSections: [{ label: 'Account', cards: [card('Profile', '/settings/profile')] }],
      hubs: { admin: { path: '/admin/settings', title: 'Admin' }, user: { path: '/settings', title: 'Settings' } },
      routes: [],
      apiPermissions: ['users:read', 'ai_config:read'],
      suites: Object.fromEntries(
        ['settings-registry-shape', 'settings-ai-cards', 'settings-card-routes', 'settings-route-ownership'].map((id) => [id, { skip: 'not under test here' }]),
      ),
      testApi: api,
    });

    const failing = (await failingTests(tests)).map((entry) => entry.name.split(' > ').slice(-2).join(' > '));

    expect(failing).toEqual(
      expect.arrayContaining([
        'feature gating (fixture) > hides feature cards when no feature map is passed (fail closed)',
        'the admin registry > hides a card whose feature is off even when every permission is held',
        'the admin registry > respects segment boundaries: a path that only starts with a card path is not that card',
      ]),
    );
  });
});
