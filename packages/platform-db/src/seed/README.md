# @marinoscar/platform-db/seed

`@marinoscar/platform-db/seed`: the platform's idempotent seed. `seedPlatform(prisma, input)` upserts the roles, permissions, default role grants, the `global` system settings row, the initial administrator's allowlist entry and the default organization; `platformSeedInputFrom(snapshot, env)` builds that input from the registries' plain-data snapshots. Part of the data layer, it depends on no other slice (`packages/platform-slices.json`), imports no Prisma client and no Nest.

## Purpose and scope

Does: the platform half of an app's `prisma/seed.ts`, with semantics identical to the script it replaced (issue #712): upserts only, sequential, in a fixed order, under the console lines operators read during `appctl deploy`. It also reads the two committed catalogs an app renders from its registries (`readSeedSnapshot`).

Does not: seed an app's own data (the app's `seed-app.ts` does, after this runs), run migrations, create the Prisma client, or delete anything. Org-scoped roles extend `PlatformSeedInput` in a later story.

## Install and peer dependencies

Ships inside `@marinoscar/platform-db`; import it by its subpath:

```ts
import { platformSeedInputFrom, readSeedSnapshot, seedPlatform } from '@marinoscar/platform-db/seed';
```

No peer beyond the package's own ([README](../../README.md#install-and-peer-dependencies)). The slice never imports `@prisma/client`: it types the client it is handed structurally (`SeedPrisma`), so the app's generated client, a fake in a test, or a client of another generator output all fit.

## Quick start

The reference app's [`prisma/seed.ts`](../../../../apps/api/prisma/seed.ts) is the whole recipe: a standalone script, run under `ts-node --transpile-only`, with no Nest in its import graph.

```ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { platformSeedInputFrom, seedPlatform } from '@marinoscar/platform-db/seed';
import { seedApp } from './seed-app';
import { SEED_SNAPSHOT } from './seed-data';

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

async function main() {
  await seedPlatform(prisma, platformSeedInputFrom(SEED_SNAPSHOT, process.env), { info: console.log });
  await seedApp(prisma); // the app's own seed data: apps/api/prisma/seed-app.ts
}
```

The app's permissions and settings reach the seed through its registries, never through a platform file: register them, then render the catalogs (`npm run catalog:permissions` and `npm run catalog:settings` in the reference app), and `readSeedSnapshot` loads them.

## Configuration

`seedPlatform(prisma, input, log?)` takes the `PlatformSeedInput`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `roles` | `{ name, description }[]` | required | Roles, upserted by `name`; the description is refreshed on every run |
| `permissions` | `{ name, description }[]` | required | Permissions, upserted by `name`; the description is refreshed on every run |
| `roleGrants` | `Record<role, permission[]>` | required | Default grants, upserted by `roleId_permissionId`; a name with no row is skipped and reported, never created |
| `systemSettingsDefaults` | `Record<string, unknown>` | required | The `global` row's value, composed from the settings namespaces; written only when the row is absent |
| `initialAdminEmail` | `string` | none | Added to the allowlist lower-cased, with `update: {}`; absent means no allowlist write |
| `defaultOrganization` | `{ name, slug }` | `Default organization`, `default` | Created only when no organization is flagged default (looked up by `isDefault`, so a renamed default is left alone); never updated afterwards |
| `log` (third argument) | `SeedLogger` | silent | Receives one line per step |

`platformSeedInputFrom(snapshot, env)` reads `INITIAL_ADMIN_EMAIL` from the `env` it is handed (an unset or empty value means none). `seedPlatform` returns a `SeedSummary` (counts, `skippedGrants`, `allowlistedEmail`, `defaultOrganizationCreated`).

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `PlatformSeedInput` | option | `{ roles, permissions, roleGrants, systemSettingsDefaults, initialAdminEmail?, defaultOrganization? }` | Hand the platform seed an app's roles, permissions, grants and settings defaults; later slices add optional fields (org roles) without breaking callers | experimental | [example](../../../../apps/api/prisma/seed.ts) |

