# @marinoscar/platform-cli

Command and TUI building blocks for an app's own command-line client: Commander commands and ink components an app registers in its CLI. ESM with `sideEffects: false`; runs on Node 20 or later.

## Install

```bash
npm install @marinoscar/platform-cli
```

## Peer dependencies

Install these in the app; the package never bundles its own copy (a second copy breaks dependency injection, hooks or theme context).

| Package | Range |
|---|---|
| `commander` | `^14.0.2` |
| `ink` | `^7.1.1` |
| `react` | `^19.2.8` |

## Status

Scaffold only (version `0.0.0`): the package builds, packs and loads, and exports nothing but its own name. Slices arrive in later releases of the platform program.

Full README per the Package documentation standard arrives with #693.
