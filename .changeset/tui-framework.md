---
'@marinoscar/platform-cli': minor
---

TUI testing kit and the `tui` conformance suite (RETRO-G1.5, closes epic #1064).

Additive; nothing changes at runtime. kvox and EvoPath need no change.

- New subpath `@marinoscar/platform-cli/tui/testing`, for tests only, on `ink-testing-library` (`^4.0.0`, a new OPTIONAL peer: add it as a dev dependency of the app that tests screens). `renderTuiScreen(Screen, { session?, selection?, appState?, theme?, columns?, params? })` mounts a screen in a `TuiAppProvider` in test mode (an in-memory session; it never reads a real CLI config or token) and returns `{ lastFrame, frames, stdin, press, type, waitForFrame, nav: { stack }, unmount }`; `renderTuiRoute(route)` mounts the real router (lazy `load`, login gate); `renderTuiMenu({ nodes, screens, loggedIn })` asserts visible labels and breadcrumbs; `fakeDaemonFeed<E>()` and `fakeEmitterFeed<E>()` drive a `DashboardSource` frame by frame; `stripAnsi`, `hasAnsi`, `frameLines`, `renderAt`.
- New `tui` suite for `runPlatformConformance` (`@marinoscar/platform-cli/testing`): every menu entry opens a registered screen, every section is reachable, no cycles, depth at most 4; app screens and sections use `load` (opt out per route with `allowEager`); importing `@marinoscar/platform-cli/tui` and the app's registration modules loads no `ink` (checked in a fresh Node process); labels are non-empty logged in and logged out; each dashboard reducer leaves a frozen input untouched; each app screen renders at narrow widths and without colour; every login-gated entry shows the "not logged in" notice. Each check is skippable with a written reason. The pure checks (`checkTuiMenu`, `checkTuiLazy`, `checkTuiLabels`, `checkTuiNoInkImport`, `checkDashboardReducer`) are exported. An app opts in with `tui: {}`; a suite left out does not run.
- Migration for an app with a forked TUI: its menu tree maps to `registerTuiMenuNode`, its app state to `registerTuiStateLoader`, its active selection to `registerTuiSelection`, its dashboards to a `DashboardReducer` over a `DashboardSource` (`daemonAttachFeed`, `inProcessFeed`, `pollFeed`), its widgets to `@marinoscar/platform-cli/tui/ui`, and its Ink test helpers to `renderTuiScreen`.
- This release carries the whole RETRO-G1 framework: the menu tree (G1.1), the app context (G1.2), the dashboard source (G1.3), the component kit (G1.4) and this kit (G1.5).
