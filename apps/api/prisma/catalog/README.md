# Seed catalog

Generated, committed JSON that `prisma/seed-data.ts` reads. The seed runs under
ts-node outside the Nest build, and the production image carries `prisma/` but
not `src/`, so the seed cannot import the API's registries; it reads these files
instead. Never edit them by hand. Each is rendered from a registry in `src/`
and checked for staleness in CI:

| File | Rendered from | Regenerate |
|---|---|---|
| `permissions.json` | The role and permission registries (`src/common/permissions/`): roles, permissions and default grants | `npm run catalog:permissions --workspace=api` |
| `system-settings-defaults.json` | The system settings namespace registry (`src/settings/registry/`): every namespace's `defaults`, in registration order | `npm run catalog:settings --workspace=api` |

Check without writing: append `-- --check` (exits 1 and prints the regenerate
command when a file is stale). `test/settings/settings-catalog.spec.ts` runs the
same check in `npm test`.
