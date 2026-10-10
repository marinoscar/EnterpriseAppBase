# `@marinoscar/platform-cli/tui`

The TUI's screen registry: the menu lists the platform's screens and every screen an app registers, by `order` then route id, with Quit last. CLI layer; part of `@marinoscar/platform-cli`; re-exports the `engine` slice. Importing it never loads ink.

## Purpose and scope

`registerTuiScreen({ route, label, order, component | load })` adds a screen; `BUILTIN_TUI_SCREENS` lists the platform's (`login` 10, `invoke` 20, `status` 30, `node` 40, `deploy` 50, `logout` 60). The router owns `menu` and `quit`. The TUI opens only for a bare invocation in a real terminal (the gate is unchanged).

Not in scope: the platform screens' components (internal) and ink building blocks such as `Frame`: a screen is an ordinary ink component the app writes.

## Install and peer dependencies

Ships inside `@marinoscar/platform-cli`:

```ts
import { registerTuiScreen, type TuiScreenProps } from '@marinoscar/platform-cli/tui';
```

A screen component imports `ink` (`^7.1.1`) and `react` (the package's peer).

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

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `registerTuiScreen` | registry | `registerTuiScreen(screen: TuiScreenRegistration): void` | Add an app screen to the TUI menu (EvoPath's Android release screen) | experimental | [example](../../../../apps/cli/src/examples/about.tui.ts) |

## Data

None. The slice holds no data model and persists nothing.

## Permissions and settings

None. A CLI process has no RBAC of its own; the API enforces the permissions of the stored token.

## UI

The terminal menu and the registered screens. A screen receives `onDone` and returns to the menu with it; there is no route history, so Esc always means back to the menu.

## Infra

None. The TUI reads no environment variable of its own beyond the gate's `<NAME>_NO_TUI`.

## Observability

None. Screens render to the terminal only.

## Security notes

A screen must not print a token or a credential into a frame; the platform screens show masked hints only.

## Conformance suite

None. `menu.registry.test.tsx` in the package pins the built-in order and the refusals.

## Upgrade notes

0.x: replaces the closed `type Route` union and the hand-written menu list of the forked CLI (#715).

## Troubleshooting

- `TUI screen route "x" is reserved` / `is already a built-in screen`: choose another route id.
- `needs exactly one of component or load`: give one, not both.
- The screen never appears: the TUI only opens for a bare invocation in a real terminal; `--help` and scripts never see it.

## Links

- [Package README](../../README.md)
- [Platform packages spec: worked examples, CLI](../../../../docs/specs/platform-packages.md#cli)
- [Package documentation standard](../../../../docs/PACKAGES.md)
