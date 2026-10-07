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
  /** Return to the menu. Every screen goes back there and nowhere else. */
  onDone: () => void;
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
 * A screen in the TUI menu.
 *
 * @stability experimental
 */
export interface TuiScreenRegistration {
  /** Unique route id, lowercase `[a-z0-9-]`, e.g. `android`. `menu` and `quit` are reserved. */
  route: string;
  /** The menu entry, or a function of the login state. */
  label: string | ((context: TuiMenuContext) => string);
  /** Position in the menu: lower first; ties sort by route id. The built-ins use 10 to 60. */
  order: number;
  /** The screen. It calls `onDone` to return to the menu. */
  component: ComponentType<TuiScreenProps>;
}

/** The route ids the router itself owns. */
const RESERVED_ROUTES: readonly string[] = ['menu', 'quit'];

/**
 * The platform's own screens, in menu order. Their components are attached by
 * `builtin-screens.tsx`; the ids and orders are here so a duplicate is caught
 * without loading the UI.
 */
export const BUILTIN_TUI_SCREENS: readonly { route: string; order: number }[] = Object.freeze([
  { route: 'login', order: 10 },
  { route: 'invoke', order: 20 },
  { route: 'status', order: 30 },
  { route: 'node', order: 40 },
  { route: 'deploy', order: 50 },
  { route: 'logout', order: 60 },
]);

const ROUTE_PATTERN = /^[a-z][a-z0-9-]*$/;

const registered: TuiScreenRegistration[] = [];
let frozenBy: string | undefined;

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
 * registerTuiScreen({ route: 'about', label: 'About this app', order: 70, component: AboutScreen });
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
  if (BUILTIN_TUI_SCREENS.some((builtin) => builtin.route === screen.route)) {
    throw new Error(`TUI screen route "${screen.route}" is already a built-in screen; choose another route id.`);
  }
  if (registered.some((existing) => existing.route === screen.route)) {
    throw new Error(`TUI screen route "${screen.route}" is already registered.`);
  }
  if (typeof screen.order !== 'number' || !Number.isFinite(screen.order)) {
    throw new Error(`TUI screen "${screen.route}" needs a finite numeric order.`);
  }
  if (typeof screen.component !== 'function' && (typeof screen.component !== 'object' || screen.component === null)) {
    throw new Error(`TUI screen "${screen.route}" needs a component.`);
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
 * @param screens - Built-in and app screens.
 * @returns A new, sorted array.
 * @stability experimental
 */
export function sortTuiScreens<T extends { route: string; order: number }>(screens: readonly T[]): T[] {
  return [...screens].sort((a, b) => a.order - b.order || (a.route < b.route ? -1 : a.route > b.route ? 1 : 0));
}

/** Refuses later registrations; `createCli` calls it. */
export function freezeTuiScreenRegistry(by: string): void {
  frozenBy = by;
}

/** Empties the registry. Tests only. */
export function resetTuiScreenRegistryForTests(): void {
  registered.length = 0;
  frozenBy = undefined;
}
