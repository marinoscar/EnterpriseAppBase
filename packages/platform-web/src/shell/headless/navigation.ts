// =============================================================================
// The shell's navigation model (issue #868; moved from the reference app's
// `config/destinations.ts`, issues #55, #92, #94, #105, #425)
// =============================================================================
//
// The app declares its destinations ONCE and every navigation surface of the
// shell (rail, bottom bar, user menu) draws them from that one table, with the
// same visibility rule and the same active-state rule. Before the table existed
// the same menu paths were spelled out in four places, each with its own idea
// of who could see them; one table is the fix.
//
// Two rules keep the ownership table trustworthy:
//
//  1. A route is owned by at most one destination (the app's own test asserts
//     this against its live route list).
//  2. Matching respects segment boundaries (`owns`): a bare `startsWith` would
//     make `/settings` own `/settingsfoo`.
// =============================================================================

import type { ComponentType } from 'react';

import { isFeatureEnabled } from '../../settings/index.js';
import type { SettingsFeatureKey, SettingsFeatures, SettingsSectionDef } from '../../settings/index.js';

/**
 * A destination's icon: a COMPONENT, never a rendered element, because the rail
 * draws it `small` collapsed and `medium` expanded and the bottom bar at its
 * own size. Every `@mui/icons-material` icon is one.
 *
 * @stability experimental
 */
export type ShellIcon = ComponentType<ShellIconProps>;

/**
 * What the shell passes a {@link ShellIcon}.
 *
 * @stability experimental
 */
export interface ShellIconProps {
  /** `small` in the collapsed rail and the user menu, `medium` in the expanded rail. */
  fontSize?: 'inherit' | 'large' | 'medium' | 'small';
}

/**
 * One navigation destination, fully described for every surface that draws it.
 *
 * @typeParam K - the app's destination keys.
 *
 * @stability experimental
 */
export interface ShellDestination<K extends string = string> {
  /** The canonical key (the bottom bar's value, the active-state answer). */
  key: K;
  /** The full label: the expanded rail, the user menu, every accessible name. */
  label: string;
  /** The label of the 56px collapsed rail and the 4-up bottom bar. */
  compactLabel: string;
  /** The icon component. */
  Icon: ShellIcon;
  /** Where the destination navigates. */
  path: string;
  /**
   * The API permission that makes it REACHABLE: the exact string the
   * controller enforces. Absent means any authenticated user.
   */
  permission?: string;
  /**
   * Reachable when the viewer holds ANY ONE of these. AND-ed with
   * `permission` when both are set (a separate field, because an array in
   * `permission` would read as "all").
   */
  anyPermission?: readonly string[];
  /**
   * Pinned at the FOOT of the rail, below a divider (a mode such as the
   * Console, not a peer of the library destinations). Rail-only: the bottom
   * bar and the user menu keep declaration order.
   */
  pinned?: boolean;
  /** A deployment feature it exists only under; hidden unless the feature map says on. */
  feature?: SettingsFeatureKey;
}

/**
 * A settings surface the compact AppBar can drill into: back arrow plus the
 * resolved page title below `sm`.
 *
 * @stability experimental
 */
export interface ShellSettingsSurface {
  /** The surface's registry (`ADMIN_SECTIONS`, `USER_SETTINGS_SECTIONS`). */
  sections: SettingsSectionDef[];
  /** The hub's path (`/admin/settings`). */
  hubPath: string;
  /** The hub's title, used for the hub itself and any path no card claims. */
  hubTitle: string;
}

/**
 * The rail's Console mode: on any route under `prefix`, the EXPANDED rail
 * swaps its contents for the visible cards of `sections`, with a permanent
 * "back" row at the top.
 *
 * @stability experimental
 */
export interface ShellConsole {
  /** The route prefix that turns Console mode on (`/admin`). */
  prefix: string;
  /** The registry the Console lists (`ADMIN_SECTIONS`). */
  sections: SettingsSectionDef[];
  /** The way out. Default `{ label: 'Back to library', path: '/' }`. */
  back?: ShellConsoleBack;
}

/**
 * The Console's permanent "back" row.
 *
 * @stability experimental
 */
export interface ShellConsoleBack {
  /** The row's label and accessible name. */
  label: string;
  /** Where it goes. */
  path: string;
}

/**
 * The desktop rail's collapse preference.
 *
 * @stability experimental
 */
export interface ShellRailPreference {
  /** Whether the viewer collapsed the desktop rail. */
  railCollapsed: boolean;
  /** Flip it (optimistically). */
  toggleRailCollapsed(): void;
}

