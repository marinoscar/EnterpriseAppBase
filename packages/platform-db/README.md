# @marinoscar/platform-db

The data layer of the platform: Prisma schema fragments (`schema/`), SQL migrations (`migrations/`) and seed functions that an app composes into its own schema and migration history. CommonJS, like the API that consumes it.

## Install

```bash
npm install @marinoscar/platform-db
```

## Peer dependencies

Install these in the app; the package never bundles its own copy (a second copy breaks dependency injection, hooks or theme context).

| Package | Range |
|---|---|
| `@prisma/client` | `^7.8.0` |
| `prisma` | `^7.8.0` |

## Status

Scaffold only (version `0.0.0`): the package builds, packs and loads, and exports nothing but its own name. Slices arrive in later releases of the platform program.

Full README per the Package documentation standard arrives with #693.
