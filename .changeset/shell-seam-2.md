---
"@marinoscar/platform-web": minor
---

Shell and DataTable seams for real apps (#1109). `ShellUserMenu` gains `avatarSrc` (an app-resolved avatar URL, such as an authenticated proxy, in place of `profileImageUrl`; `null` draws the initials), `renderAvatar(user, initials)` and `showDestinations` (default `true`; `false` drops the destination rows). `ShellAppBar` gains a `leadingActions` slot beside the brand (a group switcher chip), outside the brand's go-home click target and dropped in the drill-down with the brand. `useShellContextPaneVisible(destinationKey?)` is exported from `shell/headless` and `shell/ui`: it reports whether the rail is drawing a context pane, from the rail's own decision (no new media query). `runDataTableConformanceSuite` skips the cases whose precondition is unmet (no `sortable` column, no hideable column) and never counts a `filterOnly` column as a header. Nothing given, every surface renders as before; the five breakpoint gates did not move.
