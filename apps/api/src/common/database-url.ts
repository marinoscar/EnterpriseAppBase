// =============================================================================
// The one place a PostgreSQL connection string is built (issue #172)
// =============================================================================
//
// DATABASE_URL is not a primary input in this codebase — it is derived from the
// individual POSTGRES_* variables. That derivation used to exist in three
// places that disagreed with each other:
//
//   - scripts/prisma-env.js  encoded the password, ignored DATABASE_URL
//   - src/prisma/prisma.service.ts  encoded the password, honoured DATABASE_URL
//   - src/config/configuration.ts  did NEITHER
//
// The consequence was specific and expensive. `configuration.ts` ASSIGNS its
// result to process.env.DATABASE_URL, and `prisma.service.ts` returns
// process.env.DATABASE_URL when it is set — so the unencoded string overwrote
// the encoded one, and the careful encoding in the service was defeated at
// runtime by the module that ran first. Migrations, which go through
// prisma-env.js, kept working. That is the worst shape a bug can have: the
// schema applies cleanly, and the application then cannot connect.
//
// A password containing `@` is the clearest case — it introduces a second `@`
// into the authority section and the host is parsed as whatever follows the
// last one — but `: / # ? %` and a space are all equally capable of it. This
// matters more than it looks: `openssl rand -base64 32`, which the deployment
// wizard offers, routinely produces `/` and `+`.
//
// SCRIPTS/PRISMA-ENV.JS NECESSARILY KEEPS ITS OWN COPY. It is CommonJS, runs
// under plain `node` before anything is compiled, and tsconfig.build.json sets
// rootDir to ./src, so it cannot import this module. The two are held together
// by src/common/database-url.spec.ts, which requires that file directly and
// asserts both produce identical output over a table of awkward inputs. If you
// change the rules here, that test fails until you change them there too.
//
// PACKAGED (#740): the builder lives in `@marinoscar/platform-api/core`, where
// the db-backup slice's dump, restore and admin connections reach it; this file
// re-exports it so every app import and `database-url.spec.ts` stay as they
// were.
// =============================================================================

export { buildDatabaseUrl } from '@marinoscar/platform-api/core';
export type { DatabaseEnv } from '@marinoscar/platform-api/core';
