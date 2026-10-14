---
"@marinoscar/platform-db": minor
---

`platform db baseline`: adopt the package migration history in a database that already has its schema, without re-running a migration. Dry run by default; `--apply` maps the app's directories to the platform migrations (exact hash, comment-stripped hash, or a `--map` file), refuses on a failed `_prisma_migrations` row, a live schema difference no declared deviation explains, or a missing raw-SQL index, then writes `platform.lock` and marks the migrations that have no directory applied with `prisma migrate resolve --applied`. `--through` adopts a database that is behind. Adds `runBaseline`, `proposeMapping`, `planBaseline`, `renderReport` and `createBaselineDeps`.
