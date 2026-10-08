// =============================================================================
// Suite: the settings registries' shared gate (issues #91, #425, #742)
// =============================================================================
//
// `visibleSettingsSections` and `settingsPageTitle` are the ONE gate every
// consumer (the hub, the Console rail, the AppBar title) runs over the app's own
// registries. A bug here is a bug in three surfaces at once, and this suite makes
// that provable with one assertion per behaviour instead of three near-identical
// component tests.
//
// It runs two ways, as the reference app's `settingsRegistry.test.ts` did:
//
//   - against a small FIXTURE, for the cases that need independent control over
//     `permission`, `alwaysShow` and `feature` (no real registry has an
//     undeniable card);
//   - against the app's REAL registries, for the cases that are about the real
//     data. The reference app asserted literal titles ("Email", "Jobs",
//     "Job Insights"); here every expectation is DERIVED from the registry it is
//     given, so the same cases run in any app: pick a card, probe its path, ask
//     what the gate says, compare with an independent reference implementation
//     of "longest prefix on a segment boundary".
//
// What stayed in the reference app is what is about ITS cards (which group the
// Broadcasts card lives in, which permission the Storage card declares): those
// are its own data, not an invariant of the platform.
// =============================================================================

import type { WebConformanceCard, WebConformanceContext, WebConformanceTestApi } from '../../testing/index.js';
import { webConformanceSuites } from '../../testing/index.js';
import { settingsPageTitle, visibleSettingsSections } from '../ui/registry.js';
import type { SettingsSectionDef } from '../ui/registry.js';
import { asSections, cardsOf, registriesOf, titlesOf } from './sections.js';
import type { RegistryUnderTest } from './sections.js';

/** A stand-in for an icon component: only its identity is ever asserted. */
const Icon = (() => null) as unknown as SettingsSectionDef['cards'][number]['Icon'];

function permissionFixture(): SettingsSectionDef[] {
  return [
    {
      label: 'Alpha',
      cards: [
        { title: 'Open Card', description: 'visible to anyone, no gate', Icon, path: '/x/open' },
        { title: 'Gated Card', description: 'needs a permission the fixture can deny', Icon, path: '/x/gated', permission: 'alpha:read' },
        {
          title: 'Bypass Card',
          description: 'gated, but escapes the gate via alwaysShow',
          Icon,
          path: '/x/bypass',
          permission: 'alpha:write',
          alwaysShow: true,
        },
      ],
    },
    {
      label: 'Beta (fully gated)',
      cards: [
        { title: 'Beta Only', description: 'the only card in its section, and it is gated', Icon, path: '/x/beta', permission: 'beta:read' },
      ],
    },
  ];
}

function featureFixture(): SettingsSectionDef[] {
  return [
    {
      label: 'Mixed',
      cards: [
        { title: 'Plain', description: 'no gate', Icon, path: '/f/plain' },
        { title: 'Featured', description: 'ai only', Icon, path: '/f/featured', feature: 'ai' },
        { title: 'Forced', description: 'alwaysShow does not beat a feature', Icon, path: '/f/forced', alwaysShow: true, feature: 'ai' },
      ],
    },
    { label: 'Only Featured', cards: [{ title: 'Lonely', description: 'ai only', Icon, path: '/f/lonely', feature: 'ai' }] },
  ];
}

/**
 * The title `settingsPageTitle` must give a path: the card with the LONGEST
 * path that is the pathname or a segment-boundary prefix of it, among the
 * cards whose feature is on; the hub title when under the hub and none
 * matches; `null` outside the hub. An independent reference implementation.
 */
function expectedTitle(
  registry: RegistryUnderTest,
  pathname: string,
  features: Readonly<Record<string, boolean>>,
): string | null {
  if (pathname !== registry.hubPath && !pathname.startsWith(`${registry.hubPath}/`)) return null;

  let best: WebConformanceCard | undefined;
  for (const card of cardsOf(registry.sections)) {
    if (!card.path) continue;
    if (card.feature !== undefined && features[card.feature] !== true) continue;
    const claims = pathname === card.path || pathname.startsWith(`${card.path}/`);
    if (claims && (best === undefined || card.path.length > (best.path ?? '').length)) best = card;
  }

  return best?.title ?? registry.hubTitle;
}

/** A word (4+ letters) of some description that appears in no card title, or `undefined`. */
function descriptionOnlyWord(cards: readonly WebConformanceCard[]): string | undefined {
  const titles = cards.map((card) => card.title.toLowerCase());
  for (const card of cards) {
    for (const word of card.description.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
      if (!titles.some((title) => title.includes(word))) return word;
    }
  }
  return undefined;
}

const hold = (...granted: string[]) => (permission: string) => granted.includes(permission);