/**
 * Everything the shell's navigation surfaces need from the app. Declare it
 * ONCE, at module scope.
 *
 * @typeParam K - the app's destination keys.
 *
 * @example
 * ```ts
 * export const APP_NAVIGATION: ShellNavigation<'home' | 'notes'> = {
 *   destinations: [
 *     { key: 'home', label: 'Home', compactLabel: 'Home', Icon: HomeIcon, path: '/' },
 *     { key: 'notes', label: 'Notes', compactLabel: 'Notes', Icon: NotesIcon, path: '/notes', permission: 'notes:read' },
 *   ],
 *   settingsSurfaces: [{ sections: USER_SETTINGS_SECTIONS, hubPath: '/settings', hubTitle: 'Settings' }],
 * };
 * ```
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface ShellNavigation<K extends string = string> {
  /** The destinations, in navigation order (declaration order is the order on every surface). */
  destinations: readonly ShellDestination<K>[];
  /**
   * The route prefixes each destination OWNS (lights up on). Default: each
   * destination's own `path`. A destination may own more than it navigates
   * to (the Console navigates to `/admin/settings` and owns `/admin`).
   */
  destinationRoutes?: Readonly<Record<K, readonly string[]>>;
  /** The settings surfaces the compact AppBar drills into, in resolution order. Default none. */
  settingsSurfaces?: readonly ShellSettingsSurface[];
  /** The rail's Console mode. Default none. */
  console?: ShellConsole;
  /** Where the brand and the drill-down's top level lead. Default `'/'`. */
  homePath?: string;
  /**
   * The desktop rail's collapse preference, as a hook (called on every
   * render of the rail, so keep the function stable: a module-level
   * reference). Default `useShellRailPreference`, the `navigation`
   * user-settings namespace.
   */
  useRailPreference?: () => ShellRailPreference;
}

/**
 * Does `prefix` own `path`? True when the path equals the prefix or continues
 * with a `/`. `'/'` owns only itself, or Home would own the whole app.
 *
 * @param prefix - a route prefix.
 * @param path - a pathname.
 * @returns whether `prefix` owns `path`.
 *
 * @stability experimental
 */
export function owns(prefix: string, path: string): boolean {
  if (prefix === '/') return path === '/';
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Is `destination` visible to this viewer? Every surface asks this one
 * function: the feature gate, then `permission`, then `anyPermission`.
 *
 * @param destination - the destination.
 * @param hasPermission - the viewer's permission predicate.
 * @param features - the deployment's feature map (fail closed).
 * @returns whether to draw it.
 *
 * @stability experimental
 */
export function isDestinationVisible(
  destination: Pick<ShellDestination, 'permission' | 'anyPermission' | 'feature'>,
  hasPermission: (permission: string) => boolean,
  features: SettingsFeatures = {},
): boolean {
  if (!isFeatureEnabled(destination.feature, features)) return false;
  if (destination.permission && !hasPermission(destination.permission)) return false;
  if (destination.anyPermission && !destination.anyPermission.some(hasPermission)) return false;
  return true;
}

/**
 * The route prefixes of each destination: `navigation.destinationRoutes`, or
 * each destination's own `path`.
 *
 * @param navigation - the app's navigation.
 * @returns the ownership table.
 *
 * @stability experimental
 */
export function shellDestinationRoutes<K extends string>(
  navigation: Pick<ShellNavigation<K>, 'destinations' | 'destinationRoutes'>,
): Readonly<Record<K, readonly string[]>> {
  if (navigation.destinationRoutes) return navigation.destinationRoutes;
  const routes = {} as Record<K, readonly string[]>;
  for (const destination of navigation.destinations) routes[destination.key] = [destination.path];
  return routes;
}

/**
 * Which destination, if any, owns `pathname`. The longest owning prefix wins.
 *
 * @param routes - the ownership table (`shellDestinationRoutes`).
 * @param pathname - the current path.
 * @returns the owning key, or `null` (a route deliberately owned by none).
 *
 * @stability experimental
 */
export function resolveActiveDestination<K extends string>(
  routes: Readonly<Record<K, readonly string[]>>,
  pathname: string,
): K | null {
  let best: { key: K; length: number } | null = null;
  for (const [key, prefixes] of Object.entries(routes) as [K, readonly string[]][]) {
    for (const prefix of prefixes) {
      if (!owns(prefix, pathname)) continue;
      if (!best || prefix.length > best.length) best = { key, length: prefix.length };
    }
  }
  return best?.key ?? null;
}
