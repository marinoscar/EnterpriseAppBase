/**
 * The destination model — canonical keys, route ownership, and active state.
 *
 * Issue #55, epic #51. This file is the SINGLE source of truth for the app's
 * navigation targets. Before it existed the same four menu paths were spelled
 * out in four places (`App.tsx`, `Sidebar.tsx`, `UserMenu.tsx`,
 * `home/QuickActions.tsx`), each with its own idea of who was allowed to see
 * them — which is how a Contributor holding `system_settings:read` ended up
 * with a working System Settings page, a menu entry pointing at it, and no
 * sidebar row: three gates, three answers.
 *
 * Two rules make the ownership table trustworthy:
 *
 *  1. **A route is owned by at most one destination.** A test asserts this
 *     against the live route list in `App.tsx`, which is what keeps the table
 *     honest as routes are added — it fails loudly the day someone adds a
 *     route and forgets this file.
 *  2. **Matching respects segment boundaries.** A bare `startsWith` — what
 *     `Sidebar` used to do — would make `/settings` own `/settingsfoo` and
 *     `/admin/users` own `/admin/users-archive`.
 *
 * `Icon` is declared as a COMPONENT, never as a rendered element. The rail
 * draws it at `small` when collapsed and `medium` when expanded, and the
 * bottom bar draws it at its own size — so the size cannot be baked in here.
 *
 * ONE ADMIN DESTINATION, NOT TWO (issue #92, epic #90)
 * ----------------------------------------------------
 * `users` (`/admin/users`) and `system` (`/admin/settings`) used to be two
 * separate rows for what is, to the user, one surface. Issue #92 splits the
 * admin tab strips into one route per settings page under `/admin/settings/*`,
 * and #94 gives the rail a Console mode that swaps its contents to those pages
 * on any `/admin/*` path. Console mode is only coherent if the admin surface is
 * ONE destination: two rows both matching `/admin/*` means two `aria-current`
 * candidates and an ambiguous active state on every admin route. So the two are
 * replaced by a single `console` destination that owns the whole `/admin`
 * subtree.
 */

import HomeIcon from '@mui/icons-material/Home';
import SettingsIcon from '@mui/icons-material/Settings';
import AdminIcon from '@mui/icons-material/AdminPanelSettings';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import {
  isDestinationVisible,
  owns,
  resolveActiveDestination as resolveShellDestination,
} from '@marinoscar/platform-web/shell/headless';
import type { ShellDestination } from '@marinoscar/platform-web/shell/headless';

export type DestinationKey = 'home' | 'settings' | 'console' | 'ai';

/**
 * Does `prefix` own `path`? True when the path equals the prefix or continues
 * with a `/`. `'/'` matches only itself — every path starts with it, so the
 * root has to be exact or Home would own the entire app. The shell's own
 * function (`@marinoscar/platform-web/shell/headless`, #868), re-exported.
 */
export { owns };

/**
 * Route prefixes each destination owns. Child routes are covered by their
 * parent prefix (`/admin/settings/users`, `/settings/profile`, …) and do not
 * need their own entries.
 *
 * `console` owns the bare `/admin` rather than `/admin/settings`, even though
 * `/admin/settings` is where it NAVIGATES. The two are different questions:
 * `path` is where the row sends you, `DESTINATION_ROUTES` is what makes the row
 * light up. `/admin/users` still exists as a redirect route (#92) and a
 * bookmark still lands on it for one render — with only `/admin/settings` in
 * this list that render would highlight nothing, and the route-ownership test
 * would fail it as "neither owned nor deliberately unowned".
 */
export const DESTINATION_ROUTES: Record<DestinationKey, readonly string[]> = {
  home: ['/'],
  settings: ['/settings'],
  console: ['/admin'],
  // Issue #425, epic #419. The AI Playground. `/ai` only — the per-user AI
  // Keys page lives at `/settings/ai` and so belongs to `settings`, and the
  // admin AI pages at `/admin/settings/ai*` belong to `console`.
  ai: ['/ai'],
};

/**
 * Routes deliberately owned by NO destination.
 *
 * These are reached from outside the authenticated shell entirely — the login
 * flow, the OAuth round trip, the device-activation screen — and most do not
 * even mount `Layout`. **On these routes no destination renders as active, and
 * that is correct rather than a bug.** Exported so a test can assert it
 * explicitly, which is what stops a future contributor from "fixing" it into
 * highlighting something arbitrary.
 */
export const UNOWNED_ROUTES: readonly string[] = [
  '/login',
  '/auth/callback',
  '/activate',
  '/testing/login',
  // Issue #731. The public link page (`/s#lnk_…`): anyone holding a share
  // link, signed in or not, outside the shell.
  '/s',
];

/**
 * A navigation destination, fully described for every surface that draws it:
 * the shell's `ShellDestination` (#868) over this app's keys. Every field is
 * documented there: `label` and `compactLabel`, `Icon` (a component, never an
 * element), `path`, `permission` (the API permission that makes it REACHABLE,
 * the same string the controller enforces), `anyPermission` (any one of them;
 * AND-ed with `permission` when both are set, which is why it is a separate
 * field: an array in `permission` would read as ALL), `pinned` (the rail's
 * foot, #105) and `feature` (#425, the fail-closed feature gate).
 */
