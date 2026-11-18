---
"@marinoscar/platform-cli": minor
---

TUI menu tree: `registerTuiMenuNode` (and `createCli({ tuiMenu })`) place screens in nested sections with breadcrumbs, a `loggedOut` cascade, `hideWhenLoggedIn`, colours, `…` for entries that ask for more input and `1`-`9` accelerators, replacing the flat menu. A screen no entry opens stays at the root with its own label and order, so an app that registers no node sees the menu it had. `requiresLogin` entries open a shared "not logged in" notice in the router. Pure helpers `buildTuiMenuTree`, `visibleTuiMenuChildren`, `tuiMenuItemLabel`, `tuiBreadcrumb`, `tuiParentSectionId`, `tuiRouteRequiresLogin` and `tuiMenuColor` are exported from `@marinoscar/platform-cli/tui`. Unknown parents or routes, duplicate ids, cycles and nesting past 4 sections throw at `createCli`. Esc on the root menu no longer quits (`q` and the Quit line still do).
