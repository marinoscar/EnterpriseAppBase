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
| `destinations` | `readonly ShellDestination[]` | required | `{ key, label, compactLabel, Icon, path, permission?, anyPermission?, pinned?, feature? }`, in navigation order. `permission` is the exact string the API enforces; `pinned` puts it at the rail's foot. Four at most for the bottom bar's labels. |
| `destinationRoutes` | `Record<key, readonly string[]>` | each `path` | The prefixes each destination owns (lights up on). |
| `settingsSurfaces` | `readonly ShellSettingsSurface[]` | none | `{ sections, hubPath, hubTitle }` the compact AppBar drills into, in resolution order. |
| `console` | `ShellConsole` | none | `{ prefix, sections, back? }`: the rail's Console mode. `back` defaults to `{ label: 'Back to library', path: '/' }`. |
| `homePath` | `string` | `'/'` | Where the brand goes; the destination at it is left out of the user menu. |
| `useRailPreference` | `() => ShellRailPreference` | `useShellRailPreference` | The desktop rail's collapse preference, as a stable hook reference. |

`ShellLayout` props: `navigation`, `brand`, and the slots `appBar`, `rail`, `bottomNav` (default: the packaged surface for `navigation`), `banners` (inside `<main>`, above the page), `overlays` (after the bottom bar), `children` (default `<Outlet />`). `ShellAppBar` props: `navigation`, `brand`, `actions` (both treatments), `wideActions` (outside the drill-down), `userMenu` (default `ShellUserMenu`). `ShellUserMenu` props: `navigation`, `items(close)`, `footer`, `logoutLabel` (default `'Logout'`). `ShellThemeProvider` and `ShellRoot` props: `themes: { light, dark }`, `storageKey` (default `'theme_mode'`). `createShellTheme(mode, { palette?, extend? })`. No environment variable.

## Extension-point catalog

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
| `ShellBottomNav` | component | `ShellBottomNav(props: { navigation }): ReactElement \| null` | The bottom bar, for an app that binds its own `bottomNav` slot | experimental | [example](../../../../apps/web/src/components/navigation/BottomNav.tsx) |
| `ShellThemeProvider` | component | `ShellThemeProvider(props: { themes; storageKey?; children }): ReactElement` | Hold the viewer's light / dark / system choice for the AppBar toggle and an Appearance page | experimental | [example](../../../../apps/web/src/contexts/ThemeContext.tsx) |

Supporting exports (experimental): `ShellRoot` (`ShellThemeProvider` plus MUI's `ThemeProvider` and `CssBaseline`), `useShellTheme` (throws outside the provider), `useOptionalShellTheme`, `shellPalette`, `shellComponentOverrides`, `owns`, `isDestinationVisible`, `resolveActiveDestination`, `shellDestinationRoutes`, `RAIL_WIDTH_COLLAPSED` (56), `RAIL_WIDTH_EXPANDED` (220), and the types `ShellDestination`, `ShellIcon`, `ShellIconProps`, `ShellSettingsSurface`, `ShellConsole`, `ShellConsoleBack`, `ShellRailPreference`, `ShellProvider`, `ShellProviderProps`, `ShellThemes`, `ShellThemeMode`, `ShellThemeContextValue`, `ShellThemeOptions` and every props type.

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
