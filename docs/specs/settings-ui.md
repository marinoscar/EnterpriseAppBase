# Settings UI Pattern

> Epic #90, issues #91–#96. Implemented in `apps/web/src/config/adminSections.tsx`,
> `apps/web/src/config/userSettingsSections.tsx`,
> `apps/web/src/components/settings/SettingsHub.tsx`,
> `apps/web/src/components/navigation/NavigationRail.tsx`,
> `apps/web/src/components/navigation/AppBar.tsx`, and
> `apps/web/src/hooks/useScrollRestoration.ts`.

Why every settings surface in this app is a registry-driven, searchable hub —
a card grid on tablet and desktop, an iOS-Settings-style drill-down list on
phone — rather than a tab strip, and why the admin console rail and the
compact top bar read that same registry instead of keeping their own idea of
what settings exist.

---

## 1. The problem

Settings surfaces grow monotonically. Every application built on this
baseline adds settings pages over time, and nothing ever removes one. Tabs
are the wrong chrome for that shape of growth: a tab strip is for **parallel**
content — a small, fixed set of equally-important views of the same thing —
and a settings surface is a **hierarchy** that keeps getting deeper. Past
roughly five items a tab strip degrades on both axes at once: enough tabs
force horizontal scrolling, which kills discoverability, and a row of tabs
that shifts as the viewport narrows destroys the spatial memory a returning
user relies on to find the tab they used yesterday (NN/g, ["Tabs, Used
Right"](https://www.nngroup.com/articles/tabs-used-right/)).

Before epic #90, three surfaces had already reached or were heading toward
that limit:

- `/admin/settings` was `SystemSettingsPage`, a single page with **three
  tabs** — UI Settings, Feature Flags, Advanced JSON — that were not parallel
  views of one question. They were three unrelated settings areas wearing a
  tab strip because a tab strip was the pattern on hand.
- `/admin/users` was `UserManagementPage`, a single page with **two tabs** —
  Users, Allowlist.
- `/settings` was `UserSettingsPage`, stacking **three cards** (Theme,
  Profile, Personal Access Tokens) in one scrolling `Container`, with no
  group structure, no search, and no per-section URL — a settings page you
  could not deep-link into or scroll past quickly.

None of the three had a registry. Each was a hand-built page that happened to
answer its route, with no shared idea of "what settings exist" for anything
else — a rail, a search box, a title bar — to read.

---

## 2. The architecture: registry → groups → cards, three consumers

The fix is the same shape epic #51 already applied to top-level navigation
(see [`navigation-ia.md`](navigation-ia.md)): stop letting each surface keep
its own list, and declare the information architecture exactly once.

Two registry files, same shape:

- `apps/web/src/config/adminSections.tsx` — exports `ADMIN_SECTIONS`,
  `ADMIN_HUB_PATH = '/admin/settings'`, `ADMIN_HUB_TITLE = 'Settings'`, and
  the shared types and helpers every settings surface uses:
  `SettingsCardDef`, `SettingsSectionDef`, `visibleSettingsSections()`,
  `settingsPageTitle()`.
- `apps/web/src/config/userSettingsSections.tsx` — exports
  `USER_SETTINGS_SECTIONS`, `USER_HUB_PATH = '/settings'`,
  `USER_HUB_TITLE = 'Settings'`. It imports the types and both helpers from
  `adminSections.tsx` rather than redeclaring them — a second copy of the
  gate is exactly the drift this registry exists to prevent.

### 2.1 `SettingsCardDef`

```ts
export interface SettingsCardDef {
  title: string;
  description: string;
  Icon: SvgIconComponent;
  path?: string;
  disabled?: boolean;
  permission?: string;
  alwaysShow?: boolean;
}
```

- **`Icon`** is a component **type**, never a rendered element — the hub
  draws it at 40px, the rail at ~20px, so the size cannot be baked in at
  declaration time. Storing `<Icon />` would freeze the size and force every
  consumer to clone the element to resize it.
- **`path`** absent means "declared but not yet routed" — a card that exists
  in the IA before the page behind it does.
- **`disabled`** renders the card, but inert, with a "Coming soon" chip. Not
  the same thing as no `path`, but both are treated identically by every
  consumer: neither is a navigable target.
- **`permission`** absent means visible to every authenticated user — the
  normal case for `USER_SETTINGS_SECTIONS`, where no card declares one at
  all.
- **`alwaysShow`** is the escape hatch that shows a card even without its
  `permission` held, reserved for a page that gates its own content
  internally and is still worth reaching.

### 2.2 `visibleSettingsSections` — the one gate every consumer runs

```ts
function visibleSettingsSections(
  sections: SettingsSectionDef[],
  hasPermission: (permission: string) => boolean,
  query = '',
): SettingsSectionDef[]
```

It filters cards by permission (or `alwaysShow`), then by a case-insensitive
substring match against the card's **title only**, then drops any section
left with zero cards — a group header is never rendered above nothing, since
that reads as a loading failure rather than "you may see none of these."

`sections` is a **parameter**, not a closure over `ADMIN_SECTIONS`
specifically. That is what lets the user-settings surface call the exact same
function against `USER_SETTINGS_SECTIONS` instead of forking a second,
near-identical gate that could quietly diverge from the first.

### 2.3 `settingsPageTitle` — one lookup, two different "no match" answers

```ts
function settingsPageTitle(
  sections: SettingsSectionDef[],
  hubPath: string,
  hubTitle: string,
  pathname: string,
): string | null
```

Resolves a pathname to the title of the page it renders, by **longest-prefix-wins**
matching, respecting segment boundaries — `path === pathname` or `pathname`
continuing with a `/` — so `/admin/settings/users` cannot be claimed by a
future `/admin/settings/users-archive` sibling, and a nested route like
`/admin/settings/users/:id` still resolves to "Users & Allowlist" rather than
falling back to the hub title.

It returns two different kinds of "no card matched," and a caller must not
collapse them:

- **`null`** — `pathname` is not under `hubPath` at all. "This is not a
  settings surface; leave the chrome alone."
- **`hubTitle`** — `pathname` is under `hubPath` but matches no card. "This
  *is* a settings surface — specifically, it's the hub itself."

Collapsing the two would put a back arrow and a resolved title on every page
in the app, because every path is trivially "under" an empty match.

### 2.4 The three consumers, one declaration

1. **`apps/web/src/components/settings/SettingsHub.tsx`** — the shared hub
   component (§3). `pages/Admin/SettingsHubPage.tsx` and
   `pages/UserSettingsHubPage.tsx` each bind it to their own registry via
   four props: `sections`, `hubKey`, `title`, `subtitle`. `hubKey` is the
   scroll-restoration namespace (`'admin-settings-hub'` vs.
   `'user-settings-hub'`) — it must differ, or the two hubs, which are
   different documents of different heights, restore onto each other's
   offset.
2. **`apps/web/src/components/navigation/NavigationRail.tsx`** — "Console
   mode." On any `/admin/*` route, when the rail is expanded (`≥ lg` and not
   user-collapsed), the rail swaps its entire contents from the library
   destinations to `ADMIN_SECTIONS` rendered as `ListSubheader`-grouped rows,
   with a permanent "Back to library" row pinned at the top. It reads
   `ADMIN_SECTIONS` through the same `visibleSettingsSections` gate as the
   hub.
3. **`apps/web/src/components/navigation/AppBar.tsx`** — the compact
   drill-down top bar's title resolver, via a small `SETTINGS_SURFACES` table
   (admin-first: `[{ sections: ADMIN_SECTIONS, hubPath: ADMIN_HUB_PATH,
   hubTitle: ADMIN_HUB_TITLE }, { sections: USER_SETTINGS_SECTIONS, hubPath:
   USER_HUB_PATH, hubTitle: USER_HUB_TITLE }]`) and a `resolveDrillDown(pathname)`
   function that calls `settingsPageTitle` per surface and, on a match, also
   computes the back button's `upPath` — the matched surface's hub path, or
   `/` if the pathname already *is* the hub.

Because it is one array read three ways, a card can never appear in the hub
but not the rail, or vice versa. "Console mode invents no admin IA of its
own" (`NavigationRail.tsx`'s own header comment) — it is structurally
incapable of doing so, because it has no IA to invent.

---

## 3. Why `SettingsHub` is one shared component, not two

`apps/web/src/components/settings/SettingsHub.tsx` lives in
`components/settings/`, not in `pages/`, and takes everything
surface-specific as props (`SettingsHubProps`: `sections`, `hubKey`, `title`,
`subtitle`). `pages/Admin/SettingsHubPage.tsx` and
`pages/UserSettingsHubPage.tsx` are deliberately thin — each supplies exactly
those four props and nothing else. Per their own header comments, they "must
never grow admin-specific [or user-specific] rendering."

The component's own header states the reasoning directly: a hub **copied**
from the admin one "would duplicate two responsive treatments and an empty
state: four places to fix every future bug." One implementation cannot drift
from itself; two near-identical ones drift within a release. The shared
component is parameterized from the start rather than extracted after the
fact.

---

## 4. The real IA

Verified against `apps/web/src/config/adminSections.tsx`,
`apps/web/src/config/userSettingsSections.tsx`, and the routes actually
declared in `apps/web/src/App.tsx`.

### 4.1 Admin console — `/admin/settings`

Gated by `RequirePermission permissions={['system_settings:read',
'users:read']}` (any-of). This must stay in sync with the `console`
destination's `anyPermission` in `apps/web/src/config/destinations.ts` — both
answer the same question ("may this user reach the admin surface at all?")
on two different surfaces, and `App.tsx`'s own comment calls out the
consequence of letting them disagree: the Console row would appear in the
rail, bottom bar, user menu, and quick actions for a `users:read`-only user,
whose click then bounces straight back to `/`.

| Group | Card | Route | Permission |
|---|---|---|---|
| General | System | `/admin/settings/general` | `system_settings:read` |
| General | Appearance | `/admin/settings/appearance` | `system_settings:read` |
| General | Feature Flags | `/admin/settings/feature-flags` | `system_settings:read` |
| General | Email | `/admin/settings/email` | `system_settings:read` |
| General | Advanced (JSON) | `/admin/settings/advanced` | `system_settings:write` |
| Access | Users & Allowlist | `/admin/settings/users` | `users:read` |

**Advanced (JSON) gates on write, not read, deliberately.** It is a raw
editor over the whole settings blob, so read-only access has no meaning: a
user who cannot save has nothing to do there that the typed pages do not do
better.

**Email gates on `system_settings:read`, the same as its three siblings above
it, not on write** (issue #124, epic #109). `email-settings.controller.ts`
enforces `system_settings:read` on its `GET` and `system_settings:write` on
save and test-send; the card gate mirrors the `GET`, so a read-only admin can
still open the page to see how mail is configured and diagnose a delivery
problem, while the write actions stay gated inside the page itself. This is
the same reachability-vs-content split Advanced (JSON) and Users & Allowlist
each draw in their own direction.

**Users & Allowlist gates on `users:read` alone**, even though the page also
hosts allowlist data from `allowlist.controller.ts` (permission
`allowlist:read`). The card/route gate is about **reachability** — the page
is worth reaching for its Users half alone — while the page's own internal
Allowlist tab gates its own **content** on `allowlist:read`. This is the same
reachability-vs-content split the tab rule in `CLAUDE.md` draws (§7 below).

**Redirects** — real routes, not catch-all fallout, so `replace` keeps them
out of browser history:

- `/admin` → `/admin/settings`
- `/admin/users` → `/admin/settings/users`

### 4.2 User settings — `/settings`

**No permission gate at the hub or on any card.** Every authenticated user
owns their own settings; no card in `USER_SETTINGS_SECTIONS` declares a
`permission`, and the API grants `user_settings:read` / `user_settings:write`
to all three roles (Admin, Contributor, Viewer). `App.tsx`'s own comment on
this route block is explicit: a gate here would deny a Viewer their own
display name.

| Group | Card | Route |
|---|---|---|
| Account | Profile | `/settings/profile` |
| Account | Appearance | `/settings/appearance` |
| Account | Notifications | `/settings/notifications` |
| Security | Access Tokens | `/settings/tokens` |

**Notifications carries no `permission`, like every card in this registry**
(issue #126, epic #109): the page edits the caller's own preferences through
`PATCH /api/user-settings`, which the API grants to all three roles, and the
event registry it renders (`GET /api/notifications/events`) is `@Auth()` with
no permissions, for the same reason — gating this card would leave a Viewer
unable to say how they are contacted. **It sits under "Account," not
"Security,"** even though one of the events it lists is a security alert: the
card is about how this account is contacted, not about credentials — the
opposite axis from the reason Access Tokens sits under "Security" below.

**Access Tokens sits under its own "Security" group**, not "Account,"
because a personal access token is a long-lived credential. Grouping it with
display name and theme would put "create a bearer token that outlives your
session" one row below "pick a colour scheme."

---

## 5. The breakpoint contract — all five coupled gates

This is the single most important invariant in the pattern. MUI breakpoints
in this codebase are the defaults: `xs 0 / sm 600 / md 900 / lg 1200`. The
boundary that matters everywhere below is **`sm` (600px) — not `md`
(900px)**.

`apps/web/src/components/common/Layout.tsx` states why, and its comment is
the canonical statement of the invariant — `SettingsHub.tsx` and
`AppBar.tsx` each carry a shorter comment pointing back to it:

> 600px, NOT 900px. This is Material 3's compact/medium window-class
> boundary — compact < 600dp, medium 600–840dp — and M3 is explicit that a
> rail is the correct chrome from medium upward. Gating at MUI's `md` (900px)
> would hand the PHONE treatment to every 600–899px device: tablets in
> portrait (iPad 768px, iPad Pro 11" 834px), foldables unfolded, and phones
> in landscape.

**Five gates, all `theme.breakpoints.up('sm')` or `down('sm')`, that must
move together:**

1. `Layout.tsx`'s `showRail = useMediaQuery(theme.breakpoints.up('sm'))` —
   mounts/unmounts `NavigationRail`.
2. `BottomNav`'s own `down('sm')` self-gate — belt-and-braces, the exact
   complement of (1).
3. `<main>`'s `pb: { xs: 10, sm: 3 }` in `Layout.tsx` — clears the fixed
   bottom bar; only needed where the bar exists.
4. `SettingsHub.tsx`'s `isCompactWindow = useMediaQuery(theme.breakpoints.down('sm'))`
   — drill-down list vs. card grid.
5. `AppBar.tsx`'s `isCompactWindow = useMediaQuery(theme.breakpoints.down('sm'))`
   — back-arrow-plus-title vs. wordmark-plus-toggle.

Gates (1)–(3) predate this epic, from epic #51. Epic #90 adds (4) and (5),
and they are coupled to each other **as tightly as (1)–(3) are**: the hub is
the page body, and the AppBar is the header directly above it. They are also
coupled to (1)–(3) — "there is no rail here" is exactly what makes the hub
itself the navigation below `sm`.

**The failure mode if (4) and (5) disagree**: a back-arrow drill-down header
sitting above a card grid, or a full wordmark toolbar sitting above a
drill-down list with no way back up.

### 5.1 Why deliberately no shared constant

`Layout.tsx`, verbatim:

> This comment is the invariant's only enforcement; there is deliberately no
> shared constant, because a constant would let \[any member] drift while
> still compiling. If you change one number here, change all five.

A `useMediaQuery(theme.breakpoints.down('sm'))` call site in five different
files, each carrying the full cross-reference comment, is the enforcement
mechanism. A shared `IS_COMPACT_BREAKPOINT` export would let one caller
import a stale value, or a subtly different query object, and TypeScript
would never catch it — the type of a `useMediaQuery` boolean gives no signal
about which breakpoint produced it. Five identical literal call sites make a
drift a `grep`-able, review-visible change instead of a silent one.

---

## 6. Design decisions and what breaks otherwise

**Phone treatment drops descriptions.** From `SettingsHub.tsx`: descriptions
"roughly triple the list's height and destroy the scannability the
drill-down exists to provide." They stay on the card grid, where there is
horizontal room to pay for them.

**Search matches title only, no debounce.** From `adminSections.tsx`'s
`visibleSettingsSections` comment: matching descriptions too "would mean a
two-letter query surfacing eight cards because their prose happens to share
a word — a worse result set than a strict title match, and one the user
cannot predict." And from `SettingsHub.tsx`: no debounce, deliberately — it
filters an in-memory array of a few dozen items, so a timer buys nothing and
costs visible input lag, which is "the single most common way a
'responsive' search feels broken."

**Scroll restoration is the make-or-break detail of a drill-down.** From
`apps/web/src/hooks/useScrollRestoration.ts`, three facts drive the
implementation:

1. **The document is the scroller**, not an element. `window.scrollY`, not
   some `scrollTop` — `Layout`'s shell does not make `<main>` an overflow
   container.
2. **The page fully unmounts** on drill-down, so the offset cannot live in
   component state, a ref, or context — all three die with the tree. It
   lives in `sessionStorage`, scoped to the tab, not `localStorage`, which
   "would restore a position from a session last week."
3. **Content renders asynchronously.** A single `scrollTo` at mount would
   silently clamp to the current (too-short) bottom. The fix retries via
   `requestAnimationFrame` until `document.documentElement.scrollHeight -
   window.innerHeight >= target`, up to a 1000ms deadline
   (`RESTORE_DEADLINE_MS`). Explicitly, `history.scrollRestoration` cannot
   help here: "the browser cannot know the eventual height of content that
   has not been fetched yet."

A genuine user scroll gesture aborts any in-flight restore outright —
restoration must never fight the user for the viewport. The restore is
always `behavior: 'auto'` (instant), never `'smooth'`: smooth would visibly
slide content out from under a user who was already there, and it would
collide with the gesture-abort guard for its whole duration. Every
`sessionStorage` touch — reads included — is wrapped in try/catch, because
Safari private mode throws on access, not just on writes.

**Console mode is expanded-only.** From `NavigationRail.tsx`: "A 56px column
cannot host labelled group headers, and a stack of near-identical unlabelled
admin icons is worse than no swap at all." At the medium tier (`sm`–`lg`) and
whenever a desktop user has manually collapsed the rail, the rail keeps
LIBRARY navigation with "Console" marked active, and `SettingsHubPage` itself
IS the admin navigation — "exactly the reasoning epic #90 applies to the
phone... applied to the other size class that has no room for group headers
either."

**Back navigates up, never `navigate(-1)`.** From `AppBar.tsx`'s
`resolveDrillDown` comment: history-relative back is correct only when the
user actually walked down the hierarchy in this tab. It diverges the moment
they arrived any other way — a deep link, the `/admin/users` redirect, an
OAuth callback landing them here — because then the history entry before this
page is another site entirely, so "back" would silently mean "leave the
app." Structural up — to the surface's hub, or `/` if already at the hub —
is the same arrow every time.

**`null` vs. `hubTitle` are different answers** (§2.3). The consequence for
the AppBar: `null` keeps the normal wordmark toolbar; `hubTitle` triggers the
drill-down treatment on the hub page itself.

---

## 7. Rejected alternatives

From epic #90's own body:

- **Scrollable tab strip.** Many tabs force horizontal scrolling, which
  reduces discoverability, and shifting tab rows destroy the spatial memory
  users rely on — see NN/g, ["Tabs, Used
  Right"](https://www.nngroup.com/articles/tabs-used-right/).
- **iOS Settings as the drill-down precedent.** It is the reference mobile
  settings experience, so every phone user already holds the mental model —
  adopting the same drill-down shape costs nothing to learn.
- **Search as the only scaling mechanism.** At 40 settings pages a rail or
  tab strip degrades; search stays constant-effort regardless of how large
  the registry grows.

From issue #97's own "Alternatives Considered," about the documentation
choice itself — worth noting here because it explains why this file exists
at all:

- **Code comments only.** Tried, and not enough: "a contributor reads the
  file they are editing, not the one they should have copied."
- **An ESLint rule enforcing registry membership.** Rejected for now — it
  can't see intent (a legitimate non-settings route under `/admin` would
  trip it). Worth revisiting once the pattern has settled; the written
  mandate comes first.

---

## 8. Accessibility requirements

Verified against `NavigationRail.tsx`, `AppBar.tsx`, and `SettingsHub.tsx`.

- **Named nav landmark per mode.** `NavigationRail`'s `aria-label` is
  `'Console navigation'` in Console mode, `'Main navigation'` otherwise —
  explicit, because a screen-reader user landing on a completely different
  set of contents needs to know which mode they're in.
- **Exactly one `aria-current="page"` at any path**, including nested admin
  paths — enforced by longest-prefix-wins active-row computation
  (`consoleActivePath` in `NavigationRail.tsx`), not a plain prefix test per
  row, which would light up two rows on a nested path.
- **Search field**: explicit `aria-label="Search settings"` on the input,
  because the placeholder disappears the moment the user types and cannot be
  the accessible name; its clear button carries its own
  `aria-label="Clear settings search"`, rendered only when there is
  something to clear.
- **Visible focus**: `&.Mui-focusVisible` outline stated explicitly on rail
  rows and the collapse toggle, not left to theme defaults.
- **`prefers-reduced-motion`**: the rail's width transition (56px↔220px) is
  removed outright under `prefers-reduced-motion: reduce`, not merely
  shortened.
- **Scroll restore is always instant** (`behavior: 'auto'`) — never smooth,
  at any reduced-motion setting; see §6.

---

## 9. Worked example: adding a settings page

> **This example is illustrative only.** The "Storage" admin browser used
> below does **not exist** in this codebase today. Epic #90's own scope notes
> name it as the kind of future admin capability the registry is meant to
> make cheap: "New admin capabilities that do not exist today (a Storage
> Objects browser, Device Sessions management, PAT administration)... The
> registry must make them cheap to add later; this epic adds none of them."

Adding a new admin settings page is three steps, and none of them is "write
a new component."

**1. Add the card to the registry**, inside `ADMIN_SECTIONS` in
`apps/web/src/config/adminSections.tsx`, matching the real `SettingsCardDef`
shape:

```tsx
{
  title: 'Storage',
  description: 'Browse and manage uploaded files across all users.',
  Icon: StorageIcon,
  path: '/admin/settings/storage',
  permission: 'storage:read_any',
}
```

`storage:read_any` is a real permission in this codebase's RBAC model (see
`CLAUDE.md`'s Key Permissions list: "Storage object access (all objects,
Admin only)") — the right choice for an admin-wide browser, as opposed to the
per-user `storage:read`.

**2. Add the route** in `apps/web/src/App.tsx`, inside the
`/admin/settings/*` block, wrapped in `RequirePermission` with the **same**
permission string:

```tsx
<Route
  path="/admin/settings/storage"
  element={
    <RequirePermission permission="storage:read_any" fallback={<Navigate to="/" replace />}>
      <StorageBrowserPage />
    </RequirePermission>
  }
/>
```

No new registry, and no new consumer wiring. The hub, the Console rail, and
the AppBar title resolver all pick this up automatically, because all three
read `ADMIN_SECTIONS`.

**3. Write tests**, pointing at the real, existing conventions in this repo:

- `apps/web/src/__tests__/config/settingsRegistry.test.ts` — extend or
  mirror its permission-gating and search coverage for the new card. It
  already exercises `visibleSettingsSections` / `settingsPageTitle` against
  both a local fixture and the real `ADMIN_SECTIONS`.
- A page-level test alongside
  `apps/web/src/__tests__/pages/Admin/SystemSettingsPages.test.tsx`'s
  pattern: the route mounts the right component, the permission gate
  redirects correctly, and `disabled` prop wiring is covered if applicable.
