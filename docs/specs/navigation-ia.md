# Navigation Information Architecture

> Epic #51, issue #55. Implemented in `apps/web/src/config/destinations.ts`,
> `apps/web/src/components/common/Layout.tsx`, and
> `apps/web/src/components/navigation/`.

Why the navigation shell is a declarative destination registry plus three
per-breakpoint chromes, rather than a drawer with hand-maintained menu lists —
and why the fix had to happen in four places that all used to disagree.

> **Issue numbers in ported code comments.** Some comments in
> `apps/web/src/components/navigation/**` and `apps/web/src/config/destinations.ts`
> reference the origin project's own epic and issue numbers (its navigation
> work landed as epic `#388`). Those numbers mean nothing in this tracker. In
> this repo, the work described here is epic
> [#51](https://github.com/marinoscar/EnterpriseAppBase/issues/51) and issue
> [#55](https://github.com/marinoscar/EnterpriseAppBase/issues/55).

---

## 1. The problem

The navigation drawer (`Sidebar.tsx`, now deleted) was `variant="temporary"`
at every breakpoint — there was no permanent desktop chrome at any width, so
reaching any page cost a tap to open the drawer before navigation could even
begin. It carried hardcoded AppBar-height offsets, `disablePortal: true`, and
a `setTimeout(() => navigate(path), 0)` that existed purely to let the
drawer's close animation finish before the route actually changed.
`useMediaQuery` was never used for layout anywhere in the app.

**Menu paths were duplicated across four files** — `App.tsx`, `Sidebar.tsx`,
`UserMenu.tsx`, and `components/home/QuickActions.tsx` — each with its own
idea of the same four destinations, and nothing linking them.

That duplication produced **three inconsistent permission-gating idioms**:
`Sidebar` gated on role `admin`; `UserMenu` gated on permission
`system_settings:read`; `QuickActions` used a hybrid `permission` +
`adminOnly` schema. A Contributor granted `system_settings:read` therefore saw
the menu entry and the quick action but no sidebar row for the same page — a
working route with no way in from the primary nav. Meanwhile
`RequirePermission.tsx` and `AdminOnly.tsx` already existed in the codebase
but had **zero usages**: route-level authorization did not exist at all.
`ProtectedRoute` only checked authentication, so a Viewer who typed
`/admin/settings` directly reached the page and only then watched every API
call on it return `403`.

`Sidebar`'s active-route check was also a bare `startsWith`, which would match
`/settings` against `/settingsfoo` — a bug nobody happened to trigger only
because no such route existed yet.

---

## 2. Target information architecture

This repo ships **four flat destinations** — Home, User Settings, User
Management, System Settings — declared once in
`apps/web/src/config/destinations.ts`:

```ts
export type DestinationKey = 'home' | 'settings' | 'users' | 'system';

export interface Destination {
  key: DestinationKey;
  label: string;          // full label: expanded rail, bottom bar, user menu
  compactLabel: string;   // shown in the 56px collapsed rail
  Icon: SvgIconComponent; // a component, never a rendered element
  path: string;
  permission?: string;    // absent -> any authenticated user
}
```

`Icon` is declared as a component rather than an element specifically because
different surfaces draw it at different sizes — the rail at `small` when
collapsed and `medium` when expanded, the bottom bar at its own fixed size —
so the size cannot be baked into the registry entry.

### 2.1 Route ownership and segment-boundary matching

```ts
export const DESTINATION_ROUTES: Record<DestinationKey, readonly string[]> = {
  home: ['/'],
  settings: ['/settings'],
  users: ['/admin/users'],
  system: ['/admin/settings'],
};

export function owns(prefix: string, path: string): boolean {
  if (prefix === '/') return path === '/';
  return path === prefix || path.startsWith(`${prefix}/`);
}
```

A bare `startsWith` — what `Sidebar` used to do — makes `/settings` own
`/settingsfoo` and `/admin/users` own `/admin/users-archive`. `owns()`
requires the path to equal the prefix or continue with a `/` immediately
after it, which is what a segment boundary means. `/` is handled separately
because every path starts with `/`; without the exact-match special case,
Home would own the entire application.

`resolveActiveDestination(pathname)` resolves the **longest matching prefix**
when routes overlap, which matters immediately here: `/admin/users` and
`/admin/settings` are siblings under a shared `/admin` segment, so if
anything ever claimed the bare `/admin` prefix, the more specific sibling
still has to win on its own route.

Two rules make the ownership table something other people can trust without
re-checking it:

1. **A route is owned by at most one destination**, asserted by a test
   (`apps/web/src/__tests__/config/destinations.test.ts`) against the live
   route list in `App.tsx` — which is what keeps the table honest as routes
   are added; it fails loudly the day a route is added and this file is not.
2. **Some routes are deliberately owned by no destination at all** — `/login`,
   `/auth/callback`, `/activate`, `/testing/login` — because they are reached
   from outside the authenticated shell entirely (the login flow, the OAuth
   round trip, device activation) and most do not even mount `Layout`. On
   these routes, **no destination renders as active, and that is correct
   rather than a bug**: `UNOWNED_ROUTES` is exported specifically so a test
   can assert this explicitly, which is what stops a future contributor from
   "fixing" it into highlighting something arbitrary.

### 2.2 Gating: permission, not role — and the same permission the API enforces

```ts
export const DESTINATIONS: readonly Destination[] = [
  { key: 'home',     label: 'Home',            compactLabel: 'Home',     Icon: HomeIcon,     path: '/' },
  { key: 'settings', label: 'User Settings',    compactLabel: 'Settings', Icon: SettingsIcon, path: '/settings' },
  { key: 'users',    label: 'User Management',  compactLabel: 'Users',    Icon: PeopleIcon,   path: '/admin/users',    permission: 'users:read' },
  { key: 'system',   label: 'System Settings',  compactLabel: 'System',  Icon: AdminIcon,    path: '/admin/settings', permission: 'system_settings:read' },
];
```

Every gated destination's `permission` is the **exact string its controller
enforces**, verified against the controllers rather than assumed:
`/admin/users` gates on `users:read` (`users.controller.ts`), `/admin/settings`
gates on `system_settings:read` (`system-settings.controller.ts`). `isAdmin`
is no longer a navigation gate anywhere — it is what produced the split-brain
in §1, and gating on a role the API does not itself check is how a rail, a
menu and a route end up disagreeing about who may go where.

`/admin/users` hosts two tabs backed by two different controllers: Users
(`users:read`) and Allowlist (`allowlist:read`). The **destination** gates on
`users:read` only — a destination gate is about *reachability*, and the page
is worth reaching for its Users tab alone — while the Allowlist tab gates
itself on `allowlist:read` inside the page, because a tab gate is about
*content*. Conflating the two would either hide the whole page from someone
who can use half of it, or expose a tab whose data 403s.

### 2.3 Route-level enforcement closes the guess-the-URL gap

`RequirePermission` — previously dead code with zero usages — is now wired
directly into `App.tsx` on both gated routes:

```tsx
<Route
  path="/admin/users"
  element={
    <RequirePermission permission="users:read" fallback={<Navigate to="/" replace />}>
      <UserManagementPage />
    </RequirePermission>
  }
/>
```

`ProtectedRoute` above it in the tree only establishes that someone is signed
in; before this, a Viewer who typed `/admin/settings` directly still reached
the page and only then watched every API call on it return `403`. The
permission named on the route is the same string the corresponding
destination declares and the same string the controller enforces — so the
rail row, the bottom-bar tab, the user-menu entry, the quick action, and the
route itself can no longer disagree about who may go where, which is the
concrete fix for the split-brain bug in §1.

---

## 3. Per-breakpoint layouts

Three chromes, chosen by **mounting, not by rendering-then-hiding**:

| Breakpoint | Chrome |
| --- | --- |
| `< sm` (< 600px) | Bottom bar only — no drawer, no hamburger |
| `sm` – `lg` (600–1199px) | Permanent collapsed rail, 56px |
| `≥ lg` (≥ 1200px) | Same rail, expanded to 220px with labelled rows and a collapse toggle |

600px is deliberately **Material 3's compact/medium window-class boundary**
(compact is `< 600dp`, medium is `600–840dp`), and Material 3 states directly
that a rail is the correct chrome from medium upward. Gating at MUI's `md`
(900px) instead would hand the *phone* treatment to every 600–899px device —
tablets in portrait (iPad at 768px, iPad Pro 11" at 834px), unfolded
foldables, and phones in landscape.

### 3.1 The coupled-gate invariant

`Layout.tsx` decides which chrome mounts with a single `useMediaQuery`:

```ts
const showRail = useMediaQuery(theme.breakpoints.up('sm'));
// ...
{showRail && <NavigationRail />}
// ...
{!showRail && <BottomNav />}
```

`BottomNav` independently gates itself with the *exact complement*:

```ts
const isCompactWindow = useMediaQuery(theme.breakpoints.down('sm'));
if (!isCompactWindow) return null;
```

**Exactly one navigation surface may be mounted at any width, and the two
gates are exact complements of the same breakpoint** — `up('sm')` and
`down('sm')` — not two independently-evaluated queries that could disagree at
a boundary pixel. `Layout.tsx`'s own comment names this explicitly as three
coupled gates that must move together:

1. `Layout`'s `showRail` — mounts/unmounts the rail.
2. `BottomNav`'s own `down('sm')` — belt-and-braces self-gating, since a
   component that self-gates but is *always mounted* would still run its
   hooks at every width even while rendering nothing.
3. `<main>`'s bottom padding (`pb: { xs: 10, sm: 3 }`) — clears the bottom
   bar's fixed height, and is only needed at the widths the bar actually
   exists.

There is deliberately **no shared constant** binding these three together —
a constant would let the third one (padding) drift out of sync while the
build still compiled cleanly, silently reopening the gap it exists to close.
The invariant is enforced by a comment and a convention, not by the type
system, which is why it is stated as loudly as it is at the one place
(`Layout.tsx`) all three are visible together.

### 3.2 Mount-don't-hide, and what it removes

Because the drawer this replaced was CSS-hidden rather than conditionally
mounted, `Layout` used to own drawer-open state, a `setTimeout` to sequence
navigation behind the close animation, and hardcoded AppBar-height offsets to
keep the drawer positioned correctly beneath the bar. None of that exists
anymore: below `sm` there is no drawer to open, so there is no drawer state to
manage and no close animation to race against. `NavigationRail`'s own header
comment states the mechanical consequence directly: a permanent rail costs
*zero* taps to navigate where a temporary drawer cost one before navigation
could even begin, and with no drawer to close, the navigate-after-close race
cannot occur at all — not "is handled better," but structurally absent.

### 3.3 The rail's two treatments, one component

`NavigationRail` renders one component with two visual treatments rather than
two components, switched on `useMediaQuery(theme.breakpoints.up('lg'))`:

- **Collapsed (`sm`–`lg`, 56px)** — icon over a short caption
  (`compactLabel`), always this treatment regardless of any stored
  preference.
- **Expanded (`≥ lg`, 220px)** — icon plus full `label`, with a desktop-only
  collapse toggle a user can use to opt into the collapsed treatment even at
  desktop width (§5).

The medium tier is **always** collapsed, independent of `railCollapsed`.
Honoring a stale `railCollapsed: false` below `lg` would render a 220px rail
on a 600px screen — roughly a third of the viewport spent on chrome — which is
exactly the state `expanded = isDesktop && !railCollapsed` is written to
prevent: the stored preference can only ever narrow the rail at desktop width,
never widen it below `lg`.

### 3.4 Unified permission gating across every surface

`BottomNav`, `NavigationRail`, `UserMenu`, and `QuickActions` (the fourth
duplicated menu source named in §1) all now filter the same
`DESTINATIONS` array through the same `usePermissions().hasPermission`
predicate:

```ts
const visibleDestinations = DESTINATIONS.filter(
  (destination) => !destination.permission || hasPermission(destination.permission),
);
```

None of the four hand-rolls its own list or its own gating condition anymore.
This is the direct fix for the bug in §1: a Contributor holding
`system_settings:read` now sees System Settings in every one of these four
places, or in none of them — never a subset, because there is exactly one
place a "should this be visible" decision is made.

Active-state highlighting is likewise sourced from `resolveActiveDestination`
(§2.1) everywhere, never from a per-surface path comparison — `BottomNav`'s
own comment notes this replaces a `startsWith` chain that would have matched
`/settingsfoo` against Settings, the same bug named in §1.

`BottomNav` also has to reconcile "no active destination" with what MUI's
`BottomNavigation` expects: it passes `false`, not `null`, for "nothing
selected" — MUI's component only recognizes `false` as meaning no tab is
selected; passing `null` leaves the component believing a value was supplied
and simply matching nothing, which renders the same picture by accident
rather than by contract. A destination the current user cannot see (filtered
out of `visibleDestinations`) also resolves to `false` rather than a phantom
highlighted tab for a route that is not even in the visible set.

---

## 4. `railCollapsed` persistence

Stored under `user_settings.navigation`, a namespace declared once alongside
`dataTables` in `apps/api/src/common/schemas/user-settings-namespaces.schema.ts`
(see `docs/specs/datatable.md` §11 for the sibling `dataTables` namespace
declared in the same file):

```ts
export const navigationSchema = z.object({
  railCollapsed: z.boolean().optional(),
}).strict();

export const navigationPatchSchema = z.object({
  railCollapsed: z.boolean().nullable().optional(),
}).strict();
```

No new endpoint and no new request pattern: the rail reads and writes this
namespace through the exact same `GET`/`PATCH /api/user-settings` and the same
`useUserSettings` hook every other setting in the app already uses.

### 4.1 Absent means default, and a default is never written back

`railCollapsed` carries no `.default()`, deliberately — the schema's own
comment states it as directly as the equivalent rule for `dataTables` (see
`docs/specs/datatable.md` §11.4): an absent namespace or an absent field means
"rail expanded," and that is never materialized into the user's stored blob
just because they happened to read it. If a future release changes the
built-in default rail state, every user who never expressed a preference
should feel that change; a client that read `false` and eagerly wrote it back
on load would freeze today's default into their settings forever and silently
exempt them from it. `useNavigationPrefs` enforces the read side of this too:
it checks `settings?.navigation?.railCollapsed === true` rather than a truthy
check, so an absent value and an explicit `false` are indistinguishable — both
correctly mean expanded.

### 4.2 The write is field-wise and optimistic

`UserSettingsService.mergeNavigation` merges this namespace **field-wise**
(distinct from `dataTables`'s per-table entry-replace — see
`docs/specs/datatable.md` §11.6 for why
the two namespaces intentionally use different merge granularities): setting
`railCollapsed` leaves every other field in the namespace — there being only
one today — untouched, and only the changed field goes on the wire from
`useNavigationPrefs`, since `PATCH { navigation: { railCollapsed } }` merges
against whatever else a concurrent request touched rather than replacing the
whole namespace.

The toggle itself is **optimistic**: waiting on a round trip to animate a
164px column change is exactly the kind of lag a user reads as a broken
button. `useNavigationPrefs` applies the new value to an `overlay` state
immediately, then clears the overlay once the write settles — at which point
the underlying `stored` value either already carries the new value (success)
or still carries the old one (failure), so **the revert path and the commit
path are the same code path**, with no separate error branch to keep correct
over time. A monotonic `writeSeq` ref guards against two quick toggles
racing: a late response to the *first* click cannot clear the optimistic state
set by a *second*, more recent click.

`useNavigationPrefs` also passes `syncTheme: false` to `useUserSettings` —
worth calling out because it is easy to get backwards. This hook is mounted
by the always-present rail, so if theme syncing were left on, it would make
the *stored* theme authoritative on every single page load and stamp over the
AppBar's own local light/dark toggle the next time the user navigated. The
opt-out exists on `useUserSettings` specifically for a caller in this
position.

---

## 5. Trade-offs and rejected alternatives

- **Keep the drawer, make it `permanent` above `md`.** Rejected as the
  minimum viable fix: it leaves all four duplicated path sources and all
  three gating idioms from §1 untouched, and Material 3 has deprecated the
  navigation drawer in favor of the rail precisely because a drawer costs a
  tap before navigation can begin at all.
- **Derive the menu from the route tree automatically.** Attractive on the
  surface, but routes and navigation genuinely differ in this app — `/login`,
  `/auth/callback` and `/activate` are real routes that must never appear in
  a menu. The registry keeps the two lists separate and enforces their
  relationship by test (§2.1) instead of by construction.
- **Gate navigation on `isAdmin`, matching the old `Sidebar`.** Rejected: the
  API enforces permissions, not roles, and gating navigation on a role is
  exactly what produced the disagreement between the sidebar and the user
  menu described in §1.
- **Reproduce MemoriaHub's destination model and hub structure literally.**
  Rejected as meaningless here (§6) — this app has no photos, collections, or
  review queues for a "hub" concept to organize.

A rule worth carrying forward, quoted directly from the tracking issue because
it generalizes past this change: **a destination that replaces a piece of
chrome must itself own the equivalent capability before that chrome is gated
away.** Nothing in this port removed a capability outright, but deleting the
AppBar hamburger — with no replacement affordance below `sm` other than the
bottom bar already covering every destination it opened — is exactly that
shape of change, and is why the bottom bar had to ship *before* the hamburger
could be removed, not after.

---

## 6. Explicitly not ported

This repo has four flat destinations with no sub-navigation, no cross-cutting
"mode" concept, and no per-user customization of destination order. Three
things MemoriaHub's navigation carries that this repo's port does not, by
deliberate decision rather than oversight:

- **Console mode.** A secondary navigation mode for a class of destination
  this app does not have.
- **A context pane.** A persistent side panel tied to hub-style destinations
  this app does not have.
- **Destination pinning.** Per-user reordering or pinning of destinations.
  With exactly four destinations and no plan to grow that set arbitrarily,
  there is nothing for pinning to do — it exists upstream to manage a much
  longer list.

None of these appears anywhere in `apps/web/src/components/navigation/` or
`apps/web/src/config/`, and none should be added under this issue's banner if
a future need for one arises — that would be new scope, not a gap in this
port. Persistence in `user_settings.navigation` is `railCollapsed` only, for
the same reason: there is nothing else here yet worth persisting per user.

---

## 7. Accessibility requirements

- **Every navigation control has a real accessible name.** The rail's
  collapsed treatment shows only an abbreviated `compactLabel` visually
  (`aria-hidden`), while the full `label` travels as the control's
  `aria-label` — so the accessible name is never abbreviated even when the
  visible text is.
- **`aria-current="page"` marks the active destination** on the rail, stated
  explicitly rather than relying on MUI's `selected` visual state alone,
  since `selected` carries no semantic meaning to assistive technology on its
  own.
- **A tooltip is never a substitute for an accessible name.** The collapsed
  rail wraps each row in a `Tooltip` showing the full label, but only in
  addition to the `aria-label` already present on the button — a tooltip is a
  pointer affordance that reaches neither a screen reader reliably nor a
  keyboard-only user at all.
- **Keyboard focus is visible on every navigation control**, stated with an
  explicit `&.Mui-focusVisible` outline on both the rail rows and the
  collapse toggle rather than left to the theme's default, so a later theme
  change cannot quietly remove it.
- **The rail's width transition respects `prefers-reduced-motion`.** A 164px
  width animation (56px ↔ 220px) is exactly the kind of motion that can
  trigger vestibular discomfort; the toggle's function is identical with the
  transition removed, so it is removed outright under that media query rather
  than merely shortened.
- **The rail collapse toggle is a real `<button>`** (`IconButton`) with
  `aria-expanded` reflecting the rail's current state, present only in the
  desktop treatment where it has an effect — not an icon-shaped `div`, and
  never rendered (even disabled) at the medium tier where it would do nothing.
- **Navigation links are real links.** `RailRow` renders `ListItemButton` as a
  `RouterLink`, so every destination is focusable, middle-clickable, and
  reachable by a keyboard user tabbing the rail — properties the old drawer's
  bare `onClick` handler did not have, which is also why that handler needed
  its own `setTimeout` to sequence navigation at all.

---

## 8. Testing requirements

- **Route-ownership contract** (`apps/web/src/__tests__/config/destinations.test.ts`):
  for every route declared in `App.tsx`, `resolveActiveDestination` returns
  exactly one destination, or — for the explicitly listed `UNOWNED_ROUTES` —
  none; no route is claimed by two destinations. Paired with boundary cases:
  `/settingsfoo` must not activate Settings, `/admin/users-archive` must not
  activate User Management, `/` activates Home only on an exact match, and a
  child route (`/admin/users/:id`) activates its parent's destination.
  Longest-prefix-wins is asserted directly against the `/admin/users` vs.
  `/admin/settings` sibling case.
- **Unowned routes highlight nothing**, asserted explicitly — not merely left
  unspecified — so a later contributor cannot "fix" what looks like a gap
  into highlighting an arbitrary destination.
- **Reachability regression**: every path the old `Sidebar` menu used to offer
  still resolves to a destination today, so the port did not silently drop a
  page.
- **Gating matches the API**: the admin destinations' `permission` fields are
  asserted against the same strings the controllers enforce, not merely
  against arbitrary internal constants.
- **Coupled-gate coverage**: layout tests exercise widths just below and just
  above 600px and 1200px and assert exactly one of `NavigationRail` /
  `BottomNav` is mounted at every one of them, per §3.1's invariant — never
  both, never neither.
- **`Layout.test.tsx` was rewritten rather than edited**: the prior suite's
  roughly 45 cases were mostly about `sidebarOpen` state that no longer
  exists. `AppBar.test.tsx` gained a negative assertion that no hamburger
  control exists, specifically so the affordance removed in this port cannot
  silently return in a later change.
- **`useNavigationPrefs`** is covered for: absent-means-default (§4.1),
  optimistic toggle plus revert-on-failure (§4.2), and the race guard between
  two rapid toggles.
