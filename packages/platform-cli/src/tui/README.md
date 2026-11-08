# `@marinoscar/platform-cli/tui`

The TUI's screen registry: the menu lists the platform's screens and every screen an app registers, by `order` then route id, with Quit last. CLI layer; part of `@marinoscar/platform-cli`; re-exports the `engine` slice. Importing it loads React (the engine slice needs it) but never ink.

## Purpose and scope

`registerTuiScreen({ route, label, order, component | load })` adds a screen; `BUILTIN_TUI_SCREENS` lists the platform's (`login` 10, `invoke` 20, `status` 30, `node` 40, `deploy` 50, `logout` 60). The router owns `menu` and `quit`. The TUI opens only for a bare invocation in a real terminal (the gate is unchanged).

Since RETRO-G1.2 (#1066) every screen also reads one shared app context: `useTuiApp()` returns the `session` (logged in, server URL, identity; never the token), `nav` (a push/pop stack), `selection` (an app-defined chip such as an active project), `theme` (colour tokens and glyphs, colourless under `NO_COLOR` / `--no-color`) and `appState` (data an app loads once). The TUI also starts on consoles where `process.stdin` cannot enter raw mode, by reading the controlling terminal (`/dev/tty`).

The ink building blocks and a small component kit ship on the second subpath, `@marinoscar/platform-cli/tui/ui` (see [Component kit](#component-kit-tuiui)), and the testing kit on the third, `@marinoscar/platform-cli/tui/testing` (see [Testing](#testing)). Not in scope: the platform screens' own components (internal): a screen is an ordinary ink component the app writes.

## Install and peer dependencies

Ships inside `@marinoscar/platform-cli`:

```ts
import { registerTuiScreen, type TuiScreenProps } from '@marinoscar/platform-cli/tui';
```

A screen component imports `ink` (`^7.1.1`) and `react` (the package's peer). Testing screens with `@marinoscar/platform-cli/tui/testing` also needs `ink-testing-library` (`^4.0.0`), an optional peer: add it as a dev dependency of the app that tests screens. Read the context with `useTuiApp()` (React only, no ink):

```tsx
import { useTuiApp, type TuiScreenProps } from '@marinoscar/platform-cli/tui';

export function ProjectScreen({ onDone, params }: TuiScreenProps): ReactNode {
  const { session, nav, theme } = useTuiApp();
  useInput((input, key) => {
    if (key.escape) onDone(); // pops the stack
    if (input === 'o') nav.push('project-detail', { from: 'list' });
  });
  return <Text {...textColor(theme.primary)}>{session.serverUrl}</Text>;
}
```

## Quick start

The reference example, [`about.tui.ts`](../../../../apps/cli/src/examples/about.tui.ts) (registration) and [`about.screen.tsx`](../../../../apps/cli/src/examples/about.screen.tsx) (component):

```ts
export const aboutScreen: TuiScreenRegistration = {
  route: 'about',
  label: 'About this app',
  order: 70, // after Logout
  load: async () => (await import('./about.screen.js')).AboutScreen,
};
createCli({ ...APP_CLI_OPTIONS, tuiScreens: [aboutScreen] });
```

The whole framework in one composition (each piece is optional, and each has its own example under `apps/cli/src/examples/`):

```ts
createCli({
  ...APP_CLI_OPTIONS,
  tuiScreens: [aboutScreen, dashboardScreen],          // screens, loaded lazily
  tuiMenu: nestedMenuNodes,                            // sections and entries that place them (G1.1)
  tuiSelections: [workspaceSelection],                 // the header chip, useTuiSelection('workspace') (G1.2)
  tuiStateLoaders: [buildInfoLoader],                  // shared data, useTuiState('build-info') (G1.2)
});
// A dashboard screen: new DashboardSource(reducer, daemonAttachFeed({ socketPath })) + useDashboard(source) (G1.3),
// drawn with EventLog, SegmentMeter, StatusLine ... from '@marinoscar/platform-cli/tui/ui' (G1.4),
// tested with renderTuiScreen from '@marinoscar/platform-cli/tui/testing' and the `tui` conformance suite (G1.5).
```

## Configuration

`TuiScreenRegistration`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `route` | `string` | required | Unique id, lowercase `[a-z0-9-]`; not `menu`, `quit` or a built-in's |
| `label` | `string \| (context) => string` | required | The menu entry; a function gets `{ loggedIn }` |
| `order` | `number` | required | Menu position; built-ins use 10 to 60; ties sort by route |
| `component` | `ComponentType<TuiScreenProps>` | none | The screen (loads ink at startup: prefer `load`) |
| `load` | `() => Promise<ComponentType<TuiScreenProps>>` | none | Loads the screen when it is opened; exactly one of `component` and `load` |

`createCli` options of this slice (besides `tuiScreens` and `tuiSections`):

| Option | Type | Default | Meaning |
|---|---|---|---|
| `tuiTheme` | `TuiThemeOverrides` | none | Colour tokens (`primary`, `success`, `warning`, `error`, `info`, `dim`, `accent`, `banner`), `brand` hues and `glyphs` to replace; colour stays off under `NO_COLOR`, `--no-color` and `TERM=dumb` |
| `tuiSelections` | `TuiSelectionRegistration[]` | `[]` | Same as `registerTuiSelection` |
| `tuiStateLoaders` | `TuiStateLoaderRegistration[]` | `[]` | Same as `registerTuiStateLoader` |

`TuiSelectionRegistration<T>`: `id` (also the key under `tui.selection.<id>` in the CLI config), `label`, `load(ctx)`, `display(item)`, optional `keyOf(item)` (defaults to `display`) and `persist: 'config' | 'none'` (default `none`). After a load the current item is the previous choice, else the persisted one, else the first. `TuiStateLoaderRegistration<T>`: `id` and `load(ctx)`. The loader context is `{ loggedIn, serverUrl, signal }`, never the token; both registries run on mount and again on `session.refresh()`.

Navigation: `nav.push(route, params?)` opens a registered screen on top, `nav.pop()` goes back (a no-op on the menu), `nav.toMenu(sectionId?)` clears the stack, `nav.current` and `nav.depth` describe it. `onDone` is `nav.pop()`. Only the top frame is mounted: a screen below it receives no keys and its effect cleanups have run, and it remounts with the same `params` when you come back (keep state that must survive in `params`, an app state loader or a selection, not in component state).

### The menu tree (RETRO-G1.1)

`registerTuiMenuNode` (or `createCli({ tuiMenu })`) puts screens in a tree. A **section** is a submenu; an **entry** opens a registered screen from inside one. A screen no entry opens stays at the root with its own `label` and `order` (visible when logged out, no login gate), so an app that never registers a node sees exactly the menu it always had. A screen an entry opens leaves the root list: it appears once.

```ts
registerTuiScreen({ route: 'node-dashboard', label: 'Dashboard', order: 10, load: async () => (await import('./node-dashboard.screen.js')).NodeDashboard });
registerTuiMenuNode({ kind: 'section', id: 'node', label: 'Worker node', order: 40 });
registerTuiMenuNode({ kind: 'entry', id: 'node-dashboard', parent: 'node', route: 'node-dashboard', label: 'Dashboard', order: 10 });
registerTuiMenuNode({ kind: 'section', id: 'settings', label: 'Settings', order: 45 });
registerTuiMenuNode({ kind: 'entry', id: 'factory-reset', parent: 'settings', route: 'factory-reset', label: 'Factory reset', order: 90, color: 'red', ellipsis: true });
```

| Field | On | Meaning |
|---|---|---|
| `id` | both | Unique across sections and entries, `[a-z][a-z0-9-]*`; `root` is reserved |
| `parent` | both | The section it sits in; default `root` |
| `label`, `order` | both | Text (or a function of `{ loggedIn }`); position among siblings, ties by id |
| `subtitle` | section | Shown under the breadcrumb instead of the default hint |
| `route` | entry | A registered screen route (built-in or `registerTuiScreen`) |
| `ellipsis` | entry | Opens a further input step; drawn with a trailing `…` |
| `loggedOut` | both | Visible when logged out. Omitted: inherited from the nearest ancestor that sets it (default hidden); an explicit `false` opts one child out |
| `hideWhenLoggedIn` | both | Hidden once logged in |
| `color` | both | A theme token (`error`, `success`, ...) or a colour name (`red` maps to `theme.error`); presentation only, off under `NO_COLOR` |
| `requiresLogin` | entry | Opening the screen while logged out shows the shared notice (`[l] login  [q/Esc] back`) instead; default true unless the entry is visible when logged out |

`parent` and `route` are checked when `createCli` builds the CLI, so registration order is free. A bad node throws there and names its id: unknown parent, a parent that is an entry, unknown route, a cycle, or more than 4 nested sections. A section with no visible entry is hidden.

Keys: Enter opens the highlighted line, Esc goes up one level (nothing at the root), `q` quits from the root only, `1`-`9` jump to the nth line. The digits are drawn (`1. Label`) only once the app registers a node, so a flat menu looks as it did. The header shows `Home › Worker node`. A screen opened from a section returns to that section.

The pure helpers behind `menu.tsx`, for an app's own renderer and for tests: `buildTuiMenuTree(nodes, screens)`, `visibleTuiMenuChildren(sectionId, context, tree?)`, `tuiMenuItemLabel(node, position?, context?)` (the only place the `▸` chevron, the `…` suffix and the accelerator are added), `tuiBreadcrumb(sectionId, context?, tree?)`, `tuiParentSectionId`, `tuiRouteRequiresLogin(route, tree?)` and `tuiMenuColor(theme, color)`. Called without a tree they build one from the registry, with built-in labels unresolved (their route stands in); pass a tree built from the real screens for display. The login gate is presentation only; every call a screen makes is still authorised by the server.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `registerTuiScreen` | registry | `registerTuiScreen(screen: TuiScreenRegistration): void` | Add an app screen to the TUI menu (EvoPath's Android release screen) | experimental | [example](../../../../apps/cli/src/examples/about.tui.ts) |
| `registerTuiMenuNode` | registry | `registerTuiMenuNode(node: TuiMenuNode): void` | Place screens in a nested menu: sections with breadcrumbs, a logged-out cascade, colours and accelerators (MemoriaHub's Worker node and Settings submenus) | experimental | [example](../../../../apps/cli/src/examples/nested-menu.tui.ts) |
| `registerTuiSelection` | registry | `registerTuiSelection<T>(selection: TuiSelectionRegistration<T>): void` | Show the thing the app works inside of (an active project) as a header chip, readable on every screen with `useTuiSelection(id)` | experimental | [example](../../../../apps/cli/src/examples/workspace.tui-selection.ts) |
| `registerTuiStateLoader` | registry | `registerTuiStateLoader<T>(loader: TuiStateLoaderRegistration<T>): void` | Load app data once for every screen (a database handle, update info), read with `useTuiState(id)` | experimental | [example](../../../../apps/cli/src/examples/build-info.tui-state.ts) |
| `registerTuiScreenSection` | registry | `registerTuiScreenSection(screenId: string, section: ComponentType<TuiSectionProps> \| { id: string; load: () => Promise<ComponentType<TuiSectionProps>> }, options?: { id?: string }): void` | Add an ink section below the `node` or `deploy` screen's list (a fleet note, a release hint); a section that throws shows a notice and the screen keeps working | experimental | [example](../../../../apps/cli/src/examples/fleet-note.tui-section.tsx) |
| `DashboardReducer` | hook | `interface DashboardReducer<S, E> { initial(): S; hydrate(state: S, snapshot: unknown): S; reduce(state: S, event: E): S; log?(state: S, lines: LogRecord[]): S; parseEvent(frame: unknown): E \| undefined }` | Teach a dashboard what an engine's snapshot and events mean, as pure functions; pair it with `daemonAttachFeed`, `inProcessFeed` or `pollFeed` in a `DashboardSource` and render with `useDashboard` | experimental | [example](../../../../apps/cli/src/examples/queue.dashboard.ts) |

### Component kit (`tui/ui`)

`@marinoscar/platform-cli/tui/ui` is the only part of this slice that loads ink (RETRO-G1.4, #1068). It is app-neutral and reads colours from `useTuiTheme()`, so it is monochrome under `NO_COLOR` and narrows below 56 and 30 columns. Reference: [`ui/README.md`](ui/README.md).

| Name | Kind | Signature | When to use | Stability |
|---|---|---|---|---|
| `EventLog` | component | `EventLog<K>({ events, kinds, maxVisible?, title? })` | A rolling log of finished, skipped and failed items | experimental |
| `SegmentMeter` / `allocateMeterCells` | component | `SegmentMeter<C>({ segments, total, width? })` | A one-row progress bar over categories; the pure rounding is exported for tests | experimental |
| `MeterLegend` | component | `MeterLegend<C>({ segments, total })` | Swatches, counts and shares for the meter's categories | experimental |
| `StatusLine` | component | `StatusLine({ title, items, done?, durationMs? })` | A header with an elapsed clock and a running or done mark | experimental |
| `ActiveItems` | component | `ActiveItems({ items, maxVisible?, title? })` | Mini progress bars for what is in flight | experimental |
| `RunSummary` | component | `RunSummary({ title, stats, durationMs, failures?, footer? })` | The end-of-run panel with a failures list | experimental |
| `Frame`, `KeyHints`, `Field`, `ErrorNotice`, `ScrollBox`, `useTerminalSize`, `formatDuration` | building blocks | see `ui/README.md` | The platform screens' own chrome, for app screens that should match | experimental |

### Testing

`@marinoscar/platform-cli/tui/testing` is one harness for screen tests, on `ink-testing-library` (an optional peer; install it as a dev dependency). It never reads a real CLI config or token: the provider gets an in-memory session, no identity request, and empty selection and state-loader lists unless the test supplies values.

```tsx
import { renderTuiScreen, stripAnsi } from '@marinoscar/platform-cli/tui/testing';

const screen = await renderTuiScreen(ProjectScreen, {
  session: { loggedIn: true },
  appState: { 'build-info': { version: '1.0.0' } },
  selection: { workspace: [{ id: 'w1', name: 'Workspace Alpha' }] },
  theme: 'mono', // as under NO_COLOR
  columns: 40,
});
await screen.press('down');
await screen.waitForFrame((frame) => frame.includes('Second project'));
await screen.press('esc');
expect(screen.nav.stack.map((frame) => frame.kind)).toEqual(['menu']); // popped back to the menu
screen.unmount();
```

| Helper | Purpose |
|---|---|
| `renderTuiScreen(Screen, { session?, selection?, appState?, theme?, columns?, params?, screens?, useRegistered?, settleMs? })` | Mounts the component in a `TuiAppProvider` in test mode with `onDone` wired to `nav.pop()`; returns `{ lastFrame, frames, stdin, press, type, waitForFrame, nav: { stack }, app, crashed, resize, unmount }`. `press` takes `'esc'`, `'enter'`, `'up'`, `'down'`, `'left'`, `'right'`, `'tab'`, `'space'`, `'backspace'`, `'ctrl-c'`, a digit or any character; `type` sends text. `waitForFrame(predicate, timeoutMs = 2000)` resolves with the ANSI-stripped frame or rejects with the last frame. `screens` supplies components for routes the screen pushes. A screen that throws while rendering shows `[screen crashed: ...]` and `crashed()` returns the message |
| `renderTuiRoute(route, options)` | Mounts the real router at a registered route: the lazy `load`, the registries and the login gate (`session: { loggedIn: false }` shows the shared notice) |
| `renderTuiMenu({ nodes?, screens, loggedIn, section? })` | Renders the menu tree; adds `labels()` (the visible lines with their `▸` and `…`) and `breadcrumb()`. Opening an entry shows `[opened <route>]` |
| `fakeDaemonFeed<E>()`, `fakeEmitterFeed<E>()` | A `DashboardFeed` a test drives by hand (`connect`, `snapshot`, `frame`, `event`, `logs`, `disconnect`, `error`, `attempt`) into a `DashboardSource`; the first is mode `attached` (raw frames go through `parseEvent`), the second `embedded` (typed events) |
| `stripAnsi`, `hasAnsi`, `frameLines`, `renderAt(element, columns, { noColor? })`, `cleanup` | Frame helpers, a bare-element render at a width for kit components, and ink-testing-library's cleanup |

The fake terminal is 100 columns wide unless `columns` says otherwise. Plain `<Text>` is not re-wrapped at the new width in a test; a screen built on `Frame` and `useTerminalSize()` degrades as it does in a terminal. Test a dashboard reducer without ink at all: call `reduce`, or drive a `DashboardSource` with a fake feed.

## Data

None, beyond one optional key. A selection registered with `persist: 'config'` stores the chosen item's key under `tui.selection.<id>` in the CLI config file (`~/.<cli>/config.json`, mode 0600), never on the server. `login` replaces the file, so a login clears it and the first item is chosen again.

## Permissions and settings

None. A CLI process has no RBAC of its own; the API enforces the permissions of the stored token.

## UI

The terminal menu and the registered screens. A screen receives `onDone` (pop the stack) and optional `params`. A screen opened from the menu goes back to the menu with `onDone`, so Esc keeps its meaning; a screen that opens a sub-screen with `nav.push` returns to itself. The frame header shows each registered selection with a value as a chip, such as `[Workspace: Workspace Alpha]`.

### Dashboards

A dashboard is a pure reducer fed by a pluggable feed, so its logic is tested without ink and the same screen code serves an attached daemon, an in-process engine and a server poll (`src/engine/tui/dashboard/`).

| Piece | Role |
|---|---|
| `DashboardReducer<S, E>` | Pure functions: `initial`, `hydrate` (the on-connect snapshot), `reduce` (one event), optional `log`, and `parseEvent` (validates a raw frame; `undefined` drops it) |
| `DashboardFeed<E>` | Where data comes from: `{ mode: 'attached' \| 'embedded' \| 'poll', start(emit), stop() }` |
| `DashboardSource<S, E>` | Owns the state: `getState()` (a new object per change, with `connected`, `everConnected`, `error`, `attempts`, `mode` added), `subscribe`, `start`, `stop` |
| `useDashboard(source)` | The ink side: starts the source on mount, stops it on unmount (no timer or request outlives the screen), re-renders per state |

Feeds:

- `daemonAttachFeed({ socketPath, channel?, reconnectMs? })` attaches to the worker daemon's socket and reconnects until `stop()` (a worker restarts when the memory valve fires). It is **read-only**: it never sends a frame. `channel` selects an engine an app published with `registerDaemonChannel` (default `node`; a frame with no `channel` field is the node's, so old daemons and old TUIs interoperate).
- `inProcessFeed(emitter, { snapshot, eventName?, logEventName?, refreshSnapshot? })` follows an engine in this process: the snapshot on start, then every event (re-reading the snapshot after each one unless `refreshSnapshot: false`).
- `pollFeed(fetch, { intervalMs })` calls `fetch(signal)` one request at a time; `stop()` aborts the request in flight and clears the timer. A poll that must say something specific (a 403) returns it as its event instead of throwing.
- `selectDashboardFeed({ socketPath, channel?, isDaemonRunning, embedded? })` attaches when a daemon is running, else builds the embedded feed when one is offered, else attaches anyway so the screen can say that no worker is running.

Built-in screens on the pattern:

- **Worker node** (`node`) attaches by default. With no worker running, `s` starts a detached one and attaches; `e` runs the worker inside the terminal (`embeddedNodeFeed`, through `startNode`). Embedded keeps the default heap (an interactive process cannot re-exec itself with a bigger one without breaking raw-mode input) and the memory valve closes the whole screen when it fires, so the screen says so before the key is pressed and while it runs.
- **Jobs queue** (`jobs`, order 35) polls `GET /api/admin/jobs/stats` and `/insights` every 5 seconds with the caller's own credential (`jobsInsightsReducer` over `pollFeed`). A 403 (no `jobs:read`) renders a notice and polling continues. The menu entry is listed for every logged-in user for now; hiding it for callers without the permission waits on the menu tree's visibility rules.

```ts
const source = useMemo(() => new DashboardSource(myReducer, daemonAttachFeed<MyEvent>({ socketPath, channel: 'sync' })), []);
const state = useDashboard(source); // { ...your data, connected, everConnected, error, attempts, mode }
```

The reference example is [`queue.dashboard.ts`](../../../../apps/cli/src/examples/queue.dashboard.ts).

## Infra

None. The TUI reads no environment variable of its own beyond the gate's `<NAME>_NO_TUI`.

## Observability

None. Screens render to the terminal only.

## Security notes

A screen must not print a token or a credential into a frame; the platform screens show masked hints only. The context never exposes the stored bearer token (`pat_`, `nod_` or JWT): the session holds `loggedIn`, the server URL and the identity the server returned, and the loader context holds no credential; screens reach the API through the existing api-client. When stdin cannot enter raw mode the TUI opens `/dev/tty` read-only and destroys that stream on exit; with no usable terminal it prints one line and exits with the usage code, never a stack trace.

## Conformance suite

The `tui` suite (RETRO-G1.5, #1069) is registered with `registerCliConformanceSuite` and run by `runPlatformConformance({ suites: { tui: {} } })` after `createCli` (a suite left out does not run). Each check is one or more cases; the pure checks are exported from `@marinoscar/platform-cli/testing` (`checkTuiMenu`, `checkTuiLazy`, `checkTuiLabels`, `checkTuiNoInkImport`, `checkDashboardReducer`) so a test can prove each fails on a broken fixture.

| Check | Invariant |
|---|---|
| `menu-references` | Every menu entry opens a registered screen, every section is reachable by a logged-in or a logged-out user, no cycles, nesting within 4 (the message names the node) |
| `lazy-screens` | Every app screen and every `node`/`deploy` section uses `load`, so `--help` and `api` never load ink; `allowEager` lists the deliberate exceptions (a screen route, or `node:<id>` for a section) |
| `no-ink-import` | Importing `@marinoscar/platform-cli/tui` (default) and each entry of `importEntries` loads no `ink`, proven in a fresh Node process with a resolve hook. An app's module must be compiled JavaScript (`dist/app.js`) to be listed |
| `labels` | Every section, entry and screen label is non-empty when logged in and when logged out (a throwing label function fails) |
| `reducer-purity` | Each dashboard in `dashboards` (`{ id, reducer, events?, snapshot? }`) folds its events into a deeply frozen `initial()` without throwing or changing it, and `initial()` returns a fresh object each call |
| `screens-render` | Every app screen renders a non-empty frame without throwing at each width of `columns` (default 80, 40, 24); `screenParams` supplies `params` by route |
| `no-color` | Every app screen emits no colour escape under the monochrome theme |
| `login-gate` | Every login-gated entry shows the "not logged in" notice when logged out |

Options (all optional): `allowEager`, `importEntries`, `dashboards`, `screenParams`, `columns`, and `skip: { '<check>': 'reason' }`. A skip needs a written reason and registers a passing `<check>: skipped by the app (<reason>)` case; an unknown check name throws. The render checks need `ink-testing-library`; without it they fail with the install command (or skip them with a reason). The reference app runs the suite in [`conformance.test.ts`](../../../../apps/cli/src/conformance.test.ts), the starter in `starter/apps/cli/src/cli.test.ts`.

The package's own tests pin the rest: `menu.registry.test.tsx` the built-in order and the refusals; `menu-registry.test.ts`, `menu-tree.test.ts` and `menu.render.test.tsx` the menu tree (validation, the logged-out cascade, labels, breadcrumbs, the login gate, Esc and accelerators, the unchanged flat menu); `context.test.tsx` the stack, selections, state loaders and the theme; `raw-mode.test.ts` the terminal fallback; `testing/harness.test.tsx` and `conformance.test.tsx` the kit and the suite.

## Upgrade notes

0.x (RETRO-G1.5): additive: the `@marinoscar/platform-cli/tui/testing` subpath, the `tui` conformance suite and `ink-testing-library` as an optional peer (`^4.0.0`). Nothing changes at runtime. kvox and EvoPath need no change; they opt in with `tui: {}` when they want the checks. An app with a forked TUI maps it onto the framework in this order: its menu tree to `registerTuiMenuNode` (sections and entries over `registerTuiScreen` screens), its app state to `registerTuiStateLoader`, its active selection (project, workspace) to `registerTuiSelection`, its dashboards to a `DashboardReducer` plus a `DashboardSource` with `daemonAttachFeed`, `inProcessFeed` or `pollFeed`, and its widgets to the kit in `tui/ui`; then replace its hand-written Ink harness with `renderTuiScreen` and run the `tui` suite.

0.x (RETRO-G1.1): additive: `registerTuiMenuNode`, `createCli({ tuiMenu })` and the menu-tree helpers. With no menu nodes the root menu is the same list; Esc on the root menu no longer quits (use `q` or the Quit line).

0.x (RETRO-G1.4): additive subpath `@marinoscar/platform-cli/tui/ui` (component kit and the promoted screen building blocks); the built-in `node` screen now shows its totals as a meter and its recent jobs as an event log.

0.x (RETRO-G1.2): `TuiScreenProps` gains optional `params`; `onDone` now pops the stack, which for a screen opened from the menu is the same as before. A redirected stdin with a usable `/dev/tty` no longer refuses the TUI. Additive: `useTuiApp`, `registerTuiSelection`, `registerTuiStateLoader`, `defaultTuiTheme`, `createCli({ tuiTheme, tuiSelections, tuiStateLoaders })`.

0.x: replaces the closed `type Route` union and the hand-written menu list of the forked CLI (#715).

## Troubleshooting

- `TUI screen route "x" is reserved` / `is already a built-in screen`: choose another route id.
- `TUI menu node "x" has unknown parent` / `opens unknown screen route`: register the section or screen it names (any order); the check runs in `createCli`.
- `needs exactly one of component or load`: give one, not both.
- `useTuiApp() was called outside a TuiAppProvider`: the TUI app root mounts the provider; in a test, wrap the screen in `TuiAppProvider`.
- `This terminal cannot run the interactive interface`: neither stdin nor `/dev/tty` can enter raw mode (serial, hypervisor or LXC consoles); connect with `ssh -t` or use the subcommands.
- The header chip never shows: no selection is registered, or its `load` returned nothing; a failed load is on `useTuiSelection(id).error`.
- `The tui render checks need ink-testing-library`: install it as a dev dependency of the app, or skip the render checks with a reason.
- `waitForFrame: no frame matched`: the message prints the last frame; a key that does nothing is usually an Esc sent before ink finished reading the previous input, so raise `settleMs`.
- `no-ink-import` names `ink`: a registration module imports a screen at the top level; register it with `load` and keep ink inside the screen's own module.
- The screen never appears: the TUI only opens for a bare invocation in a real terminal; `--help` and scripts never see it.

## Links

- [Package README](../../README.md)
- [Platform packages spec: worked examples, CLI](../../../../docs/specs/platform-packages.md#cli)
- [Package documentation standard](../../../../docs/PACKAGES.md)
