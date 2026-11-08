import type { ComponentType } from 'react';

// =============================================================================
// The TUI screen registry  (PP-8.9, #715)
// =============================================================================
//
// The menu used to be a closed union (`type Route = 'menu' | 'login' | ...`)
// and a hand-written list, so an app that wanted one more screen (EvoPath's
// Android release) forked `app.tsx` and `menu.tsx`. Routes are now string ids
// registered in order: the platform's own screens first, then the app's.
// `menu.tsx` lists them sorted by `order`, then id, and `app.tsx` mounts the
// one selected.
//
// PURE ON PURPOSE. This module imports React only as a type, so registering a
// screen from `createCli` never loads ink or the reconciler: the no-argument
// TTY gate (tty.ts) is still the only door into the UI. The platform's
// built-in components are attached in `builtin-screens.tsx`, which only the
// ink app imports; their ids and order live here so a duplicate is caught at
// `createCli`, before any UI exists.
// =============================================================================

/**
 * What every TUI screen is given.
 *
 * @stability experimental
 */
export interface TuiScreenProps {
  /** Leave the screen: pops the navigation stack (back to the menu for a screen opened from it). */
  onDone: () => void;
  /** What the opener passed to `nav.push(route, params)`; `undefined` from the menu. */
  params?: unknown;
}

/**
 * What a menu label may depend on.
 *
 * @stability experimental
 */
export interface TuiMenuContext {
  /** Whether a token is stored (the menu annotates entries that need one). */
  loggedIn: boolean;
}

/**
 * Where a screen sits in the menu.
 *
 * @stability experimental
 */
export interface TuiScreenOrder {
  /** Unique route id, lowercase `[a-z0-9-]`, e.g. `android`. `menu` and `quit` are reserved. */
  route: string;
  /** Position in the menu: lower first; ties sort by route id. The built-ins use 10 to 60. */
  order: number;
}

/**
 * A screen in the TUI menu.
 *
 * @stability experimental
 */
export interface TuiScreenRegistration extends TuiScreenOrder {
  /** The menu entry, or a function of the login state. */
  label: string | ((context: TuiMenuContext) => string);
  /**
   * The screen. It calls `onDone` to return to the menu. Give this OR `load`.
   * A component imported at startup loads ink with it on every invocation,
   * `api` and `--help` included; prefer `load` for an app screen.
   */
  component?: ComponentType<TuiScreenProps> | undefined;
  /**
   * Loads the screen only when it is opened (`() => import('./about.screen.js')`
   * resolving to the component), so ink stays out of every non-TUI run.
   */
  load?: (() => Promise<ComponentType<TuiScreenProps>>) | undefined;
  /**
   * Keep the screen out of the root menu (seam #1115). It stays routable: a
   * menu entry (`registerTuiMenuNode`) or `nav.push(route)` still opens it.
   * Default `false`: a screen no entry opens is listed at the root.
   */
  hidden?: boolean | undefined;
  /**
   * Register this screen in place of the platform's built-in screen with the
   * same `route` (`login`, `invoke`, `status`, `jobs`, `node`, `deploy`,
   * `logout`); the built-in is then neither listed nor mounted (seam #1115).
   * Without it, reusing a built-in route throws. Replacing `node` or `deploy`
   * also drops their `registerTuiScreenSection` sections, which only the
   * built-in screens render.
   */
  replaceBuiltin?: boolean | undefined;
}

/** The route ids the router itself owns. */
const RESERVED_ROUTES: readonly string[] = ['menu', 'quit'];

/**
 * The platform's own screens, in menu order: `login` 10, `invoke` 20,
 * `status` 30, `jobs` 35, `node` 40, `deploy` 50, `logout` 60. An app screen picks an
 * `order` relative to these. Their components are attached when the TUI
 * starts; the ids and orders are here so a duplicate is caught without
 * loading the UI.
 *
 * @stability stable
 */
