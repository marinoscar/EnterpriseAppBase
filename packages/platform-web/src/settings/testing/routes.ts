// The app's route table, as data (issue #742). The preferred input is an array
// the app exports; the fallback parses the TEXT of the route file, so the suites
// still read the live routes and never a hand-kept copy. The app reads the file
// (this package has no Node types) and passes the text.

import type { AppRouteDef } from '../../testing/index.js';

/**
 * The routes of the app, normalised.
 *
 * @param routes - an exported route table, or `{ appTsx }`, the text of the route file.
 * @returns one entry per distinct route path, in source order; a route with no permission gate has `permission: null`.
 *
 * @stability experimental
 */
export function resolveAppRoutes(routes: readonly AppRouteDef[] | { appTsx: string }): AppRouteDef[] {
  if (Array.isArray(routes)) {
    return (routes as readonly AppRouteDef[]).map((route) => ({ path: route.path, permission: route.permission ?? null }));
  }

  return parseAppRoutes((routes as { appTsx: string }).appTsx);
}

/**
 * Every `<Route path="...">` element of a route file, with the permission its
 * guard declares: the first `permissions={[...]}` list (an any-of guard) or
 * `permission="..."` string inside the element, else `null`. The catch-all `*`
 * redirects rather than rendering a page, so it is not a route here.
 *
 * Parsing the text rather than importing the tree keeps the suites honest about
 * what a reviewer actually reads.
 *
 * @param source - the text of the route file.
 * @returns the routes, in source order, de-duplicated by path.
 *
 * @stability experimental
 */
export function parseAppRoutes(source: string): AppRouteDef[] {
  const gates = new Map<string, string | string[] | null>();

  // Split on the element opener so each chunk holds exactly one route, and the
  // first guard inside it is that route's own. Chunks that do not start with a
  // `path` (`<Routes>`, layout and guard routes) fall out on their own.
  for (const chunk of source.split('<Route').slice(1)) {
    const path = /^\s*path="([^"]+)"/.exec(chunk)?.[1];
    if (!path) continue;
    const anyOf = /permissions=\{\s*\[([^\]]*)\]\s*\}/.exec(chunk)?.[1];
    gates.set(
      path,
      anyOf !== undefined
        ? [...anyOf.matchAll(/'([^']+)'/g)].map((match) => match[1] as string)
        : (/(?<!s)permission="([^"]+)"/.exec(chunk)?.[1] ?? null),
    );
  }

  // Any other `path="..."` prop in the file still declares a path the table must claim.
  for (const match of source.matchAll(/path="([^"]+)"/g)) {
    const path = match[1] as string;
    if (!gates.has(path)) gates.set(path, null);
  }

  return [...gates.entries()]
    .filter(([path]) => path !== '*')
    .map(([path, permission]) => ({ path, permission }));
}

/** Whether two permission gates are the same (a string, an any-of list, or none). */
export function sameGate(
  a: string | readonly string[] | null | undefined,
  b: string | readonly string[] | null | undefined,
): boolean {
  const normalise = (gate: string | readonly string[] | null | undefined): string[] | null =>
    gate === null || gate === undefined ? null : typeof gate === 'string' ? [gate] : [...gate].sort();
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}
