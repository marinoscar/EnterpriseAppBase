<!-- The title and the sentence below the badge are the product's identity.
     `node scripts/rename.mjs --name "..."` rewrites both, together with the
     identity strings no runtime read can reach. See docs/RENAMING.md.

     If the title below still reads like a placeholder, this fork has not been
     renamed yet. -->

# My App

[![CI](https://github.com/marinoscar/EnterpriseAppBase/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/marinoscar/EnterpriseAppBase/actions/workflows/ci.yml)

A production-grade full-stack application foundation built with React, NestJS, and PostgreSQL. Features OAuth authentication, role-based access control, and comprehensive observability.

This repository is a **template**. You fork it, rename it, and build your own
product on top. It is not meant to be deployed as-is.

## What you get

A React + MUI web app, a NestJS (Fastify) API, PostgreSQL through Prisma, and
Nginx serving both from one origin: the UI at `/`, the API at `/api`, and the
interactive API reference (Scalar) at `/api/docs`. On top of that stack:

| Subsystem | What it gives you | Where to read more | Admin UI route |
|---|---|---|---|
| Sign-in and allowlist | Google OAuth, 15-minute JWT access tokens, rotating refresh cookie, email allowlist | [Security architecture](docs/SECURITY-ARCHITECTURE.md) | `/admin/settings/users` (Users, Allowlist tabs) |
| RBAC | Admin, Contributor and Viewer roles over 28 permissions, enforced server-side | [Security architecture](docs/SECURITY-ARCHITECTURE.md), matrix in [Architecture](docs/ARCHITECTURE.md) | `/admin/settings/users` |
| **`appctl` CLI** | One command-line client: `login`, a generic `api <method> <path>`, `deploy` to a VPS, and `node` to run a worker | [CLI README](apps/cli/README.md), [deploy spec](docs/specs/vps-deploy.md) | none |
| Device authorization | RFC 8628 login for the CLI and other devices; can mint a PAT | [Device auth guide](docs/DEVICE-AUTH.md) | `/activate` |
| Personal access tokens | Long-lived `pat_` bearer tokens for scripts and CI | [PAT guide](docs/personal-access-tokens.md) | `/settings/tokens` |
| Settings framework | Registry-driven hubs at `/settings` and `/admin/settings`; JSONB system and user settings | [Settings UI spec](docs/specs/settings-ui.md) | `/admin/settings`; user `/settings` |
| Object storage | S3, Cloudflare R2 or S3-compatible, configured at runtime; resumable uploads, profile images | [Spec](docs/specs/storage-providers.md), [runbook](docs/runbooks/storage-configuration.md) | `/admin/settings/storage` |
| Background job queue | Postgres-backed queue with leases, retries, dedup and throughput insights | [Spec](docs/specs/job-queue.md), [handler recipe](packages/platform-api/src/jobs/handlers/README.md) | `/admin/settings/jobs`, `/admin/settings/jobs/insights` |
| Worker nodes | Remote machines that claim node-eligible jobs, with `nod_` credentials and per-job secrets | [Spec](docs/specs/worker-nodes.md), [guide](docs/runbooks/run-worker-nodes.md), [secrets runbook](docs/runbooks/node-job-secrets.md) | `/admin/settings/workers` |
| **AI platform** | Admin-governed, bring-your-own-key AI over OpenAI, Anthropic, Gemini, Azure OpenAI and OpenAI-compatible servers: responses, streaming, structured output, tools, embeddings, images, audio, realtime, background runs, usage reports, and an admin-only AI Playground at `/ai` | [Spec](docs/specs/ai-platform.md), [module README](packages/platform-api/src/ai/README.md), [runbook](docs/runbooks/ai-configuration.md) | `/admin/settings/ai`, `/admin/settings/ai/models`, `/admin/settings/ai/usage`; user `/settings/ai` |
| Notifications | Event registry, email (SMTP), in-app and browser Web Push channels, per-user preferences | [Spec](docs/specs/browser-notifications.md), [VAPID runbook](docs/runbooks/vapid-keys.md) | `/admin/settings/notifications`, `/admin/settings/email`, `/admin/settings/push`; user `/settings/notifications` |
| Admin broadcasts | Message every active user, now or scheduled, fanned out through the job queue | [Spec](docs/specs/notification-broadcasts.md) | `/admin/settings/broadcasts` |
| Database backup and restore | `pg_dump` streamed to object storage on a schedule or on demand; restore and rollback | [Backup spec](docs/specs/database-backup.md), [restore spec](docs/specs/database-restore.md), [restore runbook](docs/runbooks/database-restore.md) | `/admin/settings/db-backup` |
| Maintenance mode | A 503 window with an operator message, plus a `MAINTENANCE_MODE` break-glass | [Spec](docs/specs/maintenance-mode.md), [runbook](docs/runbooks/maintenance-mode.md) | `/admin/settings/maintenance` |
| About / deployment info | Version, commit and deploy history of the running server | [Runbook](docs/runbooks/deployment-info.md) | `/admin/settings/about` |
| Doctor | Read-only configuration and health checks for every capability, each with a remedy and the page that fixes it | [Spec](docs/specs/doctor.md), [runbook](docs/runbooks/doctor.md) | `/admin/settings/doctor` |
| Encrypted credentials | Secrets (SMTP, VAPID, storage, AI keys) encrypted at rest under `SECRETS_ENCRYPTION_KEY`, plus per-user credentials | [Spec](docs/specs/user-credentials.md), [key rotation](docs/runbooks/rotate-secrets-encryption-key.md) | none |
| Observability | OpenTelemetry traces, metrics and logs, Pino JSON logs, optional GreptimeDB-backed telemetry stack with a health dashboard, a SQL explorer and an AI assistant | [Spec](docs/specs/telemetry.md), [runbook](docs/runbooks/telemetry.md) | `/admin/settings/telemetry` |
| Template tooling | `starter/` and `scripts/new-project.mjs create` (a new app on the published packages), `scripts/rename.mjs`, the `/rename-app` and `/new-project` agent skills | [Renaming guide](docs/RENAMING.md) | none |
| Testing | Jest + Supertest (API), real-Postgres suites, Vitest + RTL (web and CLI), Playwright e2e with visual baselines | [Testing guide](docs/TESTING.md) | none |

## Start a new app from this template

**A new product starts from the starter**, not from a fork. `starter/` is a
small app that depends on the published `@marinoscar/platform-*` packages and
keeps only its composition, its domain code and its appearance:

```bash
npm ci && npm run build:packages
node scripts/new-project.mjs create --dir ../your-product --name "Your Product" --repo you/your-product \
  [--cli yourctl] [--theme '#7c3aed'] [--license mit --holder "Your Name"] [--dry-run]
cd ../your-product && npm install && npm run setup
```

`create` copies the starter, sets its identity (`packages/shared/identity.json`
plus the few literal targets) with the copy's own `scripts/rename.mjs`, renders
`infra/`, writes the licence, resets the changelog and versions, and runs
`git init` without committing. The new app's README walks through running it
and adding a first feature from the package documentation. Full guide:
[docs/RENAMING.md](docs/RENAMING.md#starting-a-whole-new-project); in Claude
Code, the `/new-project` skill.

### For an existing fork of this template

The steps below bootstrap a fork of the whole repository (the platform's source
included). Existing forks keep using them until they adopt the packages.

1. **Fork and clone** your copy:

   ```bash
   git clone <your-fork-url>
   cd EnterpriseAppBase
   ```

2. **Rename it.** One command rewrites the product name, repository slug and
   brand colour everywhere they cannot be derived at runtime. In Claude Code,
   the `/rename-app` skill does the same with its checkpoints.

   ```bash
   node scripts/rename.mjs --name "Your Product" --repo you/your-repo --theme '#7c3aed'
   ```

3. **Install and generate a local environment.** `npm run setup` builds the CLI
   and runs `appctl init`, which writes `infra/compose/.env`. It generates
   `JWT_SECRET`, `COOKIE_SECRET` and `SECRETS_ENCRYPTION_KEY` for you and asks
   for the rest.

   ```bash
   npm install
   npm run setup
   ```

   You must supply three things nothing can generate:
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Create OAuth 2.0
     credentials in the [Google Cloud Console](https://console.cloud.google.com)
     with the redirect URI `http://localhost:3535/api/auth/google/callback`.
     The API does not start without them.
   - `INITIAL_ADMIN_EMAIL`. The first login with this address becomes Admin.
     Without it nobody can log in.
   - A PostgreSQL 16 to talk to (next step).

4. **Create the shared Docker network**, once per machine:

   ```bash
   docker network create devnet
   ```

5. **Start the stack** from `infra/compose`. `base.compose.yml` has no
   database; the `devdb.compose.yml` overlay adds one for development.

   ```bash
   cd infra/compose
   docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml up -d
   ```

   With the devdb overlay, `.env` must say `POSTGRES_HOST=db` (the default
   `appctl init` offers). Running your own Postgres 16 instead? Leave the
   overlay out and point the `POSTGRES_*` variables at it.

6. **Migrate and seed.** The API does not migrate on startup. Pass the same
   `-f` files you started with:

   ```bash
   docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml exec api npm run prisma:migrate
   docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml exec api npm run prisma:seed
   ```

   Always use the `npm run prisma:*` scripts. They build `DATABASE_URL` from
   the `POSTGRES_*` variables; bare `npx prisma` does not.

7. **Log in.** Open http://localhost:3535 and sign in with Google as
   `INITIAL_ADMIN_EMAIL`. Everyone else needs an allowlist entry first
   (`/admin/settings/users`, Allowlist tab) and starts as Viewer.

8. **Reset what a fork inherits** (changelog, versions, licence):

   ```bash
   node scripts/new-project.mjs --reset-release
   node scripts/new-project.mjs --audit
   ```

   Add `--license mit --holder "Your Name"` to write a licence. The script
   keeps the template's own MIT notice as `LICENSE.platform` and writes yours
   as `LICENSE`. It refuses to run while `origin` still points at the
   template's repository, so rename and re-point the remote first.

The full walkthrough, including what the rename leaves alone and the manual
steps after it, is [docs/RENAMING.md](docs/RENAMING.md#starting-a-whole-new-project).
In Claude Code, the `/new-project` skill drives the same sequence.

## Prerequisites

- Node.js 24 (see `.nvmrc`; enforced by `engines`)
- Docker with Docker Compose
- PostgreSQL 16, either your own or the `devdb.compose.yml` overlay
- A Google Cloud project for OAuth 2.0 credentials

## Day-to-day

All `docker compose` commands run from `infra/compose`.

```bash
# Development with hot reload (API watch mode, Vite HMR)
docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml up

# Add the telemetry stack; GreptimeDB dashboard at http://localhost:14000/dashboard
docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml -f telemetry.compose.yml up
```

Tests, from the repository root:

```bash
npm test --workspace=api            # API unit + mocked integration (Jest)
npm run test:db --workspace=api     # API suites against a real PostgreSQL
npm run test:run --workspace=web    # Web (Vitest + RTL), single run
npm run test:run --workspace=cli    # CLI (Vitest), single run
npm run typecheck --workspace=api   # also: --workspace=web, --workspace=cli

cd tests/e2e && npm install && npx playwright install && npm test   # Playwright e2e
```

Database schema changes, from `apps/api`:

```bash
npm run prisma:migrate:dev -- --name add_widgets   # create and apply a migration
npm run prisma:generate                            # regenerate the Prisma client
```

API reference: http://localhost:3535/api/docs. Export it with
`npm run openapi:dump` and lint it with `npm run openapi:lint`. Fastify,
Passport and Prisma gotchas are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Repository layout

```
EnterpriseAppBase/
├── apps/
│   ├── api/                  # NestJS + Fastify API
│   │   ├── src/              # One folder per module (auth, jobs, ai, storage, ...)
│   │   ├── prisma/           # fragments/, schema/ (generated), migrations, seed
│   │   └── test/             # Jest integration and real-Postgres suites
│   ├── web/                  # React + MUI frontend (Vite)
│   └── cli/                  # appctl: login, api, deploy, node
├── packages/
│   ├── shared/               # Product identity (name, repo, colours) shared by all apps
│   └── platform-*/           # The published @marinoscar/platform-* packages
├── starter/                  # What `new-project.mjs create` copies; depends on published package versions
├── docs/
│   ├── specs/                # Design and rationale, one file per feature
│   └── runbooks/             # Operator procedures, including VPS deploy and worker nodes
├── infra/
│   ├── compose/              # base, dev, devdb, telemetry, prod, vps, vps.telemetry, test, worker, worker.build (*.compose.yml)
│   ├── nginx/                # Same-origin routing and CSP
│   └── otel/                 # OpenTelemetry Collector and GreptimeDB config
├── scripts/                  # rename.mjs, new-project.mjs, starter-smoke.mjs, dev.ps1, worktree.ps1
├── tests/e2e/                # Playwright end-to-end and visual tests
├── .claude/                  # Agent definitions (agents/) and skills (skills/)
└── CLAUDE.md                 # Rules for AI coding agents
```

## Documentation

Read in this order:

1. This README.
2. [docs/README.md](docs/README.md), the index of every document.
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), the subsystem map.
4. The spec in [docs/specs/](docs/specs/) for the feature you are touching.
5. Its runbook in [docs/runbooks/](docs/runbooks/), if it has one.

Using the application: [docs/ADMIN-GUIDE.md](docs/ADMIN-GUIDE.md), a tour of
what an administrator or user can do, with the route and permission of each
feature. Moving an existing app onto the packages:
[docs/ADOPTING-THE-PLATFORM.md](docs/ADOPTING-THE-PLATFORM.md).

Choosing what to use: [docs/SLICES.md](docs/SLICES.md), one generated page
with every platform slice, the packages and imports that carry it, its cards,
permissions, dependencies and peers, and whether it works on its own.

Extending a slice from your own app or from a package it installs:
[docs/EXTENDING.md](docs/EXTENDING.md), the ladder of extension mechanisms and a
recipe per extension; [docs/EXTENSIBILITY-AUDIT.md](docs/EXTENSIBILITY-AUDIT.md),
what each slice still closes and the story that opens it.

The CLI has its own reference: [apps/cli/README.md](apps/cli/README.md).
Coding agents follow [CLAUDE.md](CLAUDE.md).

## Deploying

- **VPS:** run `appctl deploy install` on the server. See
  [docs/runbooks/deploy-to-vps.md](docs/runbooks/deploy-to-vps.md).
- **Worker nodes:** run jobs on other machines with `appctl node`. See
  [docs/runbooks/run-worker-nodes.md](docs/runbooks/run-worker-nodes.md).

## Troubleshooting

**"Database seed data missing: Role ..." at first login** (the API log says `Default role "viewer" not found in database`).
The seed has not run. Run step 6 above.

**"You don't have access yet" screen after signing in.**
The address is not on the allowlist. The first admin must match
`INITIAL_ADMIN_EMAIL` exactly (restart the API after changing `.env`, then
re-run the seed). Anyone else needs an admin to add them at
`/admin/settings/users` (Allowlist tab).

**OAuth redirect fails.**
`GOOGLE_CALLBACK_URL` in `.env` must match the redirect URI registered in the
Google Cloud Console exactly. Check the API logs (`docker compose ... logs -f api`,
with the same `-f` files you started with).

**The API cannot reach the database.**
With the devdb overlay, `.env` needs `POSTGRES_HOST=db`. Without it, the
`POSTGRES_*` values must point at a PostgreSQL the API container can reach.
Check that the containers are up (`docker compose ... ps`), then restart the API.

More debugging tips: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## License

MIT — see [LICENSE](LICENSE).

To report a vulnerability, follow [SECURITY.md](SECURITY.md).
