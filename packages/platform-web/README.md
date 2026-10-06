# @marinoscar/platform-web

The React side of the platform: pages, components and hooks built on MUI, exposed one subpath per slice. ESM with `sideEffects: false`; it loads in plain Node ESM as well as through a bundler.

## Install

```bash
npm install @marinoscar/platform-web
```

## Peer dependencies

Install these in the app; the package never bundles its own copy (a second copy breaks dependency injection, hooks or theme context).

| Package | Range |
|---|---|
| `@emotion/react` | `^11.14.0` |
| `@emotion/styled` | `^11.14.1` |
| `@mui/icons-material` | `^9.1.0` |
| `@mui/material` | `^9.1.0` |
| `react` | `^19.2.7` |
| `react-dom` | `^19.2.7` |
| `react-router-dom` | `^7.17.0` |

## Status

Scaffold only (version `0.0.0`): the package builds, packs and loads, and exports nothing but its own name. Slices arrive in later releases of the platform program.

Full README per the Package documentation standard arrives with #693.
