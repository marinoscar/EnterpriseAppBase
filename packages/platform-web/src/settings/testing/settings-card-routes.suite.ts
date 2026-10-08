// =============================================================================
// Suite: every settings card is routed, under the permission it declares (#90, #742)
// =============================================================================
//
// The registry and the router are two lists of the same pages, and epic #90's
// whole premise is that they cannot be allowed to disagree. A card whose `path`
// has no route is a hub tile leading to the catch-all; a card whose permission
// differs from its route's is the split-brain in miniature: the card appears,
// the click 403s or redirects.
//
// The route table is read LIVE: an array the app exports, or the text of its
// route file parsed for `<Route>` elements. Never a copy.
//
// Moved from the `admin sections: registry against the live routes` block of
// the reference app's `destinations.test.ts`. The reference app checked the
// admin registry; the same rule holds for the user registry, so both run.
// =============================================================================

import type { WebConformanceContext, WebConformanceTestApi } from '../../testing/index.js';
import { webConformanceSuites } from '../../testing/index.js';
import { resolveAppRoutes, sameGate } from './routes.js';
import { cardsOf, registriesOf } from './sections.js';

function register(api: WebConformanceTestApi, context: WebConformanceContext): void {
  const { describe, it, expect } = api;

  describe('settings cards against the live routes', () => {
    it('finds the app’s routes at all, so a broken route table cannot pass vacuously', () => {
      expect(resolveAppRoutes(context.routes).length).toBeGreaterThanOrEqual(8);
    });

    for (const registry of registriesOf(context)) {
      describe(`the ${registry.name} registry`, () => {
        it('routes every card path, under the exact permission the card declares', () => {
          const routes = new Map(resolveAppRoutes(context.routes).map((route) => [route.path, route.permission]));
          const failures: string[] = [];

          for (const card of cardsOf(registry.sections)) {
            if (!card.path) continue;
            if (!routes.has(card.path)) {
              failures.push(`${card.title} → ${card.path} has no route`);
            } else if (!sameGate(routes.get(card.path), card.permission ?? null)) {
              failures.push(
                `${card.title} → ${card.path}: card declares ${JSON.stringify(card.permission ?? null)}, route gates ${JSON.stringify(routes.get(card.path) ?? null)}`,
              );
            }
          }

          expect(failures).toEqual([]);
        });

        if (context.destinations !== undefined) {
          const destinations = context.destinations;

          it('puts every card inside the one destination that owns its hub', () => {
            const owner = destinations.resolveActive(registry.hubPath);
            const failures = cardsOf(registry.sections)
              .filter((card) => card.path !== undefined)
              .filter((card) => destinations.resolveActive(card.path as string) !== owner)
              .map((card) => `${card.path} activates ${String(destinations.resolveActive(card.path as string))}, the hub activates ${String(owner)}`);

            expect(owner === null ? `the hub ${registry.hubPath} activates no destination` : 'a destination').toEqual('a destination');
            expect(failures).toEqual([]);
          });
        }
      });
    }
  });
}

/**
 * The suite behind `runPlatformWebConformance`: every settings card has a
 * route, gated on the permission the card declares.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const settingsCardRoutesSuite = {
  id: 'settings-card-routes',
  title: 'settings cards against the live routes',
  description:
    'Every settings card’s path has a route, gated on exactly the permission the card declares, and sits inside the destination that owns its hub (epic #90).',
  register,
} as const;

webConformanceSuites.register(settingsCardRoutesSuite);
