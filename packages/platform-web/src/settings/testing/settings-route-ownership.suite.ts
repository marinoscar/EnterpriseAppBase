// =============================================================================
// Suite: route ownership (issues #55, #92, #742)
// =============================================================================
//
// The route-ownership table is the one piece of this navigation that manual
// testing cannot check: a route claimed by two destinations emits
// `aria-current="page"` twice and highlights two rail rows, and a route claimed
// by none silently highlights nothing. Both look fine on the screen you happen
// to be standing on.
//
// So the suite reads the LIVE route table (an array the app exports, or the
// text of its route file) and the app's own destination functions, never a copy
// of either. It is moved from the first blocks of the reference app's
// `destinations.test.ts`; what stayed there is what is about ITS destinations
// (that Console is pinned, that the bottom bar caps at four, the AI
// Playground's two permissions).
// =============================================================================

import type { WebConformanceContext, WebConformanceTestApi } from '../../testing/index.js';
import { webConformanceSuites } from '../../testing/index.js';
import { resolveAppRoutes } from './routes.js';

function register(api: WebConformanceTestApi, context: WebConformanceContext): void {
  const { describe, it, expect } = api;
  const view = context.destinations;

  if (view === undefined) {
    throw new Error(
      "settings-route-ownership: the app passed no `destinations`. Pass its destination table, or skip the suite: `suites: { 'settings-route-ownership': { skip: 'why' } }`.",
    );
  }

  const paths = (): string[] => resolveAppRoutes(context.routes).map((route) => route.path);
  const ownersOf = (path: string): string[] =>
    Object.keys(view.routes).filter((key) => (view.routes[key] as readonly string[]).some((prefix) => view.owns(prefix, path)));

  describe('destinations: route ownership', () => {
    it('finds the destination routes, the hubs and the public ones, so a broken route table cannot pass vacuously', () => {
      const declared = paths();

      expect(declared.length).toBeGreaterThanOrEqual(8);
      expect(declared).toContain('/');
      expect(declared).toContain(context.hubs.admin.path);
      expect(declared).toContain(context.hubs.user.path);
    });

    it('claims every route exactly once, or deliberately not at all', () => {
      const failures: string[] = [];

      for (const path of paths()) {
        const owners = ownersOf(path);
        if (view.unowned.includes(path)) {
          if (owners.length > 0) failures.push(`${path} is listed as unowned but ${owners.join(', ')} claims it`);
        } else if (owners.length !== 1) {
          failures.push(`${path} should be owned by exactly one destination, owners: [${owners.join(', ')}]`);
        }
      }

      expect(failures).toEqual([]);
    });

    it('lists every declared route as either owned or explicitly unowned', () => {
      // The complement: a route neither claimed nor listed as deliberately
      // unowned is an OVERSIGHT, and would pass the test above by being
      // "unowned by accident".
      const failures = paths()
        .filter((path) => view.resolveActive(path) === null && !view.unowned.includes(path))
        .map((path) => `${path} is neither owned by a destination nor listed as unowned`);

      expect(failures).toEqual([]);
    });

    it('highlights NOTHING on the deliberately unowned routes', () => {
      // No destination is better than a wrong one: the login screen does not belong to Home.
      const failures = view.unowned.filter((path) => view.resolveActive(path) !== null).map((path) => `${path} activates ${String(view.resolveActive(path))}`);

      expect(failures).toEqual([]);
    });

    it('gives every destination in the table a route it owns', () => {
      const failures = view.destinations
        .filter((destination) => view.resolveActive(destination.path) !== destination.key)
        .map((destination) => `${destination.path} activates ${String(view.resolveActive(destination.path))}, expected ${destination.key}`);

      expect(view.destinations.length).toBeGreaterThanOrEqual(1);
      expect(failures).toEqual([]);
    });

    it('matches a prefix only at a segment boundary', () => {
      expect(view.owns('/settings', '/settings')).toEqual(true);
      expect(view.owns('/settings', '/settings/profile')).toEqual(true);
      expect(view.owns('/settings', '/settingsfoo')).toEqual(false);
      expect(view.owns('/settings', '/settings-archive')).toEqual(false);
    });

    it('never lets an owned prefix with a suffix activate its destination', () => {
      // A bare `startsWith` (what the old Sidebar did) matches `/settingsfoo`.
      const failures = Object.entries(view.routes).flatMap(([key, prefixes]) =>
        prefixes
          .filter((prefix) => prefix !== '/')
          .filter((prefix) => view.resolveActive(`${prefix}foo`) === key)
          .map((prefix) => `${prefix}foo activates ${key}`),
      );

      expect(failures).toEqual([]);
    });

    it('activates the root destination on / only, and a destination for its child routes', () => {
      // Every path starts with '/', so without the exact-match rule the root
      // would own the entire app.
      expect(view.owns('/', '/anything')).toEqual(false);
      expect(view.owns('/', '/')).toEqual(true);

      const failures = view.destinations
        .filter((destination) => destination.path !== '/')
        .filter((destination) => view.resolveActive(`${destination.path}/child`) !== destination.key)
        .map((destination) => `${destination.path}/child does not activate ${destination.key}`);

      expect(failures).toEqual([]);
    });
  });
}

/**
 * The suite behind `runPlatformWebConformance`: no route is claimed by two
 * destinations or by none, and matching respects segment boundaries.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const settingsRouteOwnershipSuite = {
  id: 'settings-route-ownership',
  title: 'destinations: route ownership',
  description:
    'Every route the app declares is owned by exactly one destination or deliberately by none, and ownership matches on segment boundaries (#55, #92).',
  register,
} as const;

webConformanceSuites.register(settingsRouteOwnershipSuite);
