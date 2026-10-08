// =============================================================================
// Suite: the settings registries' shape (issues #366, #742; Settings UI Pattern 1 and 3)
// =============================================================================
//
// The Settings UI Pattern is mechanical where it can be:
//
//   - rule 1: a settings page is declared in a registry, as a card with a title,
//     a description and an icon COMPONENT, and a route under its hub;
//   - rule 3: a card's `permission` is the exact string the API enforces, never
//     invented. The reference app proved this by reading controller SOURCE; once
//     the controllers live in a package, the strings come from the permission
//     catalog the API generates (`apiPermissions`), which is the registry the
//     seed derives from.
//
// Also pinned: a card declared ahead of its page is `disabled` with no `path`
// (the rail skips on either field and the hub renders an inert card on either,
// so a card with one and not the other is a card two consumers disagree about),
// and no route is claimed by two cards.
//
// Moved from the reference app's `userSettingsSections.test.ts` and the shape
// cases of `settingsRegistry.test.ts`; the card-by-card pins stay in the app.
// =============================================================================

import type { WebConformanceContext, WebConformanceTestApi } from '../../testing/index.js';
import { webConformanceSuites } from '../../testing/index.js';
import { cardsOf, permissionsOf, registriesOf } from './sections.js';

function register(api: WebConformanceTestApi, context: WebConformanceContext): void {
  const { describe, it, expect } = api;
  const known = new Set(context.apiPermissions);

  describe('settings registries: every card is declared as the Settings UI Pattern requires', () => {
    it('knows the API’s permissions at all, so a broken catalog import cannot pass vacuously', () => {
      expect(context.apiPermissions.length).toBeGreaterThanOrEqual(1);
    });

    for (const registry of registriesOf(context)) {
      const cards = cardsOf(registry.sections);

      describe(`the ${registry.name} registry`, () => {
        it('finds sections and cards at all, so a broken registry import cannot pass vacuously', () => {
          expect(registry.sections.length).toBeGreaterThanOrEqual(1);
          expect(cards.length).toBeGreaterThanOrEqual(1);
        });

        it('gives every section a label and at least one card', () => {
          const failures = registry.sections
            .filter((section) => section.label.trim() === '' || section.cards.length === 0)
            .map((section) => JSON.stringify(section.label));

          expect(failures).toEqual([]);
        });

        it('gives every card a title, a description and an icon component (never a rendered element)', () => {
          const failures = cards
            .filter(
              (card) =>
                card.title.trim() === '' ||
                card.description.trim() === '' ||
                !(typeof card.Icon === 'function' || (typeof card.Icon === 'object' && card.Icon !== null && !('props' in card.Icon))),
            )
            .map((card) => card.title || '(untitled)');

          expect(failures).toEqual([]);
        });

        it('routes every card under the hub, and none outside it', () => {
          const failures = cards
            .filter((card) => card.path !== undefined)
            .filter((card) => !(card.path as string).startsWith(`${registry.hubPath}/`))
            .map((card) => `${card.title}: ${card.path}`);

          expect(failures).toEqual([]);
        });

        it('keeps `disabled` and `path` coupled: a card declared ahead of its page has no route, a routed card is not inert', () => {
          const failures = cards
            .filter((card) => (card.disabled === true && card.path !== undefined) || (card.disabled !== true && card.path === undefined))
            .map((card) => `${card.title}: disabled=${String(card.disabled)} path=${String(card.path)}`);

          expect(failures).toEqual([]);
        });

        it('declares each route once', () => {
          const seen = new Map<string, string>();
          const failures: string[] = [];

          for (const card of cards) {
            if (card.path === undefined) continue;
            const earlier = seen.get(card.path);
            if (earlier !== undefined) failures.push(`${card.path}: ${earlier} and ${card.title}`);
            seen.set(card.path, card.title);
          }

          expect(failures).toEqual([]);
        });

        it('declares only permissions the API enforces: every `permission` is in the generated catalog, none invented', () => {
          const failures = cards.flatMap((card) =>
            permissionsOf(card)
              .filter((permission) => !known.has(permission))
              .map((permission) => `${card.title}: ${JSON.stringify(permission)}`),
          );

          expect(failures).toEqual([]);
        });

        it('never gives an any-of list an empty array (it would admit nobody)', () => {
          const failures = cards
            .filter((card) => typeof card.permission !== 'string' && card.permission !== undefined && card.permission.length === 0)
            .map((card) => card.title);

          expect(failures).toEqual([]);
        });
      });
    }

    it('shares no route between the admin and the user registry', () => {
      const [admin, user] = registriesOf(context).map((registry) => new Set(cardsOf(registry.sections).flatMap((card) => (card.path ? [card.path] : []))));
      const shared = [...(admin as Set<string>)].filter((path) => (user as Set<string>).has(path));

      expect(shared).toEqual([]);
    });
  });
}

/**
 * The suite behind `runPlatformWebConformance`: card shape, hub-relative
 * routes, coupled `disabled`/`path`, unique routes, and permissions drawn from
 * the API's catalog.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const settingsRegistryShapeSuite = {
  id: 'settings-registry-shape',
  title: 'settings registries: every card is declared as the Settings UI Pattern requires',
  description:
    'Every card has a title, description and icon component, a route under its hub (or is inert with none), a unique route, and only permissions the API enforces (Settings UI Pattern rules 1 and 3).',
  register,
} as const;

webConformanceSuites.register(settingsRegistryShapeSuite);
