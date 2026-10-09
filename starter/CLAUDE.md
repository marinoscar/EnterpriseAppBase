# CLAUDE.md

Rules for AI assistants working on this app. Start at [README.md](README.md).

## What this repository is

An app on the published `@marinoscar/platform-*` packages, started from the platform starter. Stack: React 19 + MUI (web), NestJS 11 on Fastify + Prisma 7 + zod (API), PostgreSQL 16, the platform CLI, nginx same-origin, Docker Compose, Node 24.

## MANDATORY: never edit platform code here

The platform lives in `node_modules/@marinoscar/platform-*`. Never edit, patch, copy or vendor it, and never add `patch-package`, `npm link` or a `file:`/`workspace:` dependency on it: an app that edits its copy drifts from every other app, and `npm link` breaks the single-instance packages (Nest, React, MUI, zod). **Change it in the platform repository instead:** when a seam is missing, file a seam request with the platform's template (`https://github.com/marinoscar/EnterpriseAppBase/issues/new?template=seam_request.yml`), and work around it in this app's own code until the release that adds it.

Generated files are never hand-edited either: `apps/api/prisma/schema/` (`npm run db:compose`), the installed platform migrations recorded in `apps/api/prisma/platform.lock` (`npm run db:sync`), and the platform files under `infra/` recorded in `infra/platform-infra.lock.json` (`npm run platform:infra:sync`). `npm run platform:check` fails on any edit. Your own changes to the stack are overlays: `infra/compose/app.*.compose.yml`, `infra/compose/app.env.example`, `infra/nginx/app.d/`.

## Where things are

| What | Where |
|---|---|
| The platform's composition (every `forRoot()`, the host-port adapters, the seeded permissions) | `apps/api/src/platform/` |
| Which optional platform slices are mounted (storage, email, notifications, sharing, AI, backup, exports, onboarding, Android) | `packages/shared/slices.json` `enabled` (read by the API and the web app); a slice is `apps/api/src/platform/<id>/` plus `apps/web/src/slices/<id>.tsx`; README, "Optional slices" |
| The sample feature (model, permission, settings namespace, job, Doctor check) | `apps/api/src/notes/`, `apps/api/prisma/fragments/notes.prisma` |
| The routes and the two settings registries | `apps/web/src/App.tsx`, `apps/web/src/config/` (the core's cards; an optional slice's cards and routes are in `apps/web/src/slices/<id>.tsx`) |
| The CLI composition | `apps/cli/src/app.ts` |
| The identity (name, repository, CLI name, colours) | `packages/shared/identity.json`; rename with `scripts/rename.mjs` |
| Each package's documentation and extension-point catalog | [platform-api](https://github.com/marinoscar/EnterpriseAppBase/tree/main/packages/platform-api/src) (one README per slice), [platform-web](https://github.com/marinoscar/EnterpriseAppBase/tree/main/packages/platform-web/src), [platform-contract](https://github.com/marinoscar/EnterpriseAppBase/tree/main/packages/platform-contract), [platform-db](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-db/README.md), [platform-cli](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-cli/README.md), [platform-infra](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-infra/README.md) |

## Delegation

When specialised agents are configured (`.claude/agents/`), delegate by domain: backend code to the backend agent, frontend to the frontend agent, Prisma schema and migrations to the database agent, tests to the testing agent, documentation to the docs agent. Multi-domain work runs them in sequence: database, backend, frontend, testing, docs.

## Platform invariants this app must still respect

The packages enforce these in their own code; your code must not undo them. `apps/api/test/conformance.spec.ts` (`runPlatformConformance()`) checks the first, third and fourth on every `npm test`.

1. **Every long-running activity is a queue job.** Anything that outlives the request or cron tick that started it is a registered `JobHandler` enqueued through `JobsService`. A `@Cron` only decides whether work is due and enqueues it (`enqueueHousekeepingJob`); a detached `void this.work()` or an `@OnEvent` that does I/O is a violation. A job declares `profile: { maxRuntimeMs, maxAttempts }` or takes the default. A job `type` string is permanent once jobs of it exist.
2. **AI.** Never import a provider SDK, never call AI from the browser, and never broker a key to a worker node: use the AI slice's `AiService.forUser(...)` server-side. AI jobs are server-only.
3. **Settings UI Pattern.** Every settings page is a card APPENDED to `apps/web/src/config/adminSections.tsx` or `userSettingsSections.tsx` (an optional slice declares its cards in `apps/web/src/slices/<id>.tsx`, composed into them, the Danger Zone staying last), rendered by the packaged `SettingsHub`; its `permission` is the exact string the API route enforces; a settings page is never a new tab on another page.
4. **Security by default.** Every route declares `@Auth()` (or a deliberate `@Public()`): there is no global guard. Validate every input with zod. A model with a foreign key to `User` is registered in the user-owned data registry with its purge and export policy, and read through `PrismaService.forUser(...)`.
5. **`notify()` after the commit.** A notification is sent after the triggering write commits, outside any `$transaction`.
6. **Environment variables.** Deployment secrets only (`infra/compose/.env.example` is generated: an app variable goes in `infra/compose/app.env.example`, then `npm run platform:infra:sync`). Storage, AI, SMTP and Web Push are configured at runtime in the admin UI and never get an environment variable. **Never add a commented `# KEY=value` line** to an `.env.example`: the CLI's env parser reads it as a declared variable and its conformance test fails.
7. **Migrations.** The platform's migrations are installed by `npm run db:sync` and never edited; yours are authored with `npm run prisma:migrate:dev` after them. The API never migrates on startup.

## Commits

Conventional Commits (`<type>(<scope>): <summary>`), small and single-purpose, a behaviour change with its tests.