export const BUILTIN_TUI_SCREENS: readonly TuiScreenOrder[] = Object.freeze([
  { route: 'login', order: 10 },
  { route: 'invoke', order: 20 },
  { route: 'status', order: 30 },
  { route: 'jobs', order: 35 },
  { route: 'node', order: 40 },
  { route: 'deploy', order: 50 },
  { route: 'logout', order: 60 },
]);

const ROUTE_PATTERN = /^[a-z][a-z0-9-]*$/;

const registered: TuiScreenRegistration[] = [];
const hiddenRoutes = new Set<string>();
let frozenBy: string | undefined;

function isBuiltinRoute(route: string): boolean {
  return BUILTIN_TUI_SCREENS.some((builtin) => builtin.route === route);
}

/**
 * Adds a screen to the TUI menu, after the platform's own (by `order`).
 *
 * @param screen - The route id, label, order and component.
 * @throws Error when the route id is malformed, reserved, a built-in's or
 *   already registered, or when `createCli` has already built the CLI.
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerTuiScreen({
 *   route: 'about',
 *   label: 'About this app',
 *   order: 70,
 *   load: async () => (await import('./about.screen.js')).AboutScreen,
 * });
 * ```
 */
export function registerTuiScreen(screen: TuiScreenRegistration): void {
  if (frozenBy !== undefined) {
    throw new Error(`TUI screen "${screen.route}" was registered after ${frozenBy}; register it before (or pass it to createCli).`);
  }
  if (typeof screen.route !== 'string' || !ROUTE_PATTERN.test(screen.route)) {
    throw new Error(`TUI screen route "${String(screen.route)}" is invalid: use lowercase letters, digits and hyphens.`);
  }
  if (RESERVED_ROUTES.includes(screen.route)) {
    throw new Error(`TUI screen route "${screen.route}" is reserved by the TUI router.`);
  }
  if (screen.replaceBuiltin === true && !isBuiltinRoute(screen.route)) {
    throw new Error(
      `TUI screen "${screen.route}" sets replaceBuiltin, but no built-in screen has that route (built-ins: ${BUILTIN_TUI_SCREENS.map((builtin) => builtin.route).join(', ')}).`,
    );
  }
  if (isBuiltinRoute(screen.route) && screen.replaceBuiltin !== true) {
    throw new Error(
      `TUI screen route "${screen.route}" is already a built-in screen; choose another route id, or pass \`replaceBuiltin: true\` to replace it.`,
    );
  }
  if (registered.some((existing) => existing.route === screen.route)) {
    throw new Error(`TUI screen route "${screen.route}" is already registered.`);
  }
  if (typeof screen.order !== 'number' || !Number.isFinite(screen.order)) {
    throw new Error(`TUI screen "${screen.route}" needs a finite numeric order.`);
  }
  const hasComponent = typeof screen.component === 'function' || (typeof screen.component === 'object' && screen.component !== null);
  const hasLoad = typeof screen.load === 'function';
  if (hasComponent === hasLoad) {
    throw new Error(`TUI screen "${screen.route}" needs exactly one of component or load.`);
  }
  registered.push(Object.freeze({ ...screen }));
}

/**
 * The app screens registered so far, in registration order.
 *
 * @returns A frozen copy.
 * @stability experimental
 */
export function listRegisteredTuiScreens(): readonly TuiScreenRegistration[] {
  return Object.freeze([...registered]);
}

/**
 * Sorts screens the way the menu lists them: by `order`, then route id.
 *
 * @typeParam T - A screen registration, or anything with a route and an order.
 * @param screens - Built-in and app screens.
 * @returns A new, sorted array.
 * @stability experimental
 */
export function sortTuiScreens<T extends TuiScreenOrder>(screens: readonly T[]): T[] {
  return [...screens].sort((a, b) => a.order - b.order || (a.route < b.route ? -1 : a.route > b.route ? 1 : 0));
}

