# Settings UI

> **Status:** shipped · **Code:** `apps/web/src/config/adminSections.tsx`, `apps/web/src/config/userSettingsSections.tsx`, `packages/platform-web/src/settings/ui/SettingsHub.tsx` (`@marinoscar/platform-web/settings/ui`, since #733), `apps/web/src/components/navigation/` · **API:** none of its own (cards mirror the permissions of `/api/system-settings`, `/api/users`, `/api/admin/*`; see `/api/docs`) · **Admin UI:** `/admin/settings` · **User UI:** `/settings`

Every settings surface in the app, admin or per-user, is a searchable, permission-gated **hub** built from a declarative section registry. The hub, the Console navigation rail and the AppBar title resolver all read the same registry, so a settings page exists for all three or for none. This document is the *why* behind the rules in `CLAUDE.md`'s "MANDATORY: Settings UI Pattern" section; it does not restate them as rules.

## 1. Purpose

A settings page in an app built from this template is a **card in a registry**, not a route left to find its own way. The problem this solves: when a route, a tab, a sidebar entry and a menu entry are each declared separately with their own permission check, they drift. A page ends up reachable by URL but missing from search, absent from the rail, and titled wrongly in the compact header, because none of those consumers has any way to know it exists.

The same fix already applies one level up. `apps/web/src/config/destinations.ts` makes the sidebar, the bottom bar and the user menu read one `DESTINATIONS` array through one `isDestinationVisible` predicate. Its header records the casualty that motivated it: a Contributor holding `system_settings:read` once had a working System Settings page, a menu entry pointing at it, and no sidebar row. Three gates, three answers. The settings registries apply that fix inside `/admin/settings` and `/settings`.

What it is not:

- Not a routing framework. Routes are still declared in `App.tsx`; the registry is what makes them visible.
- Not an authorization layer. The API enforces permissions; the registry only mirrors them to decide what to show.

## 2. How it works

### Registries

| Registry | File | Hub route | Binding page |
|---|---|---|---|
| `ADMIN_SECTIONS` | `apps/web/src/config/adminSections.tsx` | `/admin/settings` | `apps/web/src/pages/Admin/SettingsHubPage.tsx` |
| `USER_SETTINGS_SECTIONS` | `apps/web/src/config/userSettingsSections.tsx` | `/settings` | `apps/web/src/pages/UserSettingsHubPage.tsx` |

Each registry is an ordered list of groups, each group an ordered list of cards. A card declares at least a `title`, a `path`, and optionally:

- `permission` — the API permission string required to see the card, or a list of strings of which the viewer must hold ANY ONE (#738; `cardPermissionGranted`, an empty list admits nobody). Absent means any authenticated user. A list exists for one destination served by one controller that accepts either of two permissions (the `Broadcasts` card: the system `broadcasts:read` and the org-scoped `org_broadcasts:read`); it is never a way to merge two pages, and never a reason for a second card.
- `feature` — a deployment feature the card depends on: `'ai'` (AI switched on), `'telemetry'` (a telemetry store deployed and collecting) or `'orgs'` (multi-organization mode: `/api/auth/me` reports `tenancyMode: 'multi'`, #726). The card is hidden unless the caller's feature map says `features[feature] === true`. `permission` asks "may this user see it?"; `feature` asks "does it exist in this deployment right now?". The feature gate is applied before `alwaysShow`.
- `alwaysShow` — an escape hatch that shows the card even when `permission` is not held. Reserved; no current card relies on it.
- `disabled` — together with no `path`, declares an inert "Coming soon" card for a page that is planned but not built.

`ADMIN_SECTIONS` has seven groups: six appended in this order, **General**, **Access**, **Operations**, **AI**, **Observability**, **Organizations**, then **Danger Zone**, pinned last (#743). The last (#726) holds two cards, both `feature: 'orgs'`, so a single-org deployment never shows it: **Organization** (`/admin/settings/organization`, `org_members:read`, the current organization's members and invitations as two parallel tabs, the Invites tab gated on `org_invites:read`) and **Organizations** (`/admin/settings/organizations`, `organizations:read`, the deployment's list of organizations). Groups and cards are append-only because the hub, the rail and the drill-down list render the array in declaration order; inserting a card moves every existing card for a reader who has learnt where they are. **The one exception is the `Danger Zone` group (#743), pinned LAST in both registries**: the admin one holds `Factory reset` (`/admin/settings/factory-reset`, `system:factory_reset`), the user one `Delete my data` (`/settings/danger-zone`, no `permission`, no `feature`). A group added later is inserted *before* it, never after: destructive actions stay at the bottom of the hub, where a reader expects them and cannot reach them by habit. `dangerZoneLastViolations` of `@marinoscar/platform-web/user-data/headless` asserts it in `settingsRegistry.test.ts`. A packaged slice contributes its cards as data (`doctorSettingsPage.card`, `telemetryAdminCards`, `identityAdminSections`, `identityUserSettingsSections`, `jobsAdminSections`), and the app places them in its own registry where they belong; the append-only rule applies to that placement unchanged. The full inventory of pages and their permissions lives in [ARCHITECTURE.md](../ARCHITECTURE.md).

`USER_SETTINGS_SECTIONS` cards (profile, appearance, notifications, tokens) declare no `permission`: they are the caller's own settings, and the API grants `user_settings:read`/`user_settings:write` to every org role (org admin, contributor, viewer), which every member holds through their membership. The exception is the `AI Keys` card (`/settings/ai`), which declares `permission: 'ai:use'` and `feature: 'ai'`, because `ai:use` is a real, withholdable grant (org admin and Contributor, not Viewer; a system administrator holds it through their `org_admin` membership). The `Groups` card (`/settings/groups`, #731) is the second: the packaged groups page of `@marinoscar/platform-web/sharing/ui`, built from its descriptor (`groupsSettingsPage.card`) and appended as the only card of a last `Sharing` section, declares `permission: 'groups:read'`, the org permission the `/api/groups` controller enforces. Its detail page (`/settings/groups/:id`) sits under the card's path, so the title resolver names it `Groups`; a `groups:admin` holder gets an in-page "All groups" switch, never a second (admin) card.

### Consumers

Three consumers read the registries instead of keeping their own list:

1. **The hub** — `SettingsHub.tsx`, rendered by the two binding pages. A card grid at `sm` and up; a drill-down list below it.
2. **The Console rail** — `NavigationRail.tsx`. On any `/admin/*` route the expanded rail swaps its contents for the admin sections, promoting the hub's cards into persistent navigation.
3. **The AppBar title resolver** — `AppBar.tsx`'s `resolveDrillDown`, backed by `settingsPageTitle`. Resolves the current pathname to the compact header's title and its "up" destination. The longest matching card path wins, which is why a nested card such as `/admin/settings/jobs/insights` is titled "Job Insights" rather than "Jobs".

Two functions, both exported from `adminSections.tsx`, do the work for every surface:

- `visibleSettingsSections(sections, hasPermission, query, features)` — filters by permission, feature and search. Search matches a card's title only. A group left with no cards is dropped entirely rather than rendered as a bare header.
- `settingsPageTitle` — pathname to title, respecting path-segment boundaries, falling back to the hub title.

`userSettingsSections.tsx` declares data only. Copying the permission gate to serve a second surface would reintroduce, on day one, the drift the registry exists to prevent.

### Cards vs. tabs

Tabs remain legitimate **inside** one destination, but only for genuinely parallel content. The distinction:

- A **destination gate** (which registry card exists, which route it points at) is about **reachability**: can this user get to this page at all.
- A **tab gate** (inside one already-reached page) is about **content**: given that the user is here, which parts can they use.

The live example is the Users & Allowlist page (`UsersPage` of `@marinoscar/platform-web/identity/ui`, `packages/platform-web/src/identity/ui/users/UsersPage.tsx`) at `/admin/settings/users`, which keeps two tabs, Users and Allowlist. They are two views of one question ("who may use this application"), backed by two controllers:

- The card (destination) gate is `users:read`, enforced by `users.controller.ts`.
- The Allowlist tab wraps `<AllowlistTable />` in `<RequirePermission permission="allowlist:read">`, because that data comes from `allowlist.controller.ts`.

A `users:read`-only admin reaches the page and sees Users; the Allowlist tab renders its own permission-denied message in place. Collapsing the two gates into one would either hide the whole page from that admin, or render a tab that can only ever 403.

The test for tabs: are these the same subject, with independent permission stories that both belong on the screen once the user is there? Users/Allowlist passes. Content that is really several separate destinations filed under one page fails it and becomes separate cards.

### Permissions are mirrored

A card's `permission` is the literal string the API controller enforces. The hub, rail and title resolver decide what to show purely from the viewer's permissions (`cardPermissionGranted(card.permission, hasPermission)`: the one string, or any one of a list), with no API round trip. If the string drifted, the registry would either hide a page the API would serve, or show a card whose click leads straight into a 403. Both sides read the same names from `apps/api/src/common/constants/roles.constants.ts` (`PERMISSIONS.*`), which makes the mirror checkable.

| Card permission | Enforced by |
|---|---|
| `system_settings:read` | `packages/platform-api/src/settings/system-settings/system-settings.controller.ts` (Notifications card); `packages/platform-api/src/email/email-settings.controller.ts`, `apps/api/src/common/maintenance/maintenance.controller.ts`, `apps/api/src/about/about.controller.ts` (Email, Maintenance, About) |
| `users:read` | `packages/platform-api/src/identity/users/users.controller.ts` |
| `allowlist:read` | `packages/platform-api/src/identity/allowlist/allowlist.controller.ts` (gates the Allowlist **tab**, not the route) |
| `push:read` | `packages/platform-api/src/notifications/push-config.controller.ts` |
| `storage_config:read` | `packages/platform-api/src/storage/config/storage-config.controller.ts` |
| `jobs:read` | `apps/api/src/jobs/job-admin.controller.ts` |
| `nodes:read` | `apps/api/src/nodes/nodes-admin.controller.ts` |
| `db_backup:read` | `packages/platform-api/src/db-backup/db-backup.controller.ts` |
| `['broadcasts:read', 'org_broadcasts:read']` | `packages/platform-api/src/notifications/broadcasts/broadcasts.controller.ts` (Broadcasts card; ANY OF the two: the controller declares `@Auth({ anyPermissions })` with the system and the org pair, #738) |
| `ai_config:read` | `packages/platform-api/src/ai/config/ai-admin.controller.ts` (AI, AI Models, AI Usage) |
| `org_ai_config:read` | `packages/platform-api/src/ai/keys/org-keys.controller.ts` (Organization AI keys) |
| `ai:use` | `packages/platform-api/src/ai/keys/user-ai-keys.controller.ts` (user `AI Keys` card) |
| `groups:read` | `packages/platform-api/src/sharing/groups/groups.controller.ts` (user `Groups` card; an ORG permission, `SHARING_PERMISSIONS.GROUPS_READ`) |
| `org_members:read` | `packages/platform-api/src/identity/organizations/org-members.controller.ts` (Organization card; an ORG permission, held through `org_admin`). `org_invites:read` (`org-invites.controller.ts`) gates the Invites **tab** |
| `organizations:read` | `packages/platform-api/src/identity/organizations/organizations-admin.controller.ts` (Organizations card; a SYSTEM permission) |

Two consequences:

- **Only the read permission is a card's `permission`.** Every write a card leads to (saving settings, retrying a job, revoking a node credential, restoring a backup) is gated inside the page by disabling controls.
- **A list is the controller's own any-of, never a widening.** The `Broadcasts` card lists exactly the two strings `broadcasts.controller.ts` passes to `@Auth({ anyPermissions })`, and the route's `RequirePermission permissions={[...]}` the same list (`destinations.test.ts` compares them). A second `Org broadcasts` card for the same page was rejected: one destination, one card.
- **A permission split at the API is never re-merged in the registry.** `nodes:read` is not `jobs:read`; `db_backup:read` is not `system_settings:read`. A deployment can grant one without the other, and a card gated on the wrong one would silently offer or withhold access the API disagrees about.

### One hub component

`SettingsHub.tsx` takes `sections`, `hubKey`, `title`, `subtitle` and `features` as props and names neither surface internally. `UserSettingsHubPage.tsx` is the worked example: a binding with no rendering logic of its own. It contributes the registry, a scroll-restoration key (`hubKey`) namespaced so the two hubs never clobber each other's scroll offset, surface-specific prose, and the feature map it reads from `useAiConfig()`. A hub copied from the admin one would duplicate two responsive treatments and an empty state: four places to fix every future bug.

Since #733 the hub is platform structure: `SettingsHub`, `SettingsCardDef`, `SettingsSectionDef`, `visibleSettingsSections`, `settingsPageTitle` and `isFeatureEnabled` live in `@marinoscar/platform-web/settings/ui` (moved without behavioural change), while the registries, the routes and the binding pages stay in the app. Two props are the app's seams: `hasPermission` (default: the platform host viewer's) and `useScrollRestoration` (the app's hook; default none).

### An open feature key

`feature` is typed `SettingsFeatureKey`, `keyof SettingsFeatureRegistry`. The platform declares `ai` and `telemetry`; an app adds its own key by module augmentation and registers how to read it, a hook that reads the app's context and never fetches:

```ts
declare module '@marinoscar/platform-web/settings/headless' {
  interface SettingsFeatureRegistry { orgs: true }
}
registerSettingsFeature('orgs', useOrgsFeature);
```

`useSettingsFeatures()` asks every registered resolver in registration order, so the hub, the rail and the AppBar read one map. The set is fixed once it rendered (register at module scope). The reference app registers `ai`, `telemetry` and its own `orgs` in `apps/web/src/hooks/useSettingsFeatures.ts`.

### Breakpoint gates

Five places in the shell decide, independently, whether the viewport is "compact" (below `sm`, 600px). All five move together. `apps/web/src/components/common/Layout.tsx` carries the canonical list in a comment.

| # | Location | Expression | What it decides |
|---|---|---|---|
| 1 | `Layout.tsx` `showRail` | `useMediaQuery(theme.breakpoints.up('sm'))` | Mounts or unmounts `NavigationRail` |
| 2 | `BottomNav.tsx` self-gate | `useMediaQuery(theme.breakpoints.down('sm'))` | Returns `null` outside compact width, even if mounted |
| 3 | `Layout.tsx` `<main>` padding | `pb: { xs: 10, sm: 3 }` | Clears the fixed bottom bar |
| 4 | `SettingsHub.tsx` `isCompactWindow` (`packages/platform-web/src/settings/ui/`, since #733) | `down('sm')` | Drill-down list vs. card grid |
| 5 | `AppBar.tsx` `isCompactWindow` | `down('sm')` | Back arrow plus resolved title vs. wordmark toolbar |

`Layout` only mounts `BottomNav` when `!showRail`; gate 2 is belt and braces so the bar's output never appears at the wrong width.

The boundary is `sm` (600px), never `md` (900px). 600px is Material 3's compact/medium window-class boundary, and M3 specifies a permanent rail, not a bottom bar, from medium upward. Gating at 900px hands the phone treatment to an iPad in portrait (768px), an iPad Pro 11" (834px), an unfolded foldable, and a phone in landscape.

### Accessibility requirements

- **The search field has an explicit accessible name**: `aria-label="Search settings"`. A placeholder disappears once the user types.
- **The clear-search button renders only when there is something to clear.** A permanent clear button on an empty field is a dead tab stop.
- **Compact vs. expanded is decided by mounting, never by CSS hiding.** `SettingsHub.tsx` (list vs. grid) and `Layout.tsx` (rail vs. bottom bar) both follow this. A hidden duplicate doubles the tab order with invisible targets and gives `aria-current` two owners.
- **An inert ("Coming soon") card is not a tab stop.** The grid renders it with no `CardActionArea`; the drill-down renders a `disabled` `ListItemButton`.
- **The rail's landmark names its mode**: the `<nav>` `aria-label` is `"Console navigation"` in Console mode and `"Main navigation"` otherwise.
- **`aria-current="page"` has a single source of truth**, computed from the destination/console-active-path model, so exactly one row claims it.
- **A row's accessible name is explicit.** `RailRow`'s `accessibleName` prop carries the full name even when the visible caption is a truncated `compactLabel`; the caption is `aria-hidden`.
- **A tooltip supplements, never substitutes.** Collapsed rows get a `Tooltip` only where the visible text is genuinely shortened, never as the only carrier of the full name.
- **Keyboard focus is visible on every navigation control**, via an explicit `&.Mui-focusVisible` outline in `NavigationRail.tsx`.
- **The collapse toggle is a real `<button>` with `aria-expanded`.**

### The Organization settings card

`Organization settings` (#733) is the third card of the appended `Organizations` group: `/admin/settings/organization-settings`, `org_settings:read` (the org permission `org-settings.controller.ts` of `@marinoscar/platform-api/settings` enforces), `feature: 'orgs'`. A card next to `Organization`, never a tab on it: "how this organization is configured" is a different question from "who belongs to it". The page renders a form generated from the namespace descriptors of `GET /api/org-settings` (boolean, enum, number and string fields; any other shape links to the owning slice's page) and disables every control without `org_settings:write`, and the controls of a namespace whose own write permission the caller lacks.

## 3. Configuration and permissions

- **Settings:** none. The registries are code.
- **Environment variables:** none.
- **Permissions:** each card names one, per the mirror table in §2. The full permission matrix lives in [ARCHITECTURE.md](../ARCHITECTURE.md).
- **Feature map:** `features.ai` comes from `GET /api/ai/config` (via `useAiConfig()`), reachable by any authenticated user; `features.telemetry` from `GET /api/telemetry/config`; `features.orgs` from the signed-in user's `tenancyMode` on `GET /api/auth/me` (`useOrgsFeature()`, #726). `useSettingsFeatures()` (the open feature registry of `@marinoscar/platform-web/settings/headless`, #733) merges the three.
- **API surface:** none of its own.

## 4. Extending it in a fork

To add a settings page:

1. Build the page component and add its route in `App.tsx`.
2. Add a card to `ADMIN_SECTIONS` (admin) or `USER_SETTINGS_SECTIONS` (per-user). Append it to the end of the right group, or append a new group; do not insert. A new group goes immediately before the pinned `Danger Zone` group, which stays last.
3. Set `permission` to the exact read permission the page's controller enforces, copied from `roles.constants.ts`. Gate writes inside the page.
4. If the page depends on a deployment feature, set `feature`. Do not put `feature` on the page that turns that feature on (the admin `AI` card carries none, or the switch would be unreachable in the state it exists to change).
5. Nest a sub-page's path under its parent (`/admin/settings/ai/models`) so `settingsPageTitle`'s longest-prefix rule titles it correctly.
6. If the card introduces a permission string new to either registry, add it to `DEFAULT_PERMISSIONS` in `apps/web/visual/main.tsx` in the same change (see §5).
7. Do not add a new tab to an existing settings page. Add a tab only for parallel content inside one destination (§2, Cards vs. tabs).
8. A new settings **surface** (a third hub) is another binding over `SettingsHub` (`@marinoscar/platform-web/settings/ui`), never a copy of it.
9. A new deployment feature is a `SettingsFeatureRegistry` augmentation plus one `registerSettingsFeature` call (§2, An open feature key).

**The API side of a new setting.** A page that edits a new block of the `global` system settings document, or a new per-user preference, needs a settings **namespace** on the API first. Declare it once, beside the owning module, and register it through the namespace registries of `@marinoscar/platform-api/settings`, listed in the app's manifests (`apps/api/src/settings/registry/`): the request-body DTOs, the stored schema, the defaults and the service's PATCH merge are all derived from that one declaration, so the page's PUT or PATCH cannot be silently stripped by a schema somebody forgot. A fork declares its namespaces, or fields inside a platform namespace, in `apps/api/src/app-registrations/settings.ts`. The recipe is [settings/registry/README.md](../../apps/api/src/settings/registry/README.md). The card's `permission` stays the controller's (`system_settings:read` for `/api/system-settings`); a namespace adds no permission. A namespace an organization may override declares an `org` block, and then appears on the `Organization settings` page without any web change ([settings slice README](../../packages/platform-api/src/settings/README.md#merge-modes-of-an-org-layer)).

## 5. Guardrails

| Test | What it enforces |
|---|---|
| `apps/web/src/__tests__/config/settingsRegistry.test.ts` | `visibleSettingsSections` drops unpermitted cards and emptied groups; search is title-only and composes with the permission gate; `settingsPageTitle` longest-match, segment boundaries and fallback; new cards carry their controller's exact permission, are not `alwaysShow`, and appear in hub, rail and title resolver together |
| `apps/web/src/__tests__/config/userSettingsSections.test.ts` | Per-user cards (e.g. Notifications) declare no `permission` |
| `apps/web/src/__tests__/config/aiSettingsRegistry.test.ts` | Every card tagged `feature: 'ai'` or routed under an AI path carries the literal permission string the API controller source enforces, read off disk |
| `apps/web/src/__tests__/config/destinations.test.ts` | `/admin/settings`'s route gate matches `console`'s `anyPermission` in `destinations.ts`; no `App.tsx` route is claimed by two destinations |
| `apps/web/src/__tests__/components/settings/SettingsHub.test.tsx` | Correct cards for a permission-limited user, click navigation, grid vs. drill-down at the right width, independent scroll offsets per hub |

The Playwright visual-regression harness has one manual coupling. `apps/web/visual/main.tsx`'s `DEFAULT_PERMISSIONS` is a hand-maintained list of permission strings that seeds the harness's fake user. It is not derived from the registries. A card whose permission is missing from that list is filtered out for the fake user, so the baselines pass green over a grid with one card fewer than the one that ships.

## 6. Design decisions

- **Permission, not role, gates cards.** "Is this user an Admin" and "does this user hold `system_settings:read`" diverge the moment permissions are assigned outside the default role templates. A role check produced the original three-gates-three-answers split.
- **Tabs rejected for hierarchical content.** The former `SystemSettingsPage` held three tabs (UI Settings, Feature Flags, Advanced JSON) that were three unrelated surfaces with different permissions (Advanced JSON needed `system_settings:write`). `<Tabs>` has no per-tab permission primitive, and tabs cannot be deep-linked, searched, or promoted into the rail. They became three cards, and were later removed as unused.
- **One parameterised hub, not two.** A second hub built by copying the first is the navigation split-brain again, one layer down. `SettingsHub.tsx` takes `sections` as a prop for the same reason `visibleSettingsSections` does.
- **`md` (900px) rejected as the compact boundary.** It is not what Material 3 specifies and it misclassifies the 600–899px band (§2, Breakpoint gates).
- **No shared constant for the breakpoint gates.** Gates 1, 2, 4 and 5 are `useMediaQuery` calls taking the breakpoint as an argument, so a constant would bind them. Gate 3 is a key in an `sx` object literal (`{ xs: 10, sm: 3 }`); binding it needs a computed key nothing forces a future edit to use, and TypeScript raises no error if it drifts. A constant would bind four gates, imply the fifth is covered, and leave the most-forgotten member as free to drift as before. The checklist in `Layout.tsx` is the guard.
- **Append-only group and card order.** Readers learn where cards are; an insertion moves every card after it. Danger Zone pinned last (#743) is the single exception: moving it to the end each time a group is appended would itself be the reorder the rule forbids, so it is fixed in place and new groups land before it.

## 7. Verification

```bash
cd apps/web && npx vitest run src/__tests__/config src/__tests__/components/settings/SettingsHub.test.tsx
```

Manually:

1. Sign in as an Admin and open `/admin/settings`. Every card in `ADMIN_SECTIONS` appears, in declaration order, grouped General, Access, Operations, AI. The AI Models and AI Usage cards appear only while AI is enabled.
2. Type in the search field: only cards whose title matches remain; empty groups disappear.
3. Open any card. On a `/admin/*` route the expanded rail shows the admin sections (Console mode).
4. Narrow the window below 600px: the rail unmounts, the bottom bar appears, the hub switches to the drill-down list, and the AppBar shows a back arrow with the page's title.
5. Sign in as a Viewer and open `/settings`. The AI Keys card is absent (Viewer lacks `ai:use`).

## History

- #55 (epic #51): top-level navigation unified behind `destinations.ts`.
- Epic #90 (#91–#96): settings hub and registries; `SystemSettingsPage` tabs split into cards; `/settings` user hub (#96).
- #225, #325: Notifications and Broadcasts cards added under the registry rules.
- #366: the System, Feature Flags and Advanced (JSON) cards and the `ui`/`features` system-settings namespaces removed as unused.
- #425 (epic #419): feature-gated cards (`feature: 'ai'`) and the AI admin group.
- #499: `ai:use` withdrawn from Viewer, so the AI Keys card is permission-gated.
- #677: the API's settings namespaces became registries; §4 points UI authors at the API-side recipe.
- #726 (PP-6.7): the `orgs` feature (multi-organization mode) and the appended Organizations group: `Organization` (`org_members:read`, Members and Invites tabs) and `Organizations` (`organizations:read`). `console` reachability gains `org_members:read`.
- #733 (PP-8.1): `SettingsHub` and the registry helpers moved into `@marinoscar/platform-web/settings/ui` (breakpoint gate 4 with it, unchanged); the feature key became open (`SettingsFeatureRegistry`, `registerSettingsFeature`); the `Organization settings` card appended to the Organizations group.
- #743 (PP-9.1): the `Danger Zone` group, pinned last in both registries (`Factory reset`, `system:factory_reset`; `Delete my data`, ungated), the one documented exception to append-only.
