---
'@marinoscar/platform-cli': minor
---

TUI seam #1115: hide or replace a built-in screen (`hideTuiScreen`, `createCli({ tuiHiddenScreens })`, `hidden` and `replaceBuiltin` on a screen registration), a per-check reason map for `suites.tui.skip` in `runPlatformConformance` (it no longer reads any `skip` key as a whole-suite skip), an on-demand `refresh()` on `pollFeed` and `DashboardSource`, and optional `banner` and `footnote` slots on the root menu (`setTuiRootMenuSlots`, `createCli({ tuiMenuRoot })`) and on any section. All additive.