The app's own seed data is not an extension point of this package: it lives in the app's [`seed-app.ts`](../../../../apps/api/prisma/seed-app.ts), which `seed.ts` runs after `seedPlatform`.

## Data

Writes five tables, each by a natural unique, all as upserts: `roles` and `permissions` (`name`, description refreshed), `role_permissions` (`roleId_permissionId`, `update: {}`), `system_settings` (`key: 'global'`, `update: {}`, `version: 1`) and `allowed_emails` (`email`, `update: {}`, note `Initial admin (auto-seeded)`).

**Never deletes.** A permission removed from the registry stays as a row, and so does its grant. Removing one is an explicit migration (expand/contract), never a seed side effect. **Never overwrites an admin-edited value:** the settings row, the allowlist row and the default organization are created once.

**Idempotent.** A second run updates the same rows and creates none. The reference CI's `smoke` job runs the seed twice, and `appctl deploy update` re-runs it on every upgrade, which is how a new permission reaches an existing deployment.

**Reads generated catalogs, never `src/`.** The seed runs in the production image, which carries `dist/` and `prisma/` but not `src/`, so the registry data it needs is rendered into `prisma/catalog/*.json` and read by `readSeedSnapshot`.

## Permissions and settings

Declares no permission and no setting of its own. It writes the ones its input names: the permission and role registries (`permissions.json`) and the settings namespaces' defaults (`system-settings-defaults.json`), both rendered from the registries of the app. Adding a permission or a settings key is a registry change plus a catalog regeneration, never an edit here.

## UI

None. The slice renders nothing.

## Infra

None. It reads one environment variable, `INITIAL_ADMIN_EMAIL` (the initial administrator; it also always bypasses the allowlist), and only from the `env` object `platformSeedInputFrom` is given. It adds no variable for any runtime-configured feature.

## Observability

Emits only what the `SeedLogger` it is given receives: `Seeding roles...`, `✓ Seeded N roles` and the equivalent lines per table, `⊘ INITIAL_ADMIN_EMAIL not set, skipping allowlist seed`, `✓ Created default organization "<slug>"` or `✓ Default organization already exists`, and `⊘ Skipped grant with no matching row: <role>: <permission>` for a grant it skipped. With no logger it is silent. No span or metric.

## Security notes

The seed holds no secret and writes none: no credential column is among the six tables. It writes the default grants, so the registry is the place a grant is reviewed (the permission matrix in the architecture doc must agree with `permissions.json`). It never revokes a grant, and a grant an admin removed by hand is re-created by the next run, exactly as before this slice. The initial administrator is lower-cased and added with `update: {}`, so a seed run cannot alter an allowlist note an admin edited.

## Conformance suite

None yet. The slice ships no conformance suite; `runPlatformConformance()` and the suites arrive with the platform's conformance harness. Its behaviour is pinned by `packages/platform-db/test/seed/` (a fake client) and, against a real database, by the reference app's `test/prisma/seed-platform.db.spec.ts`.

## Upgrade notes

None. No version has been published yet, so there is nothing to migrate from. An app that kept the old `seed.ts` and `seed-data.ts` switches by passing the same arrays through `platformSeedInputFrom`; the rows it writes are the same.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find module '@marinoscar/platform-db/seed'` | The package is not built | `npm run build:packages` from the repository root (the Docker images build it) |
| `Seed catalog .../permissions.json cannot be read` | The catalog is missing from `prisma/` | Run the app's catalog scripts and commit the files |
| A new permission is not granted after the seed | The grant names a permission the registry did not render, or the catalog is stale | Regenerate the catalogs; the seed log prints `⊘ Skipped grant with no matching row` |
| A removed permission is still in the database | The seed never deletes | Remove it with a migration (expand/contract) |
| The seed runs out of memory at deploy | It was type-checked at run time | Keep `--transpile-only` in `prisma.config.ts`; `prisma:typecheck` covers the types in CI |

## Links

- [Package README](../../README.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md#data-migrations-and-seeds)
- [Package documentation standard](../../../../docs/PACKAGES.md)
