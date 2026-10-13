# @marinoscar/platform-web/shell

The app shell of the web package (issue #868), in two entries: `/shell/headless` (the navigation model `ShellNavigation` and its helpers, the rail's collapse preference `useShellRailPreference`, the shell theme `createShellTheme` with its context, and the providers composition `ShellProviders`) and `/shell/ui` (`ShellLayout`, `ShellAppBar`, `ShellNavigationRail`, `ShellBottomNav`, `ShellUserMenu`, `ShellThemeProvider` and `ShellRoot`). It depends on `core`, `settings` (the registry helpers, the feature map, `useUserSettings`) and `identity` (`useAuth`, `usePermissions`) (`packages/platform-slices.json`).

## Purpose and scope

The chrome every app around the platform needs and used to copy (about 30 files): the top bar, the rail at tablet and desktop widths, the bottom bar on a phone, the user menu, the theme and its light / dark toggle, and the stack of providers around the signed-in shell. The app declares its destinations and settings surfaces once (`ShellNavigation`) and fills slots for its brand and its own controls.

- **One navigation surface at every width.** The rail mounts at `sm` (600px) and up, the bottom bar below it; the chrome is chosen by mounting, never by CSS hiding.
- **The five coupled breakpoint gates stay together, all at `sm`, with no shared constant** (CLAUDE.md, Settings UI Pattern rule 5; [settings-ui.md, Breakpoint gates](../../../../docs/specs/settings-ui.md#breakpoint-gates)): `ShellLayout`'s `showRail` (`up('sm')`) and `<main>`'s `pb: { xs: 10, sm: 3 }`, `ShellBottomNav`'s own `down('sm')`, `ShellAppBar`'s `isCompactWindow` (`down('sm')`) here, and `SettingsHub`'s `isCompactWindow` in the settings slice. `ShellLayout.tsx` carries the canonical list.
- **One destination table.** The rail, the bottom bar and the user menu draw `navigation.destinations` with one visibility rule (`isDestinationVisible`: feature, then `permission`, then `anyPermission`) and one active-state rule (`resolveActiveDestination`, segment-boundary prefixes, longest wins).
- **Console mode.** On a route under `navigation.console.prefix` the expanded rail lists the console's registry with the hub's own filter (`visibleSettingsSections`), and a permanent way back.
- **The drill-down.** Below `sm` on a settings route the AppBar shows a back arrow (structural up, never history) and the page's title (`settingsPageTitle`).

Not here: the app's routes and route guards, its registries (`ADMIN_SECTIONS`, `USER_SETTINGS_SECTIONS`), its banners and dialogs (they go in slots), and the providers of other slices (the app lists them for `ShellProviders`).

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { createShellTheme, ShellProviders, type ShellNavigation } from '@marinoscar/platform-web/shell/headless';
import { ShellLayout, ShellRoot } from '@marinoscar/platform-web/shell/ui';
```

Peers: `react`, `react-dom`, `react-router-dom` (the layout is a route element and its surfaces link and navigate), `@mui/material`, `@mui/icons-material`, `@emotion/react`, `@emotion/styled`.

## Quick start

The reference app declares its navigation once ([`config/shell.ts`](../../../../apps/web/src/config/shell.ts)), binds each surface with its slots ([`Layout.tsx`](../../../../apps/web/src/components/common/Layout.tsx), [`AppBar.tsx`](../../../../apps/web/src/components/navigation/AppBar.tsx), [`UserMenu.tsx`](../../../../apps/web/src/components/navigation/UserMenu.tsx)) and mounts its providers as one list ([`platform/shellProviders.tsx`](../../../../apps/web/src/platform/shellProviders.tsx), [`App.tsx`](../../../../apps/web/src/App.tsx)):

```tsx
export const APP_NAVIGATION: ShellNavigation<DestinationKey> = {
  destinations: DESTINATIONS,
  destinationRoutes: DESTINATION_ROUTES,
  settingsSurfaces: [{ sections: ADMIN_SECTIONS, hubPath: '/admin/settings', hubTitle: 'Administration' }],
  console: { prefix: '/admin', sections: ADMIN_SECTIONS },
};

<Route element={<ShellProviders providers={APP_SHELL_PROVIDERS}><Layout /></ShellProviders>}>
```

The smallest app needs no binding file at all (the starter's `App.tsx`):

```tsx
<ShellRoot themes={{ light: createShellTheme('light'), dark: createShellTheme('dark') }}>
  <BrowserRouter>
    <Routes>
      <Route element={<ShellLayout navigation={NAVIGATION} brand={APP_NAME} />}>…</Route>
    </Routes>
  </BrowserRouter>
</ShellRoot>
```

## Configuration

`ShellNavigation` (declare it once, at module scope):

| Option | Type | Default | Meaning |
|---|---|---|---|
| `destinations` | `readonly ShellDestination[]` | required | `{ key, label, compactLabel, Icon, path, permission?, anyPermission?, pinned?, feature?, badge?, group?, external?, onClick? }`, in navigation order. `permission` is the exact string the API enforces; `pinned` puts it at the rail's foot. The bottom bar draws four tabs; with more destinations visible it draws three and a More sheet (`maxItems`). See [Destination fields](#destination-fields). |
| `destinationRoutes` | `Record<key, readonly string[]>` | each `path` | The prefixes each destination owns (lights up on). |
| `settingsSurfaces` | `readonly ShellSettingsSurface[]` | none | `{ sections, hubPath, hubTitle }` the compact AppBar drills into, in resolution order. |
| `console` | `ShellConsole` | none | `{ prefix, sections, back? }`: the rail's Console mode. `back` defaults to `{ label: 'Back to library', path: '/' }`. |
| `homePath` | `string` | `'/'` | Where the brand goes; the destination at it is left out of the user menu. |
| `useRailPreference` | `() => ShellRailPreference` | `useShellRailPreference` | The desktop rail's collapse preference, as a stable hook reference. |

`ShellLayout` props: `navigation`, `brand`, and the slots `appBar`, `rail`, `bottomNav` (default: the packaged surface for `navigation`), `banners` (inside `<main>`, above the page), `overlays` (after the bottom bar), `children` (default `<Outlet />`). `ShellAppBar` props: `navigation`, `brand`, `actions` (both treatments), `wideActions` (outside the drill-down), `userMenu` (default `ShellUserMenu`). `ShellUserMenu` props: `navigation`, `items(close)`, `footer`, `logoutLabel` (default `'Logout'`). `ShellBottomNav` props: `navigation`, `maxItems` (default 4, at least 2). `ShellThemeProvider` and `ShellRoot` props: `themes: { light, dark, ...modes }` (extra keys are theme modes by id, see [Theme modes](#theme-modes)), `storageKey` (default `'theme_mode'`). `createShellTheme(mode, { palette?, extend? })`. No environment variable.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `ShellNavigation` | slot | `{ destinations; destinationRoutes?; settingsSurfaces?; console?; homePath?; useRailPreference? }` | Declare the app's destinations, settings surfaces and Console once | experimental | [example](../../../../apps/web/src/config/shell.ts) |
| `useShellRailPreference` | hook | `useShellRailPreference(options?: { api? }): UseShellRailPreferenceResult` | Store the rail's collapse preference in the `navigation` user-settings namespace through a chosen transport | experimental | [example](../../../../apps/web/src/hooks/useNavigationPrefs.ts) |
| `createShellTheme` | theme-token | `createShellTheme(mode: 'light' \| 'dark', options?: { palette?; extend? }): Theme` | Build the shell's light and dark themes with the app's brand colour and token contracts | experimental | [example](../../../../apps/web/src/theme/index.ts) |
| `ShellProviders` | slot | `ShellProviders(props: { providers: readonly ShellProvider[]; children }): ReactElement` | Mount the providers around the signed-in shell as one ordered list | experimental | [example](../../../../apps/web/src/platform/shellProviders.tsx) |
| `ShellLayout` | slot | `ShellLayout(props: ShellLayoutProps): ReactElement` | The shell route element; replace a surface, add banners or a once-per-shell dialog | experimental | [example](../../../../apps/web/src/components/common/Layout.tsx) |
| `ShellAppBar` | slot | `ShellAppBar(props: { navigation; brand; actions?; wideActions?; userMenu? }): ReactElement` | Put the app's brand and controls (a bell, an organization switcher) in the top bar | experimental | [example](../../../../apps/web/src/components/navigation/AppBar.tsx) |
| `ShellUserMenu` | slot | `ShellUserMenu(props: { navigation; items?(close); footer?; logoutLabel? }): ReactElement \| null` | Add rows (Getting started) and a footer (the version line) to the user menu | experimental | [example](../../../../apps/web/src/components/navigation/UserMenu.tsx) |
| `ShellNavigationRail` | component | `ShellNavigationRail(props: { navigation }): ReactElement` | The rail, for an app that binds its own `rail` slot | experimental | [example](../../../../apps/web/src/components/navigation/NavigationRail.tsx) |
| `ShellBottomNav` | component | `ShellBottomNav(props: { navigation; maxItems? }): ReactElement \| null` | The bottom bar, for an app that binds its own `bottomNav` slot; set `maxItems` to change how many tabs fit before the More sheet | experimental | [example](../../../../apps/web/src/components/navigation/BottomNav.tsx) |
| `ShellThemeProvider` | component | `ShellThemeProvider(props: { themes; storageKey?; children }): ReactElement` | Hold the viewer's light / dark / system choice, or one of the app's own theme modes, for the AppBar toggle and an Appearance page | experimental | [example](../../../../apps/web/src/contexts/ThemeContext.tsx) |
| `registerThemeMode` | registry | `registerThemeMode(definition: { id; label; theme }): void` | Add a theme mode (a high-contrast theme, a brand skin) the shell can resolve and restore; pair it with `registerThemePreference` on the API so the Appearance page offers it | experimental | [example](../../../../apps/web/src/platform-extensions/shell/high-contrast.theme.ts) |

Supporting exports (experimental): `ShellRoot` (`ShellThemeProvider` plus MUI's `ThemeProvider` and `CssBaseline`), `useShellTheme` (throws outside the provider), `useOptionalShellTheme`, `shellPalette`, `shellComponentOverrides`, `owns`, `isDestinationVisible`, `isExternalUrl`, `groupDestinationRuns`, `listThemeModes`, `isBuiltinThemeMode`, `BUILTIN_SHELL_THEME_MODES`, `resolveActiveDestination`, `shellDestinationRoutes`, `RAIL_WIDTH_COLLAPSED` (56), `RAIL_WIDTH_EXPANDED` (220), and the types `ShellDestination`, `ShellIcon`, `ShellIconProps`, `ShellSettingsSurface`, `ShellConsole`, `ShellConsoleBack`, `ShellRailPreference`, `ShellProvider`, `ShellProviderProps`, `ShellThemes`, `ShellThemeMode` (open: `'light' | 'dark' | 'system' | (string & {})`), `ShellThemeModeDefinition`, `ShellDestinationRun`, `ShellBottomNavProps`, `ShellThemeContextValue`, `ShellThemeOptions` and every props type.

### Destination fields

Four optional fields on `ShellDestination` (PP-14.25). All are drawn from the one table, so the rail, the bottom bar, its More sheet and the user menu agree:

| Field | Effect |
|---|---|
| `badge?: () => ReactNode` | A badge on the icon. Called while the destination renders, once per surface, from a component that exists once per destination, so it may be a hook (`useUnreadCount`). A number or string is a count and becomes part of the accessible name (`Inbox (3)`); an element is a custom mark; `null`, `undefined`, `false`, `0` and `''` draw none. Keep it a module-level function. |
| `group?: string` | Destinations declared next to each other with the same `group` form a run. The expanded rail prints the group name above the run (a labelled `<ul>`), the collapsed rail separates runs with a divider, the More sheet prints the heading. The bottom bar's own tabs and the user menu ignore it. Declaration order is still the order everywhere. |
| `external?: boolean` | `path` is an `http(s)` URL on another site: drawn as an anchor with `target="_blank"` and `rel="noopener noreferrer"`, never the active destination, and its accessible name ends "(opens in a new tab)". A destination marked external whose `path` is not an http(s) URL (a `javascript:` or `data:` target) is not drawn at all (`isDestinationVisible` fails closed). It owns no route: pass `external: true` in the destination view of `runPlatformWebConformance` and the `settings-route-ownership` suite does not expect one. |
| `onClick?` | Called with the click before the shell navigates; `event.preventDefault()` cancels the navigation (a destination that opens a dialog or a command palette). |

### The bottom bar's overflow

`ShellBottomNav` draws at most `maxItems` actions (default 4, the ceiling the five-tab labels allow at 360px). With `maxItems` or fewer visible destinations it is exactly the bar it always was. With more, it draws the first `maxItems - 1` destinations and a "More" action that opens a bottom sheet (a modal `Drawer`, focus-trapped, `Escape` and the backdrop close it, labelled "More destinations") listing the rest; choosing one navigates and closes the sheet. "More" is the selected tab when the active destination is in the sheet, and shows a dot when a destination in the sheet has a badge. The sheet lives inside the bar, which renders only below `sm`, so it adds no breakpoint gate; the five coupled gates did not move. The reference app declares four destinations in all, so its phone bar never overflows.

### Theme modes

`ShellThemeMode` is an open id: `light`, `dark`, `system`, or the id of a theme the app added. Two ways to add one, both resolved by `ShellThemeProvider`: `registerThemeMode({ id, label, theme })` at module scope (before the first render), or extra keys in the provider's `themes` (a key wins over a registered mode of the same id). The id follows the API's theme id pattern (lower-case, starts with a letter, 2 to 48 characters). `setMode(id)` chooses a known mode and ignores an unknown one; the choice is persisted and restored on the next visit, and a stored id nobody registers any more falls back to `system`. A custom mode counts as dark by its theme's `palette.mode` (the AppBar toggle's icon), and `toggleMode` flips from what is showing to `light` or `dark`. `useShellTheme().modes` lists the extra modes for a picker.

The stored `theme` user setting reaches a custom mode when the API registered the same id with `registerThemePreference` (`@marinoscar/platform-api/settings`): the settings document lists it in `themeOptions`, the Appearance page offers it, and `useUserSettings` hands a stored or saved id to the host's `applyTheme` (the app's `setMode`) when it is built in or listed in `themeOptions`, never an id the document does not list.

## Data

None. The rail's preference is the `navigation` namespace of the user settings (`railCollapsed`), owned by the settings slice; the theme choice is kept in this browser's `localStorage`.

## Permissions and settings

Declares none. The surfaces show a destination only when the viewer holds its `permission` (and one of its `anyPermission`), and only when its `feature` is on in the settings slice's feature map (`useSettingsFeatures`, fail closed). Reads and writes `navigation.railCollapsed` through `GET`/`PATCH /api/user-settings` (`user_settings:read`/`write`); a default is never written back.

## UI

- **Components:** `ShellLayout` (the route element), `ShellAppBar`, `ShellNavigationRail` (collapsed 56px at `sm`–`lg`, expanded 220px at `lg` and up, Console mode, a desktop-only collapse toggle with `aria-expanded`), `ShellBottomNav` (compact labels, full accessible names), `ShellUserMenu`, `ShellThemeProvider`, `ShellRoot`.
- **Slots:** the AppBar's `brand`, `actions`, `wideActions` and `userMenu`; the user menu's `items` and `footer`; the layout's `appBar`, `rail`, `bottomNav`, `banners` and `overlays`; `ShellProviders`' list.
- **Theme:** `createShellTheme` (Inter, 600-weight headings, 8px radius, no-uppercase buttons, a flat AppBar with a hairline border); the app's `palette` changes merge into it and `extend` adds token contracts (the telemetry slice's `withTelemetryTokens`).
- **Accessibility:** `<nav>` landmarks named "Main navigation" / "Console navigation", `aria-current="page"` on the active row, a visible focus outline on every rail control, tooltips only where the label is abbreviated, `prefers-reduced-motion` honoured by the rail's width transition.

## Infra

None.

## Observability

None of its own: the rail preference's requests are the app transport's.

## Security notes

Every permission check here only chooses what to draw; the route guards and the API decide what a viewer may reach. The destination `permission` must be the exact string the controller enforces, and a settings card's the same (the settings slice's conformance suites check the registries). The drill-down titles a page without a permission check on purpose: by then the route guard has had its say, and naming the page the viewer is looking at leaks nothing.

## Conformance suite

None in this slice. The reference app's `Layout`, `AppBar`, `NavigationRail`, `BottomNav`, `UserMenu` and `destinations` tests run every surface through its bindings (exactly one navigation surface at every width, the gate-3 padding, route ownership against `App.tsx`), and `tests/visual` pins the pixels; the settings slice's suites cover the registries the shell reads.

## Upgrade notes

PP-14.25 (additive): `ShellDestination` gains `badge`, `group`, `external` and `onClick`; `ShellBottomNav` gains `maxItems` (default 4) and the More sheet, so a navigation with more than four visible destinations now overflows into it where it used to squeeze five or more tabs into the bar (an app that wants every tab sets `maxItems`); `ShellThemeMode` and `ShellThemes` are open; `applyTheme` of the platform host accepts any theme id the document lists. A navigation with four or fewer destinations and none of the new fields renders the markup it did (`test/shell/ShellNavigation.builtin-dom.test.tsx`).

New in #868. From the reference app or a fork of it: `components/common/Layout.tsx`, `components/navigation/{AppBar,NavigationRail,BottomNav,UserMenu}.tsx`, `contexts/ThemeContext.tsx`, `theme/` and `hooks/useNavigationPrefs.ts` become bindings of this slice (the same DOM and `sx`); `config/destinations.ts` keeps its table and re-exports `owns` and `isDestinationVisible`; the provider staircase around `Layout` becomes `ShellProviders`.

## Troubleshooting

- **`ShellLayout: pass navigation, or the appBar slot`.** A default surface needs the navigation; pass it, or pass every surface as a slot.
- **No theme toggle in the AppBar.** No `ShellThemeProvider` (or `ShellRoot`) above it.
- **A destination never shows.** Its `feature` is not registered or answers off (`registerSettingsFeature`), or the viewer lacks its `permission` / every `anyPermission`.
- **Two navigation surfaces, or none, between 600px and 900px.** A gate moved alone; all five are `sm`.

## Links

- [Package README](../../README.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md)
- [Settings UI spec](../../../../docs/specs/settings-ui.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
