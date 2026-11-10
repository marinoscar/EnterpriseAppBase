# PP-5.1 spike: database packaging and row-level security

Throwaway prototype for issue #708. **Nothing here is part of the application**: it is not a workspace, it is not
imported by `apps/*` or `packages/*`, CI does not run it, and it never touches `apps/api/prisma/**`. The decisions it
produced are recorded in [ADR 0002](../docs/adr/0002-database-packaging-and-rls.md); the shipped implementations are
#709 (composer), #710 (sync and lock), #711 (baseline) and #725 (RLS).

Each script answers one question, prints what it observed, **exits non-zero if any check fails**, and writes its last
transcript to `results/<script>.txt` (committed, so the ADR's quoted output can be checked against a real run).

## Run it

Prerequisites: `npm ci` at the repository root, then `cd apps/api && npx prisma generate` (only so `prisma` and
`@prisma/adapter-pg` resolve), and a disposable PostgreSQL 16 on `127.0.0.1:5433` with a superuser:

```bash
docker compose -f infra/compose/test.compose.yml up -d     # user postgres / password postgres, port 5433
node spike/q1-multifile.mjs && node spike/q2-compose-user.mjs && node spike/q3-install-lock.mjs \
  && node spike/q4-baseline.mjs && node spike/q5-rls.mjs
```

`POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER` and `POSTGRES_PASSWORD` override the defaults. The scripts create and
drop only databases and roles whose names start with `pp_5_1_`, and refuse any other name. Scratch projects are built
under `spike/.work/` (git-ignored) and rebuilt on every run. The scripts use the Prisma CLI in `node_modules` with an
explicit per-experiment `prisma.config.ts` and `DATABASE_URL`; they never use bare `npx prisma` against a real database.

| Script | Question | Needs |
|---|---|---|
| `q1-multifile.mjs` | Does a Prisma 7 schema folder work with `generate`, `migrate dev/deploy/diff`, the `npm run prisma:*` scripts and the Dockerfile's dummy-URL `generate`? Where must `migrations/` live? | PostgreSQL |
| `q2-compose-user.mjs` | Can `extend model` fragments compose `User`, `Job` and `StorageObject` with typed relations? Which errors must the composer reject? How does option 2 (raw-SQL foreign key) compare? | PostgreSQL |
| `q3-install-lock.mjs` | Does an installed migration keep its checksum, do app and package migrations interleave, what does a lock catch that Prisma does not? | PostgreSQL |
| `q4-baseline.mjs` | Baseline an existing database on a copy: map, ledger check, live diff, raw-SQL index check, `migrate resolve --applied`, partial mode, rehearsal on a `pg_dump` copy | PostgreSQL, `pg_dump`, `pg_restore` |
| `q5-rls.mjs` | Transaction-local `set_config` with a Prisma client extension, concurrent isolation, PgBouncer, the three bypass options, `pg_dump` and `pg_restore` with RLS on | PostgreSQL superuser; `pgbouncer` for the pooler half |

`q5-rls.mjs` reports its PgBouncer half as **skipped** (not failed) when no `pgbouncer` binary is on `PATH`
(`apt-get install pgbouncer`, version 1.22 was used; as root the script starts it as the `postgres` user, because
PgBouncer refuses to run as root). Docker was not available where the spike was run, so a PgBouncer container was not
used; the binary behaves the same.

## Layout

| Path | What it is |
|---|---|
| `lib/env.mjs` | Scratch database and role helpers, the Prisma CLI runner, the pass/fail recorder |
| `lib/prisma-blocks.mjs` | A small line-oriented reader for `prisma format`-shaped schema text |
| `lib/slices.mjs` | The spec's "Model ownership follows slices" table, as data (31 models, 10 enums) |
| `lib/split-schema.mjs` | Splits the real schema into slice files (Q1) and into fragments with `extend model` blocks (Q2) |
| `lib/compose.mjs`, `platform-db-compose.mjs` | The composer prototype and its CLI (`--package`, `--app`, `--out`, `--check`) |
| `lib/sync.mjs` | `platform db sync` and the offline lock check |
| `lib/baseline.mjs` | The baseline procedure's steps (map, ledger, diff, index check) |
| `lib/rls.mjs` | GUC names, the policy template, `forScope`, `runInScope`, `forSystem`, `runAsSystem` |
| `results/` | The transcript of the last run of each script |

## What is deliberately not here

- No production code, no change to the application's migrations or schema, no new environment variable.
- No RDS Proxy measurement: it needs an AWS account. See
  [the RDS Proxy runbook](../docs/runbooks/rds-proxy-rls-check.md).
- No Docker-based PgBouncer; see above.
