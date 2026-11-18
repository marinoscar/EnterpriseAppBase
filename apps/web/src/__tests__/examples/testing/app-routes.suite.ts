// =============================================================================
// Worked example: an app-owned web conformance suite WITH options (PP-14.26)
// =============================================================================
//
// The platform's `settings-*` suites run over the app's registries. An app that
// has an invariant of its own writes a suite the same way and registers it with
// the same harness, without editing `packages/platform-web`:
//
//   1. a `WebConformanceSuite<Options>` whose `register(api, context, options)`
//      registers `describe` and `it` blocks on the runner's own API;
//   2. `webConformanceSuites.register(suite)`, once;
//   3. the app passes the suite's options under its id in `suites`, or opts out
//      with `{ skip: 'reason' }`.
//
// This suite says: every route the app's navigation promises is declared in the
// route table, and none of the routes it forbids is. The DATA (the promised
// paths) is the app's, passed as options; the scan is the suite's.
//
// Run by `app-routes.suite.test.tsx` next to this file. The reference app does
// not register it in `src/__tests__/conformance.test.ts`: it is an example.
// =============================================================================

import { webConformanceSuites } from '@marinoscar/platform-web/testing';
import type { WebConformanceContext, WebConformanceSuite } from '@marinoscar/platform-web/testing';

/** What the app passes under `'app-routes'` in `runPlatformWebConformance({ suites })`. */
export interface AppRoutesOptions {
  /** Paths the app promises (its navigation links to them); each must be a declared route. */
  readonly requiredRoutes: readonly string[];
  /** Paths the app must not serve (a retired page); none may be a declared route. */
  readonly forbiddenRoutes?: readonly string[];
  /** Vacuity guard: at least this many routes must be found (default 1). */
  readonly minRoutes?: number;
}

/** The declared route paths: the exported table, or every `path="..."` of the route file's text. */
function declaredPaths(routes: WebConformanceContext['routes']): string[] {
  if (Array.isArray(routes)) return (routes as ReadonlyArray<{ path: string }>).map((route) => route.path);
  const text = (routes as { appTsx: string }).appTsx;
  return [...new Set([...text.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1] as string))];
}

/** Suite id of the example; also the key of the app's entry in `suites`. */
export const APP_ROUTES_SUITE_ID = 'app-routes';

export const appRoutesSuite: WebConformanceSuite<AppRoutesOptions> = {
  id: APP_ROUTES_SUITE_ID,
  title: 'the app declares the routes its navigation promises',
  description: 'Every required route is declared in the route table, and no forbidden route is.',
  register(api, context, options) {
    if (options === undefined) {
      throw new Error(`${APP_ROUTES_SUITE_ID}: pass its options under suites['${APP_ROUTES_SUITE_ID}'] ({ requiredRoutes: [...] }), or skip it with a reason.`);
    }
    const declared = declaredPaths(context.routes);

    api.describe('the app declares the routes its navigation promises', () => {
      api.it('finds routes at all, so a broken parse cannot pass vacuously', () => {
        api.expect(declared.length).toBeGreaterThanOrEqual(options.minRoutes ?? 1);
      });

      api.it('declares every required route', () => {
        api.expect(options.requiredRoutes.filter((path) => !declared.includes(path))).toEqual([]);
      });

      api.it('declares none of the forbidden routes', () => {
        api.expect((options.forbiddenRoutes ?? []).filter((path) => declared.includes(path))).toEqual([]);
      });
    });
  },
};

if (!webConformanceSuites.has(APP_ROUTES_SUITE_ID)) webConformanceSuites.register(appRoutesSuite);
