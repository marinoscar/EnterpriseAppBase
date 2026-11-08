# `@marinoscar/platform-cli/tui`

The TUI's screen registry: the menu lists the platform's screens and every screen an app registers, by `order` then route id, with Quit last. CLI layer; part of `@marinoscar/platform-cli`; re-exports the `engine` slice. Importing it loads React (the engine slice needs it) but never ink.

## Purpose and scope

`registerTuiScreen({ route, label, order, component | load })` adds a screen; `BUILTIN_TUI_SCREENS` lists the platform's (`login` 10, `invoke` 20, `status` 30, `node` 40, `deploy` 50, `logout` 60). The router owns `menu` and `quit`. The TUI opens only for a bare invocation in a real terminal (the gate is unchanged).

Since RETRO-G1.2 (#1066) every screen also reads one shared app context: `useTuiApp()` returns the `session` (logged in, server URL, identity; never the token), `nav` (a push/pop stack), `selection` (an app-defined chip such as an active project), `theme` (colour tokens and glyphs, colourless under `NO_COLOR` / `--no-color`) and `appState` (data an app loads once). The TUI also starts on consoles where `process.stdin` cannot enter raw mode, by reading the controlling terminal (`/dev/tty`).

The ink building blocks and a small component kit ship on the second subpath, `@marinoscar/platform-cli/tui/ui` (see [Component kit](#component-kit-tuiui)). Not in scope: the platform screens' own components (internal): a screen is an ordinary ink component the app writes.

## Install and peer dependencies

Ships inside `@marinoscar/platform-cli`:

```ts
import { registerTuiScreen, type TuiScreenProps } from '@marinoscar/platform-cli/tui';
```

A screen component imports `ink` (`^7.1.1`) and `react` (the package's peer). Read the context with `useTuiApp()` (React only, no ink):

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

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `registerTuiScreen` | registry | `registerTuiScreen(screen: TuiScreenRegistration): void` | Add an app screen to the TUI menu (EvoPath's Android release screen) | experimental | [example](../../../../apps/cli/src/examples/about.tui.ts) |
| `registerTuiSelection` | registry | `registerTuiSelection<T>(selection: TuiSelectionRegistration<T>): void` | Show the thing the app works inside of (an active project) as a header chip, readable on every screen with `useTuiSelection(id)` | experimental | [example](../../../../apps/cli/src/examples/workspace.tui-selection.ts) |
| `registerTuiStateLoader` | registry | `registerTuiStateLoader<T>(loader: TuiStateLoaderRegistration<T>): void` | Load app data once for every screen (a database handle, update info), read with `useTuiState(id)` | experimental | [example](../../../../apps/cli/src/examples/build-info.tui-state.ts) |
| `registerTuiScreenSection` | registry | `registerTuiScreenSection(screenId: string, section: ComponentType<TuiSectionProps> \| { id: string; load: () => Promise<ComponentType<TuiSectionProps>> }, options?: { id?: string }): void` | Add an ink section below the `node` or `deploy` screen's list (a fleet note, a release hint); a section that throws shows a notice and the screen keeps working | experimental | [example](../../../../apps/cli/src/examples/fleet-note.tui-section.tsx) |

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

## Data

None, beyond one optional key. A selection registered with `persist: 'config'` stores the chosen item's key under `tui.selection.<id>` in the CLI config file (`~/.<cli>/config.json`, mode 0600), never on the server. `login` replaces the file, so a login clears it and the first item is chosen again.

## Permissions and settings

None. A CLI process has no RBAC of its own; the API enforces the permissions of the stored token.

## UI

The terminal menu and the registered screens. A screen receives `onDone` (pop the stack) and optional `params`. A screen opened from the menu goes back to the menu with `onDone`, so Esc keeps its meaning; a screen that opens a sub-screen with `nav.push` returns to itself. The frame header shows each registered selection with a value as a chip, such as `[Workspace: Workspace Alpha]`.

## Infra

None. The TUI reads no environment variable of its own beyond the gate's `<NAME>_NO_TUI`.

## Observability

None. Screens render to the terminal only.

## Security notes

A screen must not print a token or a credential into a frame; the platform screens show masked hints only. The context never exposes the stored bearer token (`pat_`, `nod_` or JWT): the session holds `loggedIn`, the server URL and the identity the server returned, and the loader context holds no credential; screens reach the API through the existing api-client. When stdin cannot enter raw mode the TUI opens `/dev/tty` read-only and destroys that stream on exit; with no usable terminal it prints one line and exits with the usage code, never a stack trace.

## Conformance suite

None. `menu.registry.test.tsx` in the package pins the built-in order and the refusals; `context.test.tsx` pins the stack (push, pop, top frame only, cleanup), selections, state loaders and the theme; `raw-mode.test.ts` the terminal fallback.

## Upgrade notes

0.x (RETRO-G1.4): additive subpath `@marinoscar/platform-cli/tui/ui` (component kit and the promoted screen building blocks); the built-in `node` screen now shows its totals as a meter and its recent jobs as an event log.

0.x (RETRO-G1.2): `TuiScreenProps` gains optional `params`; `onDone` now pops the stack, which for a screen opened from the menu is the same as before. A redirected stdin with a usable `/dev/tty` no longer refuses the TUI. Additive: `useTuiApp`, `registerTuiSelection`, `registerTuiStateLoader`, `defaultTuiTheme`, `createCli({ tuiTheme, tuiSelections, tuiStateLoaders })`.

0.x: replaces the closed `type Route` union and the hand-written menu list of the forked CLI (#715).

## Troubleshooting

- `TUI screen route "x" is reserved` / `is already a built-in screen`: choose another route id.
- `needs exactly one of component or load`: give one, not both.
- `useTuiApp() was called outside a TuiAppProvider`: the TUI app root mounts the provider; in a test, wrap the screen in `TuiAppProvider`.
- `This terminal cannot run the interactive interface`: neither stdin nor `/dev/tty` can enter raw mode (serial, hypervisor or LXC consoles); connect with `ssh -t` or use the subcommands.
- The header chip never shows: no selection is registered, or its `load` returned nothing; a failed load is on `useTuiSelection(id).error`.
- The screen never appears: the TUI only opens for a bare invocation in a real terminal; `--help` and scripts never see it.

## Links

- [Package README](../../README.md)
- [Platform packages spec: worked examples, CLI](../../../../docs/specs/platform-packages.md#cli)
- [Package documentation standard](../../../../docs/PACKAGES.md)
