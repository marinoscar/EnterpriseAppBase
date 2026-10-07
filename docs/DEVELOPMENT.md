# Development Guide

This guide covers the day-to-day development loop: running the app, the
Fastify, Passport and Prisma gotchas that trip up newcomers, debugging, and
the usual workflow for schema and endpoint changes.

## Table of Contents

1. [Technology Stack](#technology-stack)
2. [Development Setup](#development-setup)
3. [Working with NestJS + Fastify](#working-with-nestjs--fastify)
4. [Database Patterns](#database-patterns)
5. [Common Pitfalls and Solutions](#common-pitfalls-and-solutions)
6. [Testing Guidelines](#testing-guidelines)
7. [Debugging Tips](#debugging-tips)
8. [Development Workflow](#development-workflow)
9. [Platform packages](#platform-packages)
10. [Single-instance dependencies](#single-instance-dependencies)

---

## Technology Stack

### Backend
- **Framework**: NestJS with the **Fastify adapter** (not Express)
- **ORM**: Prisma with PostgreSQL 16
- **Authentication**: Passport (Google OAuth) plus JWT, personal access tokens
  and node credentials
- **Validation**: Zod schemas through `nestjs-zod` (a global `ZodValidationPipe`)
- **Documentation**: OpenAPI 3.1, served as a Scalar reference at `/api/docs`

### Key Difference: Fastify vs Express

This application uses **Fastify** as the HTTP adapter. Anything you copy from
an Express-based NestJS tutorial that touches the raw request or response
needs adapting. Fastify was chosen for its lower overhead and better
TypeScript types; NestJS hides the difference as long as you let it handle
responses.

---

## Development Setup

First-time setup (Google OAuth credentials, `npm run setup` to create
`infra/compose/.env`, the `devnet` network, the dev database overlay,
migrations, seeds and first login) is in the README:
[Start a new app from this template](../README.md#start-a-new-app-from-this-template).
Follow it once, then come back here.

### Dev-only extras

- **Hot reload in Docker.** `dev.compose.yml` runs the API in watch mode and
  the web app under Vite with HMR. This is the default loop.
- **Running outside Docker.** `npm run api:dev` (Nest watch mode, port 3000)
  and `npm run web:dev` (Vite, port 5173, proxying `/api` to
  `http://localhost:3000`) work from the repo root. Two things differ from the
  Docker loop:
  - The API reads configuration from the process environment (and from
    `apps/api/.env` if you create one), not from `infra/compose/.env`. Export
    the `POSTGRES_*`, `JWT_SECRET` and Google variables first. Only the
    `prisma:*` scripts load `infra/compose/.env` for you.
  - There is no Nginx, so the app is on `http://localhost:5173`. Point
    `APP_URL` and `GOOGLE_CALLBACK_URL` at that origin (and register the
    callback with Google), or sign in through the development-only test login
    at `/testing/login`.
- **Event bus adapter.** Outside Docker, `EVENT_BUS_ADAPTER` is usually
  unset, so the API uses the `in-process` bus: live notifications and job
  wake-ups reach only that one process, which is all a single dev API needs.
  `infra/compose/.env` (from `.env.example`) sets `postgres`, which also works
  against one replica and is what a multi-replica deployment requires. Tests
  run in-process (`.env.test` leaves it unset); the real-Postgres adapter is
  covered by `apps/api/test/event-bus/postgres-event-bus.db.spec.ts`.
- **Scratch test database.** `infra/compose/test.compose.yml` starts a
  disposable PostgreSQL 16 (`db-test`) on host port 5433 for real-database
  test runs:

  ```bash
  cd infra/compose && docker compose -f test.compose.yml up -d
  ```

- **Building images directly.** Both images build from the repository root,
  because the only `package-lock.json` is there:

  ```bash
  docker build -f apps/api/Dockerfile .
  docker build -f apps/web/Dockerfile .
  ```

---

## Working with NestJS + Fastify

### Critical Differences from Express

#### 1. Response Methods

**Wrong (Express-style):**
```typescript
@Get('example')
example(@Res() res: Response) {
  return res.status(200).json({ data: 'Hello' });
}
```

**Right (Fastify-style):**
```typescript
@Get('example')
example(@Res() res: FastifyReply) {
  return res.code(200).send({ data: 'Hello' });
}
```

- Use `code()` (Fastify also accepts `status()` as an alias) and `send()`.
  There is no `json()`.
- Import types from `fastify`, not `express`.
- `redirect()` takes the URL first: `res.redirect(url, 302)`.

**Best practice:** avoid `@Res()` unless you must. A handler that returns a
value gets the global `{ data, meta }` envelope and the exception filter for
free. With `@Res()` you own the response, so neither applies (use
`@Res({ passthrough: true })` if you only need to set a cookie or header).

```typescript
@Get('example')
example() {
  return { message: 'Hello' }; // sent as { data: { message: 'Hello' }, meta: { ... } }
}
```

#### 2. Request Objects

```typescript
import { FastifyRequest, FastifyReply } from 'fastify';

@Get('example')
example(@Req() req: FastifyRequest) {
  const ip = req.ip;             // client IP
  const protocol = req.protocol; // http/https
  const hostname = req.hostname; // Host header
  const raw = req.raw;           // the underlying Node.js IncomingMessage
}
```

`req.body`, `req.params`, `req.query` and `req.headers` work as in Express.

### Passport OAuth with Fastify

Passport strategies are written for Express and expect Node's raw
`IncomingMessage` and `ServerResponse`. Fastify wraps both, so the OAuth guard
must unwrap them.

#### The Solution

`apps/api/src/auth/guards/google-oauth.guard.ts`:

```typescript
import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {
  getRequest(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    // Return the raw Node.js IncomingMessage for Passport compatibility
    return request.raw || request;
  }

  getResponse(context: ExecutionContext) {
    const response = context.switchToHttp().getResponse();
    // Return the raw Node.js ServerResponse for Passport compatibility
    return response.raw || response;
  }

  handleRequest<TUser = unknown>(
    err: Error | null,
    user: TUser | false,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      throw err || new Error('Authentication failed');
    }

    // Copy the user from the raw request to the Fastify request
    // so controllers can read req.user normally
    const fastifyRequest = context.switchToHttp().getRequest();
    fastifyRequest.user = user;

    return user;
  }
}
```

1. `getRequest()` and `getResponse()` hand Passport the raw Node objects.
2. Passport runs the OAuth exchange on them.
3. `handleRequest()` copies the authenticated user back onto the Fastify
   request, so controllers can read `req.user`.

**In the controller** (simplified from `auth.controller.ts`):

```typescript
@Get('google/callback')
@Public()
@UseGuards(GoogleOAuthGuard)
async googleAuthCallback(
  @Req() req: FastifyRequest & { user?: GoogleProfile },
  @Res() res: FastifyReply,
) {
  const tokens = await this.authService.handleGoogleLogin(req.user!);
  res.setCookie('refresh_token', tokens.refreshToken!, COOKIE_OPTIONS);

  const redirectUrl = new URL('/auth/callback', appUrl);
  redirectUrl.searchParams.set('token', tokens.accessToken);
  return res.redirect(redirectUrl.toString(), 302);
}
```

The web app reads `?token=` on `/auth/callback`. On failure the API redirects
to `/auth/callback?error=<code>`, a closed set of codes
([SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md#sign-in-failure-contract)).

### Cookies with Fastify

Cookies come from the `@fastify/cookie` plugin, registered in `main.ts`.

```typescript
// Set
res.setCookie('name', 'value', {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/auth',
});

// Read
const value = req.cookies['name'];

// Clear (the path must match the one it was set with)
res.clearCookie('name', { path: '/api/auth' });
```

The refresh cookie is scoped to `/api/auth`, so a browser only sends it to the
auth routes. A `fetch` to `POST /api/auth/refresh` still needs
`credentials: 'include'`.

---

## Database Patterns

### Prisma Transactions

When you create related records (for example a user with a role), do it in one
transaction so a failure cannot leave half the rows behind.

**Wrong (no transaction):**
```typescript
// If the second write fails, the user exists without a role
const user = await prisma.user.create({ data: { email, displayName } });

await prisma.userRole.create({
  data: { userId: user.id, roleId: defaultRole.id },
});
```

**Right (transaction with nested creates):**
```typescript
const user = await prisma.$transaction(async (tx) => {
  return tx.user.create({
    data: {
      email,
      displayName,
      userRoles: { create: { roleId: defaultRole.id } },
      userSettings: { create: { value: DEFAULT_USER_SETTINGS } },
    },
    include: { userRoles: { include: { role: true } } },
  });
});
```

A single `create` with nested `create` blocks (as above) is already atomic;
the explicit `$transaction` matters when you need several top-level writes.

### Organization-scoped data (row-level security)

The tables registered `org` (`storage_objects`, `storage_object_chunks`, `ai_runs`,
`ai_usage_events`) force PostgreSQL row-level security on `org_id`, so a query
that sets no organization returns **no rows** and an insert fails. Reach them
through the org scope, never the bare client:

```typescript
// one statement: every operation and $queryRaw runs after set_config(app.org_id, ..., true)
const items = await this.prisma.forOrg(orgId, { userId }).storageObject.findMany({ where });

// several statements: fn receives the plain transaction client, set_config is first
await this.prisma.runInOrg(orgId, async (tx) => {
  const created = await tx.storageObject.create({ data: { orgId, ...rest } });
  return tx.storageObjectChunk.create({ data: { objectId: created.id, orgId, ...part } });
}, { userId });
```

- A controller takes the organization with `@CurrentOrg()` and passes it to the
  service; a job reads it from its payload (`resolveJobOrgId`) and enqueuers put
  `orgId` there. Never read it from a header, query or body.
- Never open `$transaction(async tx => ...)` on a `forOrg` client: its
  operations escape the transaction. Use `runInOrg`.
- Cross-organization work (purges, retention, backups, the Doctor, an admin
  aggregate) uses `PrismaSystemService` with a reason from the closed list, and
  the file must be on the allowlist in
  `test/tenancy/system-injection-boundary.spec.ts`.
- **The database role must be ordinary.** A superuser ignores every policy.
  `devdb.compose.yml` and `test.compose.yml` create `app` for you
  (`infra/compose/postgres-init/10-application-role.sh`); `.env` says
  `POSTGRES_USER=app`. If the Doctor reports `db.rls_role`, see
  [SECURITY-ARCHITECTURE.md §18](SECURITY-ARCHITECTURE.md#the-application-role).
- A migration that backfills or fixes rows in these tables wraps the statements
  in `BEGIN; SELECT set_config('app.rls_bypass', 'on', true); ...; COMMIT;`;
  under `FORCE` a bare `UPDATE` changes zero rows without an error.
- A db spec that needs to read or write every organization's rows uses
  `createDbClient()` (a bypass raw client); a spec that proves isolation builds its
  own non-superuser database with `test/helpers/rls-database.helper.ts`.

### Seeding the Database

The seed script (`apps/api/prisma/seed.ts`) is idempotent. Always run it
through the `prisma:seed` script, never `ts-node`/`tsx` on the file: the
script builds `DATABASE_URL` from the `POSTGRES_*` variables
(`apps/api/scripts/prisma-env.js`), and the seed has no other way to get it.

```bash
# In Docker (the container's working directory is apps/api)
docker compose exec api npm run prisma:seed

# From the repository root
npm run prisma:seed --workspace=api
```

It creates the four roles (with their scopes), every permission, the role-permission grants and
the default system settings. Run it before the first login, after resetting
the database, and after pulling a change that adds permissions.

**Where the data comes from.** The platform half is
`seedPlatform` from `@marinoscar/platform-db/seed`
([slice README](../packages/platform-db/src/seed/README.md)). `prisma/seed.ts`
builds its input from the registries' committed catalogs
(`prisma/catalog/permissions.json` and `system-settings-defaults.json`, read by
`prisma/seed-data.ts`), so a permission or a settings key is added by registering
it and regenerating the catalogs, never by editing a seed file. The seed only
upserts: it never deletes (a permission removed from the registry stays as a row
until a migration removes it) and never overwrites an admin-edited value.

**Where an app adds its own seed rows.** `apps/api/prisma/seed-app.ts`
(`seedApp(prisma)`), which `seed.ts` runs after `seedPlatform`. Keep it
idempotent (upserts keyed on a natural unique, never a `findFirst` then a
`create`) and Nest-free: the script runs under `ts-node --transpile-only` in an
image without `src/`, and `test/prisma/seed-imports.spec.ts` fails when its import
graph reaches `@nestjs/*` or `src/`. `test/prisma/seed-platform.db.spec.ts` runs
the real seed twice against a scratch database.

---

## Common Pitfalls and Solutions

### 1. "Database seed data missing" on First Login

**Symptom:** the first Google sign-in fails. The API log says
`CRITICAL: Default role "viewer" not found in database`.

**Cause:** migrations ran but seeds did not.

**Solution:** `docker compose exec api npm run prisma:seed`

### 2. Passport OAuth Not Working with Fastify

**Symptom:** the OAuth redirect fails, or `req.user` is undefined in the
callback.

**Cause:** Passport received Fastify objects instead of raw Node objects.

**Solution:** use the guard pattern above.

### 3. `res.json is not a function`

**Cause:** Express-style response code under the Fastify adapter.

**Solution:** `res.code(200).send(...)`, or return a value and let NestJS send
it.

### 4. Foreign Key Violation or Orphaned Rows on User Creation

**Cause:** related rows created in separate, non-transactional writes.

**Solution:** wrap them in `prisma.$transaction()` or use nested creates.

### 5. Error Messages in Redirect URLs

**Symptom:** a redirect fails, or the web app shows attacker-chosen or garbled
text.

**Cause:** an error message was put in a URL. Reserved characters break the
redirect, and a page that renders the value lets anyone craft a link that shows
text of their choosing.

**Solution:** redirect with a code from the closed set, never a message. Use
`buildAuthErrorRedirectUrl` and `resolveAuthErrorCode` from
`apps/api/src/auth/auth-error-codes.ts`, as the OAuth callback does. See
[SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md#sign-in-failure-contract).

### 6. Calling `npx prisma` Directly

**Symptom:** `DATABASE_URL is not set` or a connection to the wrong database.

**Solution:** use the `npm run prisma:*` scripts in `apps/api`
(`prisma:generate`, `prisma:migrate`, `prisma:migrate:dev`, `prisma:seed`,
`prisma:studio`). See `apps/api/scripts/README.md`.

---

## Testing Guidelines

All testing guidance (the suites, how to run them, mocking, fixtures,
end-to-end and visual tests) is in [TESTING.md](TESTING.md). In short:

- `npm test --workspace=api` runs unit and integration suites. Integration
  suites (`*.integration.spec.ts`) boot the real Nest app with Prisma mocked,
  so they need no database. Google OAuth is mocked
  (`apps/api/test/mocks/google-oauth.mock.ts`).
- `*.db.spec.ts` suites run against a real, migrated PostgreSQL via
  `npm run test:db --workspace=api` (for example the `db-test` container from
  `test.compose.yml`, pointed at with the `POSTGRES_*` variables). They skip
  themselves if no database is reachable. Suites that need isolation create
  a scratch database with `apps/api/test/helpers/scratch-database.helper.ts`.
- Web tests: `npm run test:run --workspace=web`.

---

## Debugging Tips

### Debugging the OAuth Flow

1. **Check the configuration** in `infra/compose/.env`: `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `APP_URL`.
2. **Check the callback URL.** It must match the Google Cloud Console entry
   exactly, including scheme and port:
   `http://localhost:3535/api/auth/google/callback`.
3. **Check the allowlist.** Only `INITIAL_ADMIN_EMAIL` and allowlisted emails
   can sign in.
4. **Watch the API logs:**
   ```bash
   docker compose logs api -f
   ```
5. **Check the provider list:**
   ```bash
   curl http://localhost:3535/api/auth/providers
   ```

### Debugging Database Issues

1. **Check the connection.** The readiness probe includes a database check:
   ```bash
   curl http://localhost:3535/api/health/ready
   ```

2. **Inspect the database.** With the `devdb.compose.yml` overlay, from
   `infra/compose`:
   ```bash
   docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml \
     exec db psql -U postgres -d appdb
   ```
   ```sql
   \dt
   SELECT * FROM roles;
   SELECT * FROM permissions;
   ```
   Against your own PostgreSQL, use `psql` with the `POSTGRES_*` values from
   `.env`. For a GUI, run `npm run prisma:studio` in `apps/api`.

3. **See SQL queries.** With `NODE_ENV=development` (which `dev.compose.yml`
   sets), `PrismaService` logs every query and its duration at debug level.

### Debugging the API Process

- `npm run start:debug --workspace=api` starts Nest in watch mode with the
  Node inspector enabled.
- Every request gets an `X-Request-ID` from Nginx; search the logs for it to
  follow one request.
- `LOG_LEVEL` (default `info`) sets the Pino log level.

### Common Log Messages

| Message | Meaning |
|---------|---------|
| `Database connected` | Prisma connected at startup |
| `User logged out: user@example.com` | A logout succeeded |
| `Refresh token reuse detected for user: …` | A rotated refresh token was replayed; possible token theft |
| `CRITICAL: Default role "viewer" not found in database` | Seeds have not run |
| `Event bus adapter "in-process": live events reach this process only.` | `EVENT_BUS_ADAPTER` is unset or `in-process`; fine for one API replica |
| `Event bus listener is disconnected (…); reconnecting in …ms.` | The `postgres` bus lost its `LISTEN` session and is retrying with backoff; live events from other replicas are missed until it is back |

---

## Development Workflow

### Making Database Changes

The Prisma schema is a **generated folder**, `apps/api/prisma/schema/`
(committed; every file starts with `// GENERATED by platform db compose`). Never
edit a file in it. It is composed from two hand-edited sources:

| Source | Holds | Edit it for |
|---|---|---|
| `packages/platform-db/schema/<slice>.prisma` (and `base.prisma`) | The platform's models, one fragment per slice | A change to a platform model, enum or index |
| `apps/api/prisma/fragments/*.prisma` | The app's own models and `extend model` blocks | A new app model, or a back-relation to a platform model |

1. Edit the fragment that owns the model. A new model that points at `User`,
   `Job` or `StorageObject` adds an `extend model User { workouts Workout[] }`
   block beside it (see
   [`apps/api/prisma/fragments/README.md`](../apps/api/prisma/fragments/README.md)).
2. Compose the schema (the packages must be built once, `npm run build:packages`,
   because the `platform` command runs the built package):
   ```bash
   npm run db:compose --workspace=api
   ```
   A rejected fragment prints `file:line: CODE: message` and writes nothing.
3. Regenerate the Prisma client:
   ```bash
   npm run prisma:generate
   ```
4. Create the migration with `prisma:migrate:dev` (from `apps/api`, or inside
   the container). Use `--create-only` to read the SQL before applying it; a
   change to a platform model is a new migration in the app's history until
   package migrations are installed by `platform db sync`:
   ```bash
   npm run prisma:migrate:dev -- --name descriptive_name
   docker compose exec api npm run prisma:migrate:dev -- --name descriptive_name
   ```
5. If the change needs seed data: roles, permissions and settings defaults are
   not seed data you write, they come from the registries (declare them beside
   their modules: see
   [common/permissions/README.md](../apps/api/src/common/permissions/README.md),
   then run `npm run catalog:permissions --workspace=api` and
   `npm run catalog:settings --workspace=api`). Rows of your own go in
   `prisma/seed-app.ts` (see [Seeding the Database](#seeding-the-database)).
   Then run `npm run prisma:seed`.

`npm run db:compose:check --workspace=api` (CI, in the `build` job) fails when
`prisma/schema/` differs from a fresh compose: either a fragment changed
without re-composing, or a generated file was edited by hand. Re-run
`db:compose` and commit the result. Raw-SQL partial unique indexes stay in the
migration SQL, never as `@@unique` in a fragment ([CLAUDE.md](../CLAUDE.md),
"Invariants that are easy to break").

The project configures the database with individual `POSTGRES_*` variables,
never a single `DATABASE_URL`. The `prisma:*` scripts build the URL for you.

Three commands guard the migration history; CI's `smoke` job runs them after
`prisma:migrate`:

```bash
cd apps/api
npm run db:check            # platform.lock vs the files and the package (offline)
npm run db:check:database   # _prisma_migrations checksums vs the files (needs the database)
npm run db:drift            # migrations replayed in a shadow database must equal the schema
```

`db:drift` fails when the schema was edited without a migration and prints the
missing SQL. It needs a role that may create databases (it makes and drops
`<database>_drift_shadow_<pid>`), or `SHADOW_DATABASE_URL` pointing at an empty
one.

### Authoring a platform migration

A migration that belongs to the platform (a table or column of a package-owned
model) is authored in the app, then **promoted** into `@marinoscar/platform-db`.
An app's own migration is not promoted: it is an ordinary
`prisma migrate dev` migration and stays in the app. Design:
[ADR 0002 D3](adr/0002-database-packaging-and-rls.md#d3-migration-install-naming-and-platformlock-the-contract-for-710).

1. Edit the schema fragment of the owning slice in `packages/platform-db/schema/`
   and recompose the app schema (`npm run db:compose` once the composer
   lands; until then edit `apps/api/prisma/schema.prisma`).
2. Generate the SQL without applying it, from `apps/api`:
   ```bash
   npm run prisma:migrate:dev -- --create-only --name add_orgs
   ```
   Review the SQL. Prisma writes it into `prisma/migrations/<timestamp>_add_orgs/`.
   For a partial or expression index, hand-write it here and add it to
   `packages/platform-db/raw-sql-indexes.json` (`name`, `table`, `unique`,
   `definition` as `pg_indexes.indexdef` prints it, `reason`, `doc`, and
   `createdIn`, the platform id the promote will assign). The tripwire
   (`packages/platform-db/test/raw-sql-indexes.spec.ts`, and
   `runDbConformance()` in the app) fails on an unlisted partial or expression
   index.
3. Promote it (from `apps/api`; `--id` is the package slug, the sequence
   number is assigned):
   ```bash
   npm run db:promote -- 20261107120000_add_orgs --id add_orgs --slice identity
   ```
   This copies the bytes into `packages/platform-db/migrations/NNNN_add_orgs/`,
   appends the manifest entry (sha256, `since` = the next minor version unless
   `--since` is given) and records it in `apps/api/prisma/platform.lock`
   against the **same** local directory. The app keeps the directory Prisma
   created and never re-applies it. Running `promote` again is a no-op.
4. Apply it (`npm run prisma:migrate:dev` or `prisma:migrate`), then run
   `npm run db:check` and `npm run db:drift`.
5. Commit **both** trees together: `packages/platform-db/migrations/**` and
   `apps/api/prisma/**` (including `platform.lock`). Add a changeset for
   `@marinoscar/platform-db`.

Other apps receive it with `npm run db:sync` after a version bump: the command
byte-copies every package migration missing from `platform.lock` into
`prisma/migrations` under a new timestamp that sorts after everything already
there, then you run `npm run prisma:migrate` as usual. The API still does not
migrate on startup.

**Rules** the tooling enforces or relies on:

- **A migration that enables row-level security** is promoted with `--rls` (the manifest flag; a partial `platform db baseline` stops before it unless given `--allow-rls`), its policies go in `packages/platform-db/rls-policies.json`, and `--touches` names any other slice whose tables it changes.
- **Forward-only**: no down migrations.
- **Immutable once released**: `npm run db:check` fails on any byte change, a
  comment or a line ending included. Fix a mistake with a new migration.
  `migration.sql` files are marked `-text` in `.gitattributes` so Git never
  rewrites them.
- **Expand/contract** for breaking changes: add, move readers and writers, then
  remove in a later release.
- **Big-table index changes use `CREATE INDEX CONCURRENTLY`, in a migration of
  their own.** Prisma wraps a migration in a transaction unless it holds only
  statements that cannot run in one, and `CONCURRENTLY` cannot. Keep that
  migration to the single `CREATE INDEX CONCURRENTLY IF NOT EXISTS` statement.
- **One open pull request labelled `pp:migration` at a time.** A second one
  waits, then rebases onto the first, deletes its local directory, and re-runs
  `migrate dev --create-only` and `promote`, so its directory gets a newer
  timestamp than the first one's. Two migrations promoted in parallel would
  otherwise claim the same package sequence number.

### Adding New API Endpoints

1. Define request and response DTOs with Zod (`createZodDto`).
2. Add the controller method with `@Auth({ permissions: [...] })` (or
   `@Public()`).
3. Put the business logic in a service.
4. Add OpenAPI decorators (`@ApiOperation`, `@ApiResponse`); see
   [API.md § How the document is built](API.md#how-the-document-is-built).
5. Write unit and integration tests.
6. Check the result at `/api/docs`, then `npm run openapi:dump` and
   `npm run openapi:lint`.

Anything that outlives the request must be a queue job; see
[the job queue spec](specs/job-queue.md) and
[`apps/api/src/jobs/handlers/README.md`](../apps/api/src/jobs/handlers/README.md).

### Adding New Guards

1. Create the guard in `apps/api/src/auth/guards/`.
2. Implement `canActivate()`.
3. Register it in its module, or apply it with `@UseGuards()`.
4. Add tests for the guard logic.
5. Document the behaviour in
   [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md).

---

## Platform packages

The platform is being extracted into six layer packages under `packages/`
([platform packages spec](specs/platform-packages.md)). They are npm
workspaces like the apps, published as `@marinoscar/platform-*`. Each one has
its own README (see [`docs/README.md`](README.md#developer-recipes-in-the-code)).

| Package | Format | Built with | Tests |
|---|---|---|---|
| `packages/platform-contract` | Dual CommonJS + ESM (`dist/cjs`, `dist/esm`) | `tsc` twice, then `scripts/write-dist-stubs.mjs` | Vitest |
| `packages/platform-api` | CommonJS | `tsc` (decorator metadata) | Jest + ts-jest |
| `packages/platform-web` | ESM, `sideEffects: false` | `tsc` | Vitest + jsdom |
| `packages/platform-db` | CommonJS | `tsc` | Vitest |
| `packages/platform-cli` | ESM, `sideEffects: false` | `tsc` | Vitest |
| `packages/platform-infra` | ESM, `sideEffects: false` | `tsc` | Vitest |

The formats follow the consumers: `apps/api` is CommonJS, `apps/web` and
`apps/cli` are ESM, and only the contract (Zod DTOs shared by api and web)
crosses runtimes, so only it is dual. Each half of the contract ships its own
declarations, so a CommonJS consumer on `moduleResolution: node16` does not
read ESM-format types.

**Why `tsc` for the API package.** Nest dependency injection reads the
`design:paramtypes` metadata that `emitDecoratorMetadata` emits. esbuild and
tsup do not emit it, and Nest then injects `undefined` without an error.
`packages/platform-api/test/index.spec.ts` compiles a decorated provider with
the package's build options and asserts the metadata is there. Never switch
an API-side package to esbuild, tsup or vitest.

**Commands** (from the repository root):

```bash
npm run build:packages       # all six, platform-contract first
npm run typecheck:packages
npm run lint:packages        # boundary lint, packages/platform-*/src only
npm run test:packages
npm run dev:packages         # one build, then tsc --watch per package
npm run docs:packages        # TypeDoc API reference per package (docs-api/, gitignored)
npm run check:package-docs   # docs:packages, then the README and catalog checker
```

`platform-db` also ships a `platform` command (`bin/platform.js`, linked by
`npm install`; it runs the built `dist/`, so build first): `platform db compose
[--check]` generates the Prisma schema folder from the platform and app
fragments ([Making Database Changes](#making-database-changes)). Its test suite
includes a fixture app (`packages/platform-db/test/fixtures/app-with-domain/`)
that is composed, validated, generated and type-checked with the real Prisma
CLI and `tsc`.

How to document a package or slice so `check:package-docs` passes is in
[PACKAGES.md](PACKAGES.md).

Run `dev:packages` in its own terminal alongside the app dev servers. CI
builds the packages right after `npm ci` in every job
(`.github/workflows/ci.yml`), and `.github/workflows/packages.yml` adds the
lint, the tests, a pack check (`scripts/check-package-pack.mjs`) and smoke
imports.

**Rules.**

- An app imports a package only through its `exports` map
  (`@marinoscar/platform-api`, later `@marinoscar/platform-api/<slice>`),
  never `src/`, `dist/` or a slice's `internal/` folder.
- A package never imports an app or `@app/shared`. A package that needs the
  product name takes it as an option.
- Single-instance libraries (`@nestjs/*`, `fastify`, `@prisma/client`, `zod`,
  `react`, `@mui/*`, `@emotion/*`) are `peerDependencies`, never
  `dependencies`. `package-lock.json` must keep exactly one copy of each;
  `npm run check:single-instance` enforces it (see
  [Single-instance dependencies](#single-instance-dependencies)).
- Every folder under `packages/platform-<pkg>/src/` is a slice. A slice
  imports another slice only when
  [`packages/platform-slices.json`](../packages/platform-slices.json) lists
  the edge, and only through that slice's `index.ts`. Adding a slice means
  appending it to that file. `eslint.config.mjs` enforces this (rule B) and
  the deep-import rule (rule A); `packages/platform-api/test/slice-graph.spec.ts`
  checks the graph is acyclic and matches the folders on disk.
- Do not add a platform package to `WORKSPACE_MANIFESTS` in
  `scripts/new-project.mjs`: a fork resetting its release must not renumber
  platform versions.
- A file under `infra/` that starts with `# GENERATED from
  @marinoscar/platform-infra` is sync output (today the two telemetry compose
  files and `infra/otel/otel-collector-config.yaml`). Edit the canonical copy
  in `packages/platform-infra/<slice>/`, then run `npm run build:packages &&
  npm run platform:infra:sync` and commit both; CI's `npm run
  platform:infra:sync -- --check` fails otherwise. App changes go into an
  app-owned overlay instead (`infra/otel/app-collector.yaml`, see
  [the telemetry runbook §2.4](runbooks/telemetry.md#24-add-your-own-collector-pipelines-app-overlay)).

**Changing a package while the Docker dev stack runs.** The apps consume the
packages' built `dist/` (each `exports` map points there), and
`dev.compose.yml` mounts only `apps/*/src` into the containers. The API and
web images build `@marinoscar/platform-api` and `@marinoscar/platform-web` in
their `deps` stage (#694, #696), so after editing anything under
`packages/platform-*/` rebuild the images that consume it:

```bash
cd infra/compose
docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml build api web
docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml up -d api web
```

Outside Docker, `npm run dev:packages` rebuilds `dist/` on save and the app
dev servers pick it up. No compose file changes for this.

**Host ports.** A packaged slice reaches app-owned capabilities only through
the host ports (#696): on the API, `definePlatformHost` (access decorators),
`AUDIT_SINK`, `SYSTEM_SETTINGS_STORE` and `PLATFORM_PRISMA`, bound once in
`apps/api/src/platform/`; on the web, `PlatformHostProvider`, bound once in
`apps/web/src/platform/platformHost.tsx`. See the core READMEs of
[platform-api](../packages/platform-api/src/core/README.md#host-ports) and
[platform-web](../packages/platform-web/src/core/README.md).

---

## Single-instance dependencies

Some libraries keep module-level state that every importer must share: Nest's
DI container and decorator metadata, React's hooks dispatcher, MUI and Emotion
theme context and style caches, Zod's classes, the OpenTelemetry global API,
and the platform packages' own module-level singletons. A second copy on disk
does not fail the install. It fails at run time, confusingly: "Nest can't
resolve dependencies", "Invalid hook call", a theme that silently does not
apply, a `ZodError` that fails `instanceof`. Declaring these libraries as
`peerDependencies` is necessary but not enough: a range mismatch between a
package and an app, an `overrides` entry, or `npm link` still installs a
second copy.

`scripts/check-single-instance.mjs` fails the build instead:

```bash
npm run check:single-instance                                 # lockfile + resolution (after npm ci)
node scripts/check-single-instance.mjs --lockfile-only        # no node_modules needed
node scripts/check-single-instance.mjs --lockfile-only --json # machine-readable report
```

1. **Lockfile check.** Every `package-lock.json` key `node_modules/<name>` or
   `.../node_modules/<name>` is an installed copy; more than one copy of a
   guarded name fails. A workspace link (`"link": true`) and the workspace it
   points at count as one copy.
2. **Resolution check.** From every workspace (the root `workspaces` globs),
   resolve `<name>/package.json` as Node does and `realpath` it; two
   workspaces resolving one name to different real directories fail. A
   workspace that does not use a library is skipped for it. A platform
   package resolved outside the repository (an `npm link`ed checkout) is
   checked as well, since it resolves its peers from its own `node_modules`.

It also checks an app outside this repository: `--root <dir>` on a project
with no `workspaces` resolves from that project's own root, and
`--guard <name>` (repeatable) adds the platform packages it installs to the
guarded list and checks them as origins. The consumer smoke
([TESTING.md](TESTING.md#consumer-smoke-packed-and-published-packages)) runs
it that way on every temporary consumer project. It is how the smoke found
that `fastify` must be an optional peer of `@marinoscar/platform-api`: as a
required peer, npm auto-installed a second fastify next to the exact version
`@nestjs/platform-fastify` pins.

Exit codes: 0 clean, 1 duplicates, 2 usage error (unknown flag, missing
lockfile, or no `node_modules` without `--lockfile-only`). The
`single-instance` job in `.github/workflows/packages.yml` runs it after
`npm ci` on every pull request.

**Guarded names** (`SINGLE_INSTANCE_PACKAGES` in the script):
`@nestjs/common`, `@nestjs/core`, `@nestjs/swagger`, `@nestjs/config`,
`fastify`, `@prisma/client`, `zod`, `nestjs-zod`, `reflect-metadata`,
`@opentelemetry/api`, `react`, `react-dom`, `react-router-dom`,
`@mui/material`, `@mui/system`, `@mui/icons-material`, `@mui/x-charts`,
`@emotion/react`, `@emotion/styled`, `ink`, plus every
`@marinoscar/platform-*` package, discovered from
`packages/platform-*/package.json`. A new platform package is guarded without
editing the script. A new library with module-level state goes in that
constant.

**Fixing a failure.** The report names each copy's location and version. For
a copy nested under a workspace (`apps/cli/node_modules/react`), align that
library's range in that workspace's `package.json` (for a platform package,
its `peerDependencies` and `devDependencies`) with the root copy, then run
`npm dedupe` (or `npm install`) and commit the regenerated
`package-lock.json`. For a copy nested under another dependency
(`node_modules/<dep>/node_modules/react`), that dependency asks for an
incompatible range: upgrade it or align the workspace range it conflicts
with. Do not silence the check with an `overrides` entry unless every
consumer genuinely works with the forced version.

**Why not `npm link`.** `npm link` symlinks a package's own checkout into the
app, and that checkout resolves its peers from its own `node_modules`, which
is exactly the second copy this check catches. To try unreleased platform
changes in an app from another repository, use `yalc` (publishes into a local
store and copies, so the app installs one tree), a `next` pre-release from
npm, or keep the platform and the app side by side as workspaces of one
checkout (see the cross-repo development loop in the
[platform packages spec](specs/platform-packages.md)).

### Adding a changeset

The six packages are versioned together with Changesets (one "fixed" group)
and released by `.github/workflows/release.yml`; the procedure is
[runbooks/release-platform-packages.md](runbooks/release-platform-packages.md).

- **When.** Every pull request that changes a file under
  `packages/platform-*/` adds a changeset. The `changeset-check` job in
  `.github/workflows/packages.yml` fails it otherwise. App-only, docs-only and
  infrastructure-only pull requests need none.
- **How.** `npx changeset` from the repository root: pick the packages, the
  bump and a one-line summary written for the people upgrading an app. Commit
  the generated `.changeset/*.md` with the change.
- **No release impact.** For tests or an internal refactor that changes no
  behaviour, record that with `npx changeset --empty`.
- **Choosing the bump.** The extension surface (everything a package exports:
  `forRoot()` options, registries, injection tokens, events, slots, theme
  tokens, models, migrations, CLI commands) is the contract. `patch` fixes
  behaviour without changing it; `minor` adds to it; `major` is anything an
  app built on the previous version would have to change for: a removed or
  renamed export, a narrowed type, a changed default, a migration an app must
  act on. A `major` changeset carries a migration note in its body (what
  breaks, what to change, an example), which becomes the upgrade notes in each
  package's `CHANGELOG.md`.
- **Versions are never edited by hand.** The Version Packages pull request
  sets them, in lockstep. While `.changeset/pre.json` exists every release is
  `x.y.z-next.N` on the `next` dist-tag.

---

## Performance Considerations

- Avoid `@Res()` when you can; it bypasses the interceptors.
- Use Prisma `select` to fetch only the fields you need, and keep `include`
  shallow.
- Add `@@index` in the model's fragment (`packages/platform-db/schema/` or
  `apps/api/prisma/fragments/`) for new filter patterns, then `npm run db:compose`.

---

## Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [Fastify Documentation](https://fastify.dev/)
- [Prisma Documentation](https://www.prisma.io/docs/)
- [Passport.js Documentation](https://www.passportjs.org/)
- [Architecture](ARCHITECTURE.md)
- [Security Architecture](SECURITY-ARCHITECTURE.md)
- [Testing](TESTING.md)
- [API conventions](API.md)