export type Destination = ShellDestination<DestinationKey>;

/**
 * Is `destination` visible to a user with this `hasPermission` predicate?
 *
 * EVERY surface calls this rather than testing `destination.permission`
 * inline. Four surfaces (rail, bottom bar, user menu, quick actions) each ran
 * their own `!destination.permission || hasPermission(...)` expression, and
 * every one of them silently ignored `anyPermission` the moment it was added —
 * the `console` row would have appeared for everyone. One function is the same
 * fix this file's header describes for the paths themselves.
 *
 * The shell's own function (#868), re-exported: the rail, the bottom bar and
 * the user menu of `@marinoscar/platform-web/shell/ui` call it too.
 */
export { isDestinationVisible };

/**
 * The four destinations, in navigation order.
 *
 * Declaration order IS navigation order on every surface. The rail is the one
 * exception, and only for the tail of the list: it lifts `pinned` destinations
 * out to its foot (#105) while leaving the rest in this order.
 *
 * GATING IS BY PERMISSION, NOT BY ROLE, and the permission is the one the API
 * actually enforces — verified against the controllers rather than assumed:
 *
 *   - `users.controller.ts`           → `users:read`
 *   - `system-settings.controller.ts` → `system_settings:read`
 *   - `org-members.controller.ts`     → `org_members:read` (#726, an ORG
 *     permission: an organization's administrator who operates nothing else)
 *
 * `console` is reachable on ANY of those (see `anyPermission`), because
 * `/admin/settings` fronts pages from all three controllers and a user entitled
 * to only one of them must still reach the surface. The per-page gates inside
 * `/admin/settings/*` are what decide which cards and routes that user actually
 * gets — `config/adminSections.tsx` declares them, and `App.tsx` wraps each
 * route in the matching `RequirePermission`.
 *
 * That is the same REACHABILITY-vs-CONTENT split this file has always drawn:
 * the Users & Allowlist page gates on `users:read` to be reached, while its
 * Allowlist half gates itself on `allowlist:read` inside the page, because its
 * data comes from `allowlist.controller.ts`.
 *
 * `isAdmin` is no longer a navigation gate anywhere. It still exists (and
 * `AdminOnly` with it) for non-navigation uses, but a role check here is what
 * produced the split-brain described in the file header.
 */
export const DESTINATIONS: readonly Destination[] = [
  {
    key: 'home',
    label: 'Home',
    compactLabel: 'Home',
    Icon: HomeIcon,
    path: '/',
  },
  {
    key: 'settings',
    label: 'User Settings',
    compactLabel: 'Settings',
    Icon: SettingsIcon,
    path: '/settings',
  },
  {
    key: 'console',
    label: 'Console',
    compactLabel: 'Console',
    Icon: AdminIcon,
    path: '/admin/settings',
    // `org_members:read` (#726): an organization's own administrator holds no
    // system permission, and the Organization card is their whole Console.
    anyPermission: ['system_settings:read', 'users:read', 'org_members:read'],
    // Pinned at the rail's foot (#105) — a mode, not a third library
    // destination. The permission gate above still runs first: a user who
    // cannot reach Console gets no pinned row AND no stray divider.
    pinned: true,
  },
  {
    // Issue #425, epic #419 — the fourth and, by the bottom bar's ceiling,
    // last destination. `ai:use` is the literal string the consumer AI
    // controllers enforce (`PERMISSIONS.AI_USE`), and `feature: 'ai'` hides it
    // while AI is switched off, where every call it would make answers
    // `403 AI_DISABLED`.
    //
    // ADMIN-ONLY (#593). The Playground is an OPERATOR tool — for checking
    // that a provider, model and key actually work — not an end-user feature,
    // so it additionally requires `ai_config:read`: the exact string the admin
    // `/api/admin/ai/*` controllers enforce, granted only to `Admin` in the
    // seed. The consumer `/api/ai/*` endpoints deliberately stay on `ai:use`
    // alone, because in-app AI features (the telemetry assistant, a fork's
    // own features) call them on behalf of ordinary users. Both strings are
    // required: `permission` and `anyPermission` AND together.
    //
    // DECLARED AFTER `console`, deliberately. Declaration order is navigation
    // order on the bottom bar and the user menu, and appending leaves the three
    // existing tabs exactly where users learnt them. The rail lifts `console`
    // (pinned) to its foot regardless, so there AI sits after Settings in the
    // library list.
    key: 'ai',
    label: 'AI Playground',
    compactLabel: 'AI',
    Icon: AutoAwesomeIcon,
    path: '/ai',
    permission: 'ai:use',
    anyPermission: ['ai_config:read'],
    feature: 'ai',
  },
];

/**
 * Which destination, if any, owns `pathname`.
 *
 * Longest prefix wins where prefixes overlap. `/admin` is a single prefix
 * today, so nothing under it competes — but the rule is what keeps `/` from
 * winning everything (it is handled by `owns`' exact-match case) and what will
 * keep a future sibling prefix correct without touching this function.
 */
export function resolveActiveDestination(pathname: string): DestinationKey | null {
  return resolveShellDestination(DESTINATION_ROUTES, pathname);
}
