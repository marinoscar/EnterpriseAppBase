---
"@marinoscar/platform-db": minor
---

Migration tooling: the `platform` bin gains `platform db sync` (byte-copy package migrations into the app's `prisma/migrations` under app-local timestamps and record them in `prisma/platform.lock`), `platform db check` (offline lock verification; `--database` also compares `_prisma_migrations` checksums), `platform db promote` (turn an app-generated migration into a package migration) and `platform db drift` (migration history vs schema through a shadow database, plus the raw-SQL index assertion). Adds the `PlatformLock` and manifest models, `planSync`, `applySync`, `checkLock`, `checkLedger`, `promote` and `raw-sql-indexes.json`.