/**
 * Keeps a screen (built-in or app) out of the root menu, so an app that
 * replaces the platform's `login` or `jobs` with its own flow does not list
 * them (seam #1115). The screen stays routable: a menu entry that opens it
 * still works, and so does `nav.push(route)`. The route is checked when
 * `createCli` freezes the registries, so it may be hidden before an app
 * screen with that route is registered. Same as `createCli({ tuiHiddenScreens })`.
 *
 * @param route - A built-in route (`login`, `invoke`, `status`, `jobs`, `node`, `deploy`, `logout`) or an app screen's.
 * @throws Error when the route id is malformed or reserved, or when `createCli` has already built the CLI.
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * for (const route of ['invoke', 'jobs', 'logout']) hideTuiScreen(route);
 * ```
 */
export function hideTuiScreen(route: string): void {
  if (frozenBy !== undefined) {
    throw new Error(`TUI screen "${route}" was hidden after ${frozenBy}; hide it before (or pass it to createCli).`);
  }
  if (typeof route !== 'string' || !ROUTE_PATTERN.test(route)) {
    throw new Error(`TUI screen route "${String(route)}" is invalid: use lowercase letters, digits and hyphens.`);
  }
  if (RESERVED_ROUTES.includes(route)) {
    throw new Error(`TUI screen route "${route}" is reserved by the TUI router and cannot be hidden.`);
  }
  hiddenRoutes.add(route);
}

/**
 * The routes hidden with {@link hideTuiScreen} (not those with `hidden: true`).
 *
 * @returns A frozen copy, in the order they were hidden.
 * @stability experimental
 */
export function listHiddenTuiScreens(): readonly string[] {
  return Object.freeze([...hiddenRoutes]);
}

/**
 * One screen as the menu tree sees it: route, order, label and whether it is
 * hidden from the root.
 *
 * @stability experimental
 */
export interface TuiMenuScreen extends TuiScreenOrder {
  /** The root menu label; a built-in's route stands in for its label. */
  label: TuiScreenRegistration['label'];
  /** Not listed at the root when no entry opens it. */
  hidden: boolean;
}

/**
 * The screens the menu tree is built from, without components: the built-ins
 * an app did not replace (with their route standing in for a label), then
 * the app's, each with `hidden` resolved from {@link hideTuiScreen} and the
 * registration's own flag. Pure: for the conformance suite and tests.
 *
 * @param screens - The app screens. Default the registered ones.
 * @param hidden - The hidden routes. Default the ones {@link hideTuiScreen} collected.
 * @returns The screens, unsorted.
 * @stability experimental
 */
export function tuiMenuScreens(
  screens: readonly TuiScreenRegistration[] = registered,
  hidden: readonly string[] = [...hiddenRoutes],
): TuiMenuScreen[] {
  const replaced = new Set(screens.filter((screen) => screen.replaceBuiltin === true).map((screen) => screen.route));
  return [
    ...BUILTIN_TUI_SCREENS.filter((builtin) => !replaced.has(builtin.route)).map(({ route, order }) => ({
      route,
      order,
      label: route,
      hidden: hidden.includes(route),
    })),
    ...screens.map((screen) => ({
      route: screen.route,
      order: screen.order,
      label: screen.label,
      hidden: screen.hidden === true || hidden.includes(screen.route),
    })),
  ];
}

/**
 * Checks the hidden routes, then refuses later registrations; `createCli` calls it.
 *
 * @throws Error when a hidden route names no built-in and no registered screen; nothing is frozen then.
 */
export function freezeTuiScreenRegistry(by: string): void {
  for (const route of hiddenRoutes) {
    if (!isBuiltinRoute(route) && !registered.some((screen) => screen.route === route)) {
      throw new Error(`TUI screen "${route}" is hidden, but no built-in or registered screen has that route.`);
    }
  }
  frozenBy = by;
}

/** Empties the registry. Tests only. */
export function resetTuiScreenRegistryForTests(): void {
  registered.length = 0;
  hiddenRoutes.clear();
  frozenBy = undefined;
}
