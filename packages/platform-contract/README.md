# @marinoscar/platform-contract

Zod schemas, DTOs and TypeScript types shared by `@marinoscar/platform-api` and `@marinoscar/platform-web`, so the server and the browser validate the same shapes. It is the only dual-format package: it ships CommonJS (for the API) and ESM (for the web app and the CLI) from one source, selected by the `exports` map.

## Install

```bash
npm install @marinoscar/platform-contract
```

## Peer dependencies

Install these in the app; the package never bundles its own copy (a second copy breaks dependency injection, hooks or theme context).

| Package | Range |
|---|---|
| `zod` | `^4.4.3` |

## Status

Scaffold only (version `0.0.0`): the package builds, packs and loads, and exports nothing but its own name. Slices arrive in later releases of the platform program.

Full README per the Package documentation standard arrives with #693.
