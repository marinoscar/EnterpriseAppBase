---
"@marinoscar/platform-web": minor
---

Add the shell slice: `@marinoscar/platform-web/shell/headless` (the `ShellNavigation` model with `owns`, `isDestinationVisible` and `resolveActiveDestination`, the rail's collapse preference `useShellRailPreference`, `createShellTheme` with its palette and component overrides and the theme context, and the providers composition `ShellProviders`) and `@marinoscar/platform-web/shell/ui` (`ShellLayout`, `ShellAppBar`, `ShellNavigationRail` with Console mode, `ShellBottomNav`, `ShellUserMenu`, `ShellThemeProvider` and `ShellRoot`), with slots for branding and navigation. The five coupled breakpoint gates stay together at `sm`. `@marinoscar/platform-web/settings`' sibling entry now also exposes the registry helpers and the feature map to the shell.