function register(api: WebConformanceTestApi, context: WebConformanceContext): void {
  const { describe, it, expect } = api;

  describe('visibleSettingsSections and settingsPageTitle: the gate the hub, the rail and the AppBar all run', () => {
    describe('permission gating (fixture)', () => {
      it('drops a card whose permission is not held', () => {
        expect(titlesOf(visibleSettingsSections(permissionFixture(), () => false)).includes('Gated Card')).toEqual(false);
      });

      it('removes a section entirely once every one of its cards is filtered out, rather than rendering it empty', () => {
        // 'Beta Only' is the section's sole card and is gated: with every
        // permission denied the section must disappear, not survive as a header
        // over zero cards, which reads as a loading failure.
        const result = visibleSettingsSections(permissionFixture(), () => false);

        expect(result.find((section) => section.label === 'Beta (fully gated)')).toEqual(undefined);
      });

      it('lets alwaysShow bypass the permission gate', () => {
        expect(titlesOf(visibleSettingsSections(permissionFixture(), () => false)).includes('Bypass Card')).toEqual(true);
      });

      it('shows a card with no permission declared regardless of what hasPermission answers', () => {
        expect(titlesOf(visibleSettingsSections(permissionFixture(), () => false)).includes('Open Card')).toEqual(true);
      });

      it('composes search with permission gating: a title match the user lacks permission for stays hidden', () => {
        // Search narrows what is ELIGIBLE to show; it never re-opens a closed gate.
        expect(visibleSettingsSections(permissionFixture(), () => false, 'gated')).toEqual([]);
      });
    });

    describe('feature gating (fixture)', () => {
      it('hides feature cards when no feature map is passed (fail closed)', () => {
        expect(titlesOf(visibleSettingsSections(featureFixture(), () => true))).toEqual(['Plain']);
      });

      it('drops a section emptied by the feature gate', () => {
        const result = visibleSettingsSections(featureFixture(), () => true, '', { ai: false });

        expect(result.map((section) => section.label)).toEqual(['Mixed']);
      });

      it('shows feature cards when the feature is on, alwaysShow or not', () => {
        const result = visibleSettingsSections(featureFixture(), () => true, '', { ai: true });

        expect(titlesOf(result)).toEqual(['Plain', 'Featured', 'Forced', 'Lonely']);
      });
    });

    for (const registry of registriesOf(context)) {
      const sections = asSections(registry.sections);
      const cards = cardsOf(registry.sections);

      describe(`the ${registry.name} registry`, () => {
        it('finds cards at all, so a broken registry import cannot pass vacuously', () => {
          expect(cards.length).toBeGreaterThanOrEqual(1);
        });

        it('shows exactly the cards that declare no permission and no feature (plus alwaysShow ones) when nothing is held', () => {
          const shown = titlesOf(visibleSettingsSections(sections, () => false));
          const ungated = cards
            .filter((card) => card.feature === undefined)
            .filter((card) => card.alwaysShow === true || card.permission === undefined || card.permission === '')
            .map((card) => card.title);

          expect([...shown].sort()).toEqual([...ungated].sort());
        });

        it('shows every card once every permission is held and every feature is on', () => {
          const features = Object.fromEntries(cards.flatMap((card) => (card.feature ? [[card.feature, true]] : [])));
          const shown = titlesOf(visibleSettingsSections(sections, () => true, '', features));

          expect([...shown].sort()).toEqual(titlesOf(registry.sections).sort());
        });

        it('hides a card whose feature is off even when every permission is held', () => {
          const featured = cards.filter((card) => card.feature !== undefined);
          const shown = titlesOf(visibleSettingsSections(sections, () => true, ''));

          expect(featured.filter((card) => shown.includes(card.title)).map((card) => card.title)).toEqual([]);
        });

        it('matches a card title case-insensitively', () => {
          const target = cards[0] as WebConformanceCard;
          const mixed = target.title.replace(/./g, (char, index) => (index % 2 === 0 ? char.toLowerCase() : char.toUpperCase()));
          const features = Object.fromEntries(cards.flatMap((card) => (card.feature ? [[card.feature, true]] : [])));
          const shown = titlesOf(visibleSettingsSections(sections, () => true, mixed, features));

          expect(shown.includes(target.title)).toEqual(true);
        });

        it('does not match a term that appears only in a description, never in a title', () => {
          // Matching descriptions too would surface cards on prose the user never
          // sees highlighted: the worse, unpredictable result set the title-only
          // design avoids.
          const word = descriptionOnlyWord(cards);
          if (word === undefined) return; // every description word is also in some title: nothing to probe

          expect(titlesOf(visibleSettingsSections(sections, () => true, word, { ai: true }))).toEqual([]);
        });

        it('treats an empty and a whitespace-only query the same as no query at all', () => {
          const hasPermission = hold('alpha:read');

          expect(visibleSettingsSections(sections, hasPermission, '')).toEqual(visibleSettingsSections(sections, hasPermission));
          expect(visibleSettingsSections(sections, hasPermission, '   ')).toEqual(visibleSettingsSections(sections, hasPermission));
        });

        it('titles every card route with its own card, and every child of it too (longest prefix wins)', () => {
          const failures: string[] = [];
          const features = Object.fromEntries(cards.flatMap((card) => (card.feature ? [[card.feature, true]] : [])));

          for (const card of cards) {
            if (!card.path) continue;
            for (const probe of [card.path, `${card.path}/child`, `${card.path}/child/deeper`]) {
              const got = settingsPageTitle(sections, registry.hubPath, registry.hubTitle, probe, features);
              const want = expectedTitle(registry, probe, features);
              if (got !== want) failures.push(`${probe}: titled ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
            }
          }

          expect(failures).toEqual([]);
        });

        it('respects segment boundaries: a path that only starts with a card path is not that card', () => {
          const failures: string[] = [];
          const features = Object.fromEntries(cards.flatMap((card) => (card.feature ? [[card.feature, true]] : [])));

          for (const card of cards) {
            if (!card.path) continue;
            const probe = `${card.path}-archive`;
            const got = settingsPageTitle(sections, registry.hubPath, registry.hubTitle, probe, features);
            const want = expectedTitle(registry, probe, features);
            if (got !== want) failures.push(`${probe}: titled ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
          }

          expect(failures).toEqual([]);
        });

        it('gives a nested card route the nested card’s title, not its parent’s', () => {
          const failures: string[] = [];
          const features = Object.fromEntries(cards.flatMap((card) => (card.feature ? [[card.feature, true]] : [])));

          for (const parent of cards) {
            for (const child of cards) {
              if (!parent.path || !child.path || !child.path.startsWith(`${parent.path}/`)) continue;
              const got = settingsPageTitle(sections, registry.hubPath, registry.hubTitle, child.path, features);
              if (got !== child.title) failures.push(`${child.path} (nested under ${parent.path}): titled ${JSON.stringify(got)}, expected ${JSON.stringify(child.title)}`);
            }
          }

          expect(failures).toEqual([]);
        });

        it('titles a feature card’s route by its parent only while the feature is off', () => {
          const failures: string[] = [];

          for (const card of cards) {
            if (!card.path || card.feature === undefined) continue;
            const on = settingsPageTitle(sections, registry.hubPath, registry.hubTitle, card.path, { [card.feature]: true });
            const off = settingsPageTitle(sections, registry.hubPath, registry.hubTitle, card.path);
            if (on !== expectedTitle(registry, card.path, { [card.feature]: true })) failures.push(`${card.path} with ${card.feature} on: ${JSON.stringify(on)}`);
            if (off !== expectedTitle(registry, card.path, {})) failures.push(`${card.path} with ${card.feature} off: ${JSON.stringify(off)}`);
          }

          expect(failures).toEqual([]);
        });

        it('gives the hub title for the hub path itself and for a child no card owns', () => {
          expect(settingsPageTitle(sections, registry.hubPath, registry.hubTitle, registry.hubPath)).toEqual(registry.hubTitle);
          expect(
            settingsPageTitle(sections, registry.hubPath, registry.hubTitle, `${registry.hubPath}/zz-not-a-card-path`),
          ).toEqual(registry.hubTitle);
        });

        it('returns null for a path outside the hub: the app root, a sibling of the hub, and the other registry’s hub', () => {
          const other = registriesOf(context).find((candidate) => candidate.name !== registry.name) as RegistryUnderTest;
          const parent = registry.hubPath.slice(0, registry.hubPath.lastIndexOf('/')) || '/';

          expect(settingsPageTitle(sections, registry.hubPath, registry.hubTitle, '/')).toEqual(null);
          expect(settingsPageTitle(sections, registry.hubPath, registry.hubTitle, parent)).toEqual(null);
          expect(settingsPageTitle(sections, registry.hubPath, registry.hubTitle, other.hubPath)).toEqual(null);
          // A card of the other registry is not claimed by this hub (the hubPath guard).
          const foreign = cardsOf(other.sections).find((card) => card.path !== undefined);
          if (foreign?.path) expect(settingsPageTitle(sections, registry.hubPath, registry.hubTitle, foreign.path)).toEqual(null);
        });
      });
    }
  });
}

/**
 * The suite behind `runPlatformWebConformance`: the shared gate of the settings
 * registries (hub, rail and AppBar title).
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const settingsRegistryGatesSuite = {
  id: 'settings-registry-gates',
  title: 'settings registries: the shared visibility and title gate (#91, #425)',
  description:
    'visibleSettingsSections and settingsPageTitle gate every hub, rail and title consumer by permission, feature and longest-prefix route, over the app’s own registries.',
  register,
} as const;

webConformanceSuites.register(settingsRegistryGatesSuite);
