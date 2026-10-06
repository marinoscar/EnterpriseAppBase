# @marinoscar/platform-api

The NestJS side of the platform: dynamic modules (one subpath export per slice, for example `@marinoscar/platform-api/<slice>`) that an app imports into its own `AppModule` and extends through options, registries and injection tokens. CommonJS, compiled with `tsc` so decorator metadata (`design:paramtypes`) survives for Nest dependency injection.

## Install

```bash
npm install @marinoscar/platform-api
```

## Peer dependencies

Install these in the app; the package never bundles its own copy (a second copy breaks dependency injection, hooks or theme context).

| Package | Range |
|---|---|
| `@nestjs/common` | `^11.1.12` |
| `@nestjs/core` | `^11.1.12` |
| `@nestjs/swagger` | `^11.2.5` |
| `@opentelemetry/api` | `^1.9.1` |
| `@prisma/client` | `^7.8.0` |
| `fastify` | `^5` |
| `nestjs-zod` | `^5.4.0` |
| `reflect-metadata` | `^0.2.2` |
| `rxjs` | `^7.8.1` |
| `zod` | `^4.4.3` |

## Status

Scaffold only (version `0.0.0`): the package builds, packs and loads, and exports nothing but its own name. Slices arrive in later releases of the platform program.

Full README per the Package documentation standard arrives with #693.
