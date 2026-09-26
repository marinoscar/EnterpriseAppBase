# CLAUDE.md

This file provides guidance for AI assistants working on this codebase.

## Project Overview

Web Application Foundation with React UI + Node API + PostgreSQL. Production-grade foundation with OAuth authentication, RBAC authorization, and flexible settings framework.

## Technology Stack

- **Backend**: Node.js + TypeScript, NestJS with Fastify adapter
- **Frontend**: React + TypeScript, Material UI (MUI)
- **CLI**: TypeScript, Commander (subcommands) + ink (interactive menu)
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: Passport strategies (Google OAuth required)
- **Testing**: Jest + Supertest (backend), React Testing Library + Vitest (frontend), Vitest (CLI)
- **Observability**: OpenTelemetry, Uptrace, Pino structured logging
- **Containerization**: Docker + Docker Compose
- **Reverse Proxy**: Nginx (same-origin routing)

## Repository Structure

```
/
  apps/
    api/                    # Backend API
      src/
      test/
      prisma/
        schema.prisma
        migrations/
      Dockerfile            # API container (near its code)
    web/                    # Frontend React app
      src/
      src/__tests__/
      Dockerfile            # Web container (near its code)
    cli/                    # First-party command-line client (`appctl`)
      src/
        commands/           # `login`, `api`, `config` subcommands
        tui/                # Interactive ink menu (real terminals only)
      README.md             # CLI usage, install, CI setup
  docs/                     # Documentation
  infra/                    # Infrastructure configuration
    compose/
      base.compose.yml       # Core services: api, web, nginx
      dev.compose.yml        # Development overrides (hot reload, volumes)
      prod.compose.yml       # Production overrides (resource limits)
      otel.compose.yml       # Observability: uptrace, clickhouse, otel-collector
      .env.example           # Environment variables template
    nginx/
      nginx.conf             # Nginx routing configuration
    otel/
      otel-collector-config.yaml   # OTEL Collector config
      uptrace.yml            # Uptrace configuration
  tests/e2e/                # Optional E2E tests
```

## MANDATORY: Issue-Driven Development (Traceability)

Every feature and bug fix MUST be tracked by a GitHub issue, filed **before** implementation planning is finalized (for features) or the fix starts (for bugs). This applies before any worktree or branch is created — traceability starts at the issue, not the code. Running `gh issue create` from inside the repo infers the target repository from the git remote automatically, so no repo owner/URL needs to be specified.

- **New feature**: Before finalizing an implementation plan, create (or confirm an existing) issue with `gh issue create --template feature_request.yml`. Fill in the real problem statement, proposed solution, affected component, and priority — not placeholder text.
- **Larger initiative**: If the work will span multiple features or sessions, file an Epic instead with `gh issue create --template epic.yml`. Child feature issues must reference the epic number in their body or task list.
- **Bug fix**: Before starting the fix, create (or confirm an existing) issue with `gh issue create --template bug_report.yml`. Fill in the description, reproduction steps, expected vs. actual behavior, component, and environment/logs if known. Do not file a duplicate if one already exists for the same bug — reuse it.
- **Link the work**: Reference the issue number in commit messages and/or the PR description (`Fixes #123` / `Relates to #123`), per the `.github/pull_request_template.md` convention.
- **Keep it current**: Update or close the issue as the corresponding PR resolves it, so issue state reflects real progress.
- **Scope**: This applies to feature and bug work specifically. Routine `chore`/`docs`/`refactor` commits don't each need their own tracking issue.

## MANDATORY: Worktree-Based Feature Development

Every feature or fix MUST be developed in a Git worktree. The main checkout stays on `main` at all times.

### Worktree Location & Naming
- All worktrees live under `worktrees/` in the repo root (git-ignored, never committed)
- Use **flat short names**: `worktrees/<short-name>` (e.g., `worktrees/add-export`, `worktrees/fix-auth-bug`)
- The branch name follows conventional format: `feat/<short-name>`, `fix/<short-name>`, etc.

### Workflow (Claude MUST follow)

**Starting feature work:**
0. Ensure a tracking issue exists, per [MANDATORY: Issue-Driven Development (Traceability)](#mandatory-issue-driven-development-traceability) above.
1. From the main checkout, create the worktree:
   ```bash
   git worktree add worktrees/<short-name> -b <type>/<short-name>
   ```
   Example: `git worktree add worktrees/add-export -b feat/add-export`
2. All development happens inside `worktrees/<short-name>/`
3. Commits follow all existing commit rules (see below)

**Finishing feature work:**
1. Ensure all changes are committed inside the worktree
2. Remove the worktree:
   ```bash
   git worktree remove worktrees/<short-name>
   ```
3. The branch remains for PR/merge

### Rules
- NEVER checkout feature branches in the main working directory
- NEVER work on features directly in the main checkout
- One worktree per feature branch (Git enforces this)
- If the worktree already exists for the requested feature, work inside it (don't recreate)

## MANDATORY: Claude Commit-Only Git Rules

Claude: these rules are **MANDATORY**. Follow them exactly.  
Your job is **only** to create clean, frequent commits while implementing the requested work.  
Assume the branch already exists and is checked out. Do **not** create branches or PRs.

---

### Core Commit Rules (MANDATORY)
1. **Commit early, commit often.** Do not leave large uncommitted change sets.
2. Each commit must be **small, coherent, and reviewable**.
3. **One intent per commit** (no “misc fixes” bundles).
4. **Do not include unrelated refactors** unless explicitly requested.
5. If you change behavior, you must add/adjust tests in the same commit or the next immediate commit.

---

### Commit Message Standard (MANDATORY: Conventional Commits)
Use this format:

`<type>(<scope>): <short imperative summary>`

Allowed types:
- `feat:` new functionality
- `fix:` bug fix
- `refactor:` internal change, no behavior change
- `test:` add/adjust tests only
- `docs:` documentation only
- `chore:` tooling, deps, formatting, build, CI

Scopes (pick one relevant area):
- `api`, `web`, `cli`, `db`, `infra`, `auth`, `chat`, `ui`, `core`, `jobs`, `docs`, `tests`

Examples:
- `feat(chat): add permit search prompt builder`
- `fix(api): handle missing location gracefully`
- `test(api): cover permit filter edge cases`
- `chore(web): run formatter`

---

### Commit Cadence (MANDATORY)
Make commits at these checkpoints:

1) **Scaffold / wiring**
- New files, routes, handlers, basic plumbing (even if incomplete).
- Example: `feat(api): scaffold permit lookup endpoint`

2) **Core functionality**
- Implement the smallest working slice end-to-end.
- Example: `feat(core): implement permit filtering by location radius`

3) **Edge cases + validation**
- Input validation, error handling, fallback behavior.
- Example: `fix(api): validate lat/lng inputs and return 400`

4) **Tests**
- Unit/integration tests for the new behavior and critical edge cases.
- Example: `test(api): add coverage for location filter and empty results`

5) **Cleanup**
- Remove dead code, rename for clarity, small refactors strictly related to the change.
- Example: `refactor(core): extract permit query builder`

6) **Docs (if needed)**
- Only if the task requires it.
- Example: `docs(api): document permit endpoint parameters`

---

### What to Include / Exclude (MANDATORY)
#### Include
- Code + tests for the same feature area
- Minimal config changes needed to run/build/test
- Small, related refactors that reduce complexity for the feature

#### Exclude
- Repo-wide formatting changes unless required
- Dependency upgrades unless required
- Unrelated cleanup in neighboring modules

---

### Commit Command Sequence (MANDATORY)
Before committing:
1. `git status`
2. `git diff`
3. Stage intentionally:
   - `git add -p` (preferred) or `git add <files>`

Commit:
- `git commit -m "<type>(<scope>): <summary>"`

After commit:
- `git status`

Repeat until the next checkpoint is complete, then commit again.

---

### Handling Mixed Changes (MANDATORY)
If you accidentally made unrelated edits:
- Revert them before committing, or
- Split into separate commits (preferred). Only keep the unrelated commit if explicitly requested.

---

### If Tests Cannot Be Run (MANDATORY)
If you cannot run tests for a valid reason (missing env, tool not available):
- Still commit, but include a clear note in the commit body.

Example:
- Subject: `feat(api): implement permit search by address`
- Body: `Notes: tests not run (DB env not available).`

---

### Golden Rule (MANDATORY)
If the diff feels “big,” you waited too long. **Split the work and commit sooner.**

## MANDATORY: Settings UI Pattern

Every settings surface in this app — admin or per-user — is a **registry-driven
hub**, not a tab strip and not an ungoverned route. This was established by
epic #90 (issues #91–#96) and is documented in full, with rationale and
rejected alternatives, in [`docs/specs/settings-ui.md`](docs/specs/settings-ui.md).
This section states the rules; that file explains why.

### Core Rules (MANDATORY)

1. **Every new settings page MUST be declared in a section registry.**
   Admin cards go in `apps/web/src/config/adminSections.tsx`
   (`ADMIN_SECTIONS`); per-user cards go in
   `apps/web/src/config/userSettingsSections.tsx` (`USER_SETTINGS_SECTIONS`).
   A route added without a registry entry is not acceptable — it is a route
   the hub, the Console rail, and the AppBar title resolver all disagree
   about, because none of the three has any way to know it exists.

2. **A settings page MUST NOT be added as a new tab on an existing settings
   page.** Tabs remain legitimate **inside** a single destination, but only
   for genuinely **parallel** content — two views of the same question. The
   live example is `apps/web/src/pages/Admin/UsersPage.tsx`, which keeps its
   two tabs (Users, Allowlist) on purpose: they are two views of one question
   ("who may use this application"), backed by two controllers, not a
   hierarchy. State the distinction precisely:
   - A **destination** gate (which registry card, which route) is about
     **reachability**.
   - A **tab** gate (inside one page) is about **content**.
   Conflating the two is the exact mistake epic #90 fixed:
   `SystemSettingsPage`'s three tabs (UI Settings, Feature Flags, Advanced
   JSON) were hierarchical content wearing a tab strip, not parallel content.
   Epic #90 split them into three separate cards; issue #366 later removed all
   three (and the `ui`/`features` system-settings namespaces behind them)
   as unused. Neither exists today — see
   [`docs/specs/settings-ui.md`](docs/specs/settings-ui.md) for the full history.

3. **The card's `permission` field MUST be the exact string the API
   controller enforces** — never invented, never approximated. Follow the
   real, verified mapping as the model:
   - `system_settings:read` / `system_settings:write` →
     `system-settings.controller.ts`
   - `users:read` → `users.controller.ts`
   - `allowlist:read` → `allowlist.controller.ts` (gates content **inside**
     the Users & Allowlist page, not the route — see rule 2's
     reachability-vs-content distinction)

4. **New settings surfaces MUST reuse the shared
   `apps/web/src/components/settings/SettingsHub.tsx` component.** Do not
   fork it, do not copy it. The worked example is `/settings`
   (`apps/web/src/pages/UserSettingsHubPage.tsx`): it is a binding
   (`sections`, `hubKey`, `title`, `subtitle`, and — since issue #425's
   feature-gated cards — `features`) over the exact same component
   `/admin/settings` uses — nothing more.

5. **The five coupled breakpoint gates move together or not at all.** Never
   change one without checking all five:
   1. `Layout.tsx`'s `showRail` (`up('sm')`) — mounts/unmounts `NavigationRail`
   2. `BottomNav`'s own `down('sm')` self-gate
   3. `<main>`'s `pb: { xs: 10, sm: 3 }` in `Layout.tsx`
   4. `SettingsHub.tsx`'s `isCompactWindow` (`down('sm')`)
   5. `AppBar.tsx`'s `isCompactWindow` (`down('sm')`)

   The boundary is `sm` (600px), never `md` (900px) — gating at 900px hands
   the phone treatment to 600–899px tablets, foldables, and landscape
   phones. There is deliberately no shared constant binding these five: see
   `docs/specs/settings-ui.md` §5 for why.

See [`docs/specs/settings-ui.md`](docs/specs/settings-ui.md) for the full
rationale, the rejected alternatives, and the accessibility requirements.

## MANDATORY: Every Long-Running Activity Is a Queue Job

Epic #345 makes three standing architecture decisions binding. They exist
because the database backup was, until this epic, a detached promise with no
job type, no row in `GET /api/admin/jobs`, no worker slot, and no timeout —
and the three-argument case against ever fixing that
(`docs/specs/database-backup.md`) turned out to be three defects in the queue,
not properties of backups. Fixing the queue and moving the backup onto it is
documented in full in [`docs/specs/job-queue.md`](docs/specs/job-queue.md) §7.10
and [`docs/specs/database-backup.md`](docs/specs/database-backup.md); this
section states the four rules that follow from it.

### Core Rules (MANDATORY)

1. **No long-running work outside the queue.** Any activity that outlives the
   HTTP request or cron tick that started it MUST be a registered `JobHandler`
   with a declared `type`, enqueued through `JobsService`. A detached
   `void this.doSomething()`, an `@OnEvent` body that downloads or spawns, and
   a `@Cron` body that does work inline are all violations. A `@Cron` may only
   decide *whether* work is due and enqueue it — `apps/api/src/jobs/tasks/job-history-purge.task.ts`
   is the reference `@Cron`, and `apps/api/src/jobs/housekeeping.enqueue.ts` is
   the shared helper several of the converted crons enqueue through.

   Three permanent exemptions, and only these three — the list lives in
   [`docs/specs/job-queue.md` §7.10](docs/specs/job-queue.md#710-all-long-running-work-is-a-job--the-rule-the-exemptions-the-limit)
   and `apps/api/test/jobs/cron-enqueue-only.spec.ts` is its executable form; a
   fourth requires editing both. `jobs/tasks/job-stuck-reset.task.ts` (the
   lease reaper — recovery that depends on the thing it recovers is not
   recovery), `jobs/tasks/temp-file-janitor.task.ts` (it sweeps *this
   process's* local disk, which a node or another replica claiming the job
   could not reach), and `nodes/tasks/node-secret-sweep.task.ts` (it destroys
   the short-lived database roles brokered to worker nodes — making
   credential revocation depend on the queue means a wedged queue leaks live
   credentials for as long as it stays wedged).

   Not covered: fire-and-forget notification dispatch
   (`this.notifications.notify(...)` and the delivery channels behind it).
   "Long-running" means work with a duration worth accounting for — a sweep
   over a table, a dump, a network round trip per row — not every asynchronous
   call.

2. **Node-eligibility is the default posture.** A new job type SHOULD carry
   `nodeResultSchema` + `persistNodeResult` unless it genuinely cannot —
   because it writes as it goes, reads several tables mid-computation, or
   needs a privilege a remote machine must never hold (the database restore is
   the canonical example: it renames the live database and stays server-only
   permanently). Eligibility stays **derived** from those two members; there
   is no `nodeEligible` flag and there never will be
   (`apps/api/src/jobs/job-handler.interface.ts`). A deployment declines the
   offload with a system setting consulted at claim time
   (`NodeOffloadService.offeredTypes()` and a handler's own
   `nodeOffloadEnabled()`) — never by editing the handler.

3. **A node never persists a job-scoped credential.** Every secret a node
   needs for a job is issued per job by the server through
   `POST /api/nodes/:id/jobs/:jobId/secret`, gated by `assertJobHeldByNode`,
   bounded by the job's own lease, held in the node's memory only, and revoked
   when the job settles or by the sweep above. The server stores the
   credential's **handle** in `job_node_secrets`, never its material — that
   table has no column able to hold one. A handler declares the need by
   carrying a `nodeSecretBroker` (`apps/api/src/jobs/job-secret-broker.ts`);
   presence is the declaration, exactly as `nodeResultSchema` +
   `persistNodeResult` declare eligibility. The node's own `nod_` identity
   token is the single exception to "never persisted" — it is an identity a
   node authenticates with, not a job-scoped grant.

4. **A job type declares its execution profile, or takes the global default.**
   `JobHandler.profile` is optional and, when present, carries exactly
   `{ maxRuntimeMs, maxAttempts }` — **and only those two numbers**
   (`apps/api/src/jobs/job-execution-profile.ts`). The lease, the renewal
   interval, and the reaper's patience for an implausible lease are all
   *derived* from `maxRuntimeMs`, so a lease that contradicts a declared
   timeout is unrepresentable rather than merely avoided. Do not add
   `leaseMs` or `heartbeatMs` to the profile — a declared duration that can
   disagree with `maxRuntimeMs` is exactly the state this rule exists to rule
   out.

## MANDATORY: AI Platform Rules

Epic #419 adds one admin-governed, bring-your-own-key, multi-provider AI
capability to this template (`apps/api/src/ai/**`). It is documented in full,
with rationale and rejected alternatives, in
[`docs/specs/ai-platform.md`](docs/specs/ai-platform.md); this section states
the rules that follow from it. The module's own developer README is
[`apps/api/src/ai/README.md`](apps/api/src/ai/README.md); the operator runbook
is [`docs/runbooks/ai-configuration.md`](docs/runbooks/ai-configuration.md).

### Core Rules (MANDATORY)

1. **Never import a provider SDK outside `apps/api/src/ai/providers/<provider>/`.**
   A feature that wants AI injects `AiService` (`apps/api/src/ai/runtime`,
   re-exported by `AiModule`) and calls `AiService.forUser(userId)` — never an
   SDK client of its own. `apps/api/src/ai/core/no-provider-sdk.spec.ts` is
   this rule's executable form for the `openai` package today; a second
   provider's SDK gets the identical guard when its adapter is added (§14 of
   the spec).
2. **Never call AI from the browser; keys never leave the server.** Every
   provider call happens server-side, under a key `AiKeyResolver` resolved
   for that call — the admin/org key or a user's own BYOK key
   (`docs/specs/ai-platform.md` §3) — and the key exists in the runtime only
   between resolving it and calling the adapter (`ai.service.ts`'s own header
   comment marks the exact window). No route, log line, span, `AiError`,
   `ai_usage_events` row or `ai_runs.request` row may ever carry key
   material.
3. **Long AI work is a queue job and is server-only, never node-eligible.**
   `ai.catalog.refresh` and `ai.response.run` (and any Phase 2/3 media job)
   implement neither `nodeResultSchema` nor `persistNodeResult` — this is
   permanent, not provisional: a user's BYOK key, and the platform's own
   admin/org key, must never be brokered to a worker node under any
   circumstance (this is on top of, not instead of, the queue rules in
   "MANDATORY: Every Long-Running Activity Is a Queue Job" above — see
   `docs/specs/ai-platform.md` §9 for the full argument).
4. **Every new AI route sits behind `AiEnabledGuard` plus `ai:use`** (consumer
   routes under `/api/ai/*`) **or `ai_config:read`/`ai_config:write`** (admin
   routes under `/api/admin/ai/*`, which are deliberately **not** behind
   `AiEnabledGuard` — an administrator must always be able to turn the
   platform back on).
   `apps/api/test/ai/ai-kill-switch.integration.spec.ts` (issue #435) is
   the executable form of this rule: it discovers every `/api/ai/*` and
   `/api/admin/ai/*` route by reflecting on the real Nest router (via
   `createOpenApiDocument`, never a hand-written list), then asserts that
   while `ai.enabled=false` every discovered `/api/ai/*` route except
   `GET /api/ai/config` answers `403` with `details.reason: 'AI_DISABLED'`
   (unauthenticated — `AiEnabledGuard` runs at controller/class level and
   so denies before `@Auth()`'s own guard is reached, per
   `ai-enabled.guard.ts`'s header) while every `/api/admin/ai/*` route stays
   reachable (answering its own auth/RBAC outcome, never the kill switch).
   A route added later without the guard, or an admin route accidentally
   given it, fails this suite the moment it is registered — nobody edits a
   list. It also drives every `ai.*` job type from `JobHandlerRegistry
   .types()` (also discovered, not hand-listed) through its handler with AI
   disabled and asserts zero provider calls reach `FakeAiProvider`.

   Five more #435 suites are the same "discover, never hand-list" tripwire
   shape, each pinning one more platform-wide invariant — all under
   `apps/api/test/ai/` unless noted, and all covering a future AI route or
   job type automatically, with no edit to the suite itself:
   - `ai-rbac-matrix.integration.spec.ts` — every discovered route crossed
     against Admin/Contributor/Viewer/unauthenticated, with the *expected*
     permission read off the route's own `@Auth()` metadata and the seeded
     grant read off `prisma/seed-data.ts`'s `ROLE_PERMISSIONS`, so a route
     and a seed drifting apart fails this suite, not a reviewer's memory.
   - `ai-secret-egress.integration.spec.ts` — a distinct sentinel key per
     role (admin/org, this user, another user) must never appear in any
     response body, response header, captured log line, `audit_events.meta`
     row, `ai_usage_events` row, `ai_runs.request` row, or thrown error body.
   - `ai-key-policy.integration.spec.ts` — the byok/org resolution rule
     (rule 2 above) proven over every inference route, synchronous and
     queued, by inspecting `FakeAiProvider.calls`' literal `apiKey`.
   - `ai-jobs-server-only.spec.ts` — every job type whose type begins `ai.`
     carries neither `nodeResultSchema` nor `persistNodeResult`, read off
     `JobHandlerRegistry.serverOnlyTypes()` — the executable form of rule 3.
   - `ai-no-sdk-leak.spec.ts` — no file outside `ai/providers/<provider>/`
     imports a provider SDK package (by package name, not a string grep for
     `"openai"`), in either `apps/api/src` or `apps/web/src` — the executable
     form of rule 1, wider than `ai/core/no-provider-sdk.spec.ts`'s own
     narrower, permanent pin.
   - `apps/web/src/__tests__/config/aiSettingsRegistry.test.ts` — every
     registry card tagged `feature: 'ai'` or routed under an AI path has its
     `permission` checked against the literal string the real API controller
     source enforces, read off disk — the mechanical half of Settings UI
     Pattern rule 3, generic over future AI cards.
5. **New AI settings pages follow the Settings UI Pattern and declare
   `feature: 'ai'`.** A registry card behind the AI platform (the admin `AI
   Models` card, the user `AI Keys` card) is invisible while AI is switched
   off, the same way a Settings UI Pattern rule 1 card is invisible without
   its permission — see the `AI` admin group and `AI Keys` user card below.
   The admin `AI` card itself is the one deliberate exception, carrying no
   `feature`: it is the page an administrator switches AI on from, and
   gating it on AI being on would make the switch unreachable in exactly the
   state it exists to change.

## Architecture Principles

1. **Separation of Concerns**: UI handles presentation only; API handles all business logic and authorization
2. **Same-Origin Hosting**: UI at `/`, API at `/api`, API reference at `/api/docs`
3. **Security by Default**: All API endpoints require authentication unless explicitly public
4. **API-First**: All business logic resides in the API layer

## Key Commands

```bash
# Setup: copy environment template
cp infra/compose/.env.example infra/compose/.env

# Start development (from infra/compose folder)
cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml up

# Start development with observability (Uptrace UI at http://localhost:14318)
cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f otel.compose.yml up

# Start production mode
cd infra/compose && docker compose -f base.compose.yml -f prod.compose.yml up

# Run API tests
cd apps/api && npm test

# Run frontend tests
cd apps/web && npm test

# Generate Prisma client after schema changes
cd apps/api && npm run prisma:generate

# Create a new migration (development)
cd apps/api && npm run prisma:migrate:dev -- --name <migration_name>

# Apply migrations (production)
cd apps/api && npm run prisma:migrate

# Note: Use npm scripts (prisma:*) instead of direct npx commands
# They automatically construct DATABASE_URL from individual env vars
```

## Service URLs (Development)

- **Application**: http://localhost:3535 (via Nginx)
- **API Reference (Scalar)**: http://localhost:3535/api/docs
- **Uptrace**: http://localhost:14318 (when otel stack running)

## Command-Line Client (`appctl`)

`apps/cli` is the first-party CLI for this API (epic #110). It is a workspace
package (`--workspace=cli`) that is built from this monorepo and not published;
it logs in through the device authorization flow below, stores the resulting
personal access token, and exposes a single generic `api <method> <path>`
command so it does not go stale as endpoints are added or renamed.

Usage, install, flags, environment variables and CI setup are documented in
[`apps/cli/README.md`](apps/cli/README.md) — that file is the source of truth;
do not restate it here.

### Deploying to a VPS

VPS deployment (epic #168) lives entirely in this CLI as `appctl deploy
doctor|install|update|status` — there is no separate deploy script or
Ansible playbook anywhere in this repo, and there shouldn't be. The design
(why it runs on the VPS with no SSH client in the CLI, why TLS is terminated
by a shared host proxy instead of per-app, why there's no `db` service, what
was rejected) is documented in full in
[`docs/specs/vps-deploy.md`](docs/specs/vps-deploy.md); the operator-facing
runbook — prerequisites, first login after install, troubleshooting — is
[`docs/deployment/vps.md`](docs/deployment/vps.md). The command reference
(flags, exit codes) is [`apps/cli/README.md`](apps/cli/README.md#deploying-to-a-server)
above. Don't restate any of that here; extend those three instead.

## API Endpoints (MVP)

### Authentication
- `GET /api/auth/providers` - List enabled OAuth providers
- `GET /api/auth/google` - Initiate Google OAuth
- `GET /api/auth/google/callback` - OAuth callback
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout and invalidate session
- `POST /api/auth/logout-all` - Logout from all devices
- `GET /api/auth/me` - Get current user

### Device Authorization (RFC 8628)
- `POST /api/auth/device/code` - Generate device code (Public)
- `POST /api/auth/device/token` - Poll for authorization (Public)
- `GET /api/auth/device/activate` - Get activation info
- `POST /api/auth/device/authorize` - Approve/deny device
- `GET /api/auth/device/sessions` - List device sessions
- `DELETE /api/auth/device/sessions/{id}` - Revoke device session

### Users (Admin-only)
- `GET /api/users` - List users (paginated)
- `GET /api/users/{id}` - Get user by ID
- `PATCH /api/users/{id}` - Update user (roles, activation)
- `PUT /api/users/{id}/roles` - Update user roles

### Settings
- `GET /api/user-settings` - Get current user's settings
- `PUT /api/user-settings` - Replace user settings
- `PATCH /api/user-settings` - Partial update user settings
- `POST /api/user-settings/profile-image` - Upload a profile picture (multipart, `user_settings:write`)
- `DELETE /api/user-settings/profile-image` - Remove the uploaded profile picture (`user_settings:write`)
- `GET /api/user-settings/profile-image` - Authenticated preview of the caller's own uploaded picture regardless of selected source (`user_settings:read`)
- `GET /api/users/{userId}/avatar/{objectId}` - Public, same-origin stream of a user's uploaded avatar
- `GET /api/system-settings` - Get system settings
- `PUT /api/system-settings` - Replace system settings (Admin)
- `PATCH /api/system-settings` - Partial update system settings (Admin)

### Allowlist (Admin-only)
- `GET /api/allowlist` - List allowlisted emails (paginated, filterable)
- `POST /api/allowlist` - Add email to allowlist
- `DELETE /api/allowlist/{id}` - Remove email from allowlist

### Storage Objects
- `POST /api/storage/objects/upload/init` - Initialize resumable upload
- `GET /api/storage/objects/:id/upload/status` - Get upload progress
- `POST /api/storage/objects/:id/upload/complete` - Complete multipart upload
- `DELETE /api/storage/objects/:id/upload/abort` - Abort upload
- `POST /api/storage/objects` - Simple file upload
- `GET /api/storage/objects` - List objects (paginated)
- `GET /api/storage/objects/:id` - Get object metadata
- `GET /api/storage/objects/:id/download` - Get signed download URL
- `DELETE /api/storage/objects/:id` - Delete object
- `PATCH /api/storage/objects/:id/metadata` - Update metadata

### Storage Configuration (Admin-only)
Runtime-configurable object storage (issue #375, epic #372) — which
provider (AWS S3, Cloudflare R2, S3-compatible), bucket and credential this
deployment stores files in, editable with no restart at
`/admin/settings/storage`. See
[`docs/specs/storage-providers.md`](docs/specs/storage-providers.md) and
[`docs/runbooks/storage-configuration.md`](docs/runbooks/storage-configuration.md).
- `GET /api/admin/storage-config` - The `storage` namespace plus `configured`/`missing`/masked `secretStatus`; the secret itself is never returned (`storage_config:read`)
- `PUT /api/admin/storage-config` - Full replace, blank-preserves the secret, typed `SWITCH` confirmation before repointing a deployment that still holds objects (`storage_config:write`)
- `POST /api/admin/storage-config/test` - Four checks (credentials, bucket, round trip, presigned URL) against the submitted, unsaved configuration; 200 even on failure — read `success` (`storage_config:write`)
- `POST /api/admin/storage-config/bucket` - Create and harden the bucket; 200 with `outcome:"guided"` (paste-ready commands, never a 4xx) when the credential cannot create buckets (`storage_config:write`)

### Personal Access Tokens
- `POST /api/pat` - Create a new personal access token
- `GET /api/pat` - List current user's tokens
- `DELETE /api/pat/{id}` - Revoke a token

### Jobs — the background queue (Admin-only)
Six literal routes plus the `insights` pair, all under `/api/admin/jobs`; see
[`docs/specs/job-queue.md`](docs/specs/job-queue.md). `jobs:read` for the four
reads, `jobs:write` for the four writes (`insights/reset-history` included —
it destroys unrecoverable rollup history, not a job).
- `GET /api/admin/jobs/stats` - Totals, per-status/per-type breakdown, `stuckRunning` and its threshold
- `GET /api/admin/jobs/insights?windowDays=` - Throughput, duration percentiles, per-type ETA, lifetime totals (max 90 days)
- `POST /api/admin/jobs/insights/reset-history` - Clear the `job_stats_rollup` accumulators (live jobs untouched)
- `POST /api/admin/jobs/retry-failed` - Requeue every failed job, optionally one `type` (max 500/call)
- `POST /api/admin/jobs/reset-stuck` - Run the lease reaper on demand (`olderThanMinutes` overrides the system setting)
- `GET /api/admin/jobs` - List jobs, paginated and filterable (payloads not included)
- `POST /api/admin/jobs/{id}/retry` - Requeue one job (400 if it is currently running)
- `DELETE /api/admin/jobs/{id}` - Delete one job (400 if it is currently running; 409 if the job's owner refuses — e.g. a broadcast job while its broadcast is scheduled or sending)

### Worker Nodes — the fleet that executes jobs remotely
Three surfaces; see [`docs/specs/worker-nodes.md`](docs/specs/worker-nodes.md).
`nodes:read` for every read, `nodes:write` for every write (minting a signed
URL and claiming a job both count as writes — see the spec for why).

**`/api/nodes/*`** — what a node talks to. Reachable by a `nod_` credential
(the *only* prefix that credential family can reach) or by a session/PAT
holding `nodes:*`; scoped to the caller's own nodes.
- `POST /api/nodes/register` - Register, or reattach to an existing `(owner, name)` row (200, not 201 — see `reattached`)
- `GET /api/nodes/job-types` - Node-eligible job types, each with its result JSON Schema
- `GET /api/nodes` - List the caller's nodes
- `GET /api/nodes/{id}` - Get one node
- `POST /api/nodes/{id}/deregister` - Mark offline (does not requeue held jobs)
- `POST /api/nodes/{id}/heartbeat` - Liveness + optional capability/concurrency refresh
- `POST /api/nodes/{id}/claim` - Claim up to `concurrency` runnable jobs under a lease
- `POST /api/nodes/{id}/jobs/{jobId}/renew` - Extend the lease
- `POST /api/nodes/{id}/jobs/{jobId}/download-url` - Signed GET for the job's input object (data plane; bytes never touch this API)
- `POST /api/nodes/{id}/jobs/{jobId}/upload-url` - Signed PUT plus the server-chosen key (data plane)
- `POST /api/nodes/{id}/jobs/{jobId}/secret` - Issue the one short-lived, job-scoped credential this job's type declares (epic #345). Bounded by the job's lease, returned once, revoked on settlement; `403` when this deployment does not broker credentials, `404` when the type declares no broker, `503` when the broker cannot mint right now
- `POST /api/nodes/{id}/jobs/{jobId}/result` - Submit a validated result; settles the job
- `POST /api/nodes/{id}/jobs/{jobId}/failure` - Report a failure (`rateLimited` defers rather than charging an attempt)

**`/api/node-credentials`** — minting/revoking `nod_…` bearer credentials.
Deliberately **not** reachable by a `nod_` credential itself (only a session
or `pat_` token), so a leaked node token can never mint another.
- `POST /api/node-credentials` - Mint a credential; the raw token is shown exactly once
- `GET /api/node-credentials` - List the caller's credentials, masked
- `DELETE /api/node-credentials/{id}` - Revoke (effective on the node's next request)

**`/api/admin/nodes/*`** (Admin-only) — the whole fleet, every owner, deliberately
on a *different* prefix so it sits outside the `nod_` allowlist by construction.
- `GET /api/admin/nodes` - Every node, with owner email and derived health
- `GET /api/admin/nodes/{id}` - One node, whoever owns it
- `DELETE /api/admin/nodes/{id}` - Delete the node record (jobs are unclaimed, not deleted)
- `GET /api/admin/nodes/credentials` - Every node credential, with its owner
- `DELETE /api/admin/nodes/credentials/{id}` - Revoke any credential, whoever owns it

### Maintenance (Admin-only)
No dedicated permission — this *is* a system setting, stored in the
`maintenance` namespace and gated by the same pair every other system setting
uses. See [`docs/specs/maintenance-mode.md`](docs/specs/maintenance-mode.md)
and [`docs/runbooks/maintenance-mode.md`](docs/runbooks/maintenance-mode.md).
- `GET /api/admin/maintenance` - Effective state plus each contributing layer (`system_settings:read`)
- `PUT /api/admin/maintenance` - Open or close the window (`system_settings:write`)

### Database Backup (Admin-only)
- `GET /api/admin/db-backup/node-credential-preflight` - Whether a worker node can be handed a
  short-lived, SELECT-only database credential to take a backup (`db_backup:read`). Two
  independent facts: `outcome` is the **capability** (a live `CREATEROLE` probe), `brokerEnabled`
  is the **policy** (`nodes.jobSecretBrokerEnabled`). ⚠ `outcome: "guided"` is a **200** carrying
  paste-ready SQL, never a 4xx — managed PostgreSQL denying `CREATEROLE` is the ordinary case.
  See [`docs/runbooks/node-job-secrets.md`](docs/runbooks/node-job-secrets.md)
- `GET /api/admin/db-backup/config` - Backup policy, computed `nextRunAt`, active run id
- `PUT /api/admin/db-backup/config` - Update the policy (partial; every field optional)
- `POST /api/admin/db-backup/runs` - Take a backup now (returns immediately; 409 if one is running)
- `GET /api/admin/db-backup/runs` - List runs (paginated, newest first)
- `GET /api/admin/db-backup/runs/{id}` - Get one run (progress polling)
- `GET /api/admin/db-backup/runs/{id}/download` - Signed, short-lived archive URL
- `DELETE /api/admin/db-backup/runs/{id}` - Delete a run and its archive
- `POST /api/admin/db-backup/runs/{id}/cancel` - Cancel a running backup
- `POST /api/admin/db-backup/runs/{id}/restore` - Restore the database from this backup (`db_backup:restore`; body `{"confirmation":"RESTORE"}`; three normal `mode`s: `running`/`guided`/`blocked`)
- `POST /api/admin/db-backup/runs/{id}/rollback` - Undo that restore (`db_backup:restore`; body `{"confirmation":"ROLLBACK"}`; three normal `mode`s: `renamed`/`restore_started`/`unavailable`)

### Push Configuration (Admin-only)
Runtime-configurable Web Push (VAPID) keys (issue #355) — generate, rotate,
enable/disable, and remove entirely from the admin UI, no restart. See
[`docs/specs/browser-notifications.md`](docs/specs/browser-notifications.md)
and [`docs/runbooks/vapid-keys.md`](docs/runbooks/vapid-keys.md).
- `GET /api/admin/push-config` - Configuration plus masked `privateKeyStatus`; private key never returned (`push:read`)
- `PUT /api/admin/push-config` - Flip `{ enabled, subject }`; does not manufacture keys (409 if enabling with none generated) (`push:write`)
- `POST /api/admin/push-config/generate` - First-time key generation, sets `enabled: true` (409 if already configured) (`push:write`)
- `POST /api/admin/push-config/rotate` - Replace the key pair (body `{"confirmation":"ROTATE"}`; 400 if nothing configured yet) (`push:write`)
- `DELETE /api/admin/push-config` - Delete both the credential and the settings row (body `{"confirmation":"REMOVE"}`) (`push:write`)

### About (Admin-only)
What is actually deployed here (issue #401, epic #397): the API's own version,
the `appctl deploy` state document (commit, ref, domain, bind port, proxy
runtime, host facts, deploy history — written by the CLI, described in full in
[`docs/runbooks/deployment-info.md`](docs/runbooks/deployment-info.md)), and a
live database-liveness fact. Always answers `200` — a missing or malformed
deploy document is a field (`deployInfoStatus: "absent"`/`"invalid"`), never an
error status, because this is read precisely when something has gone wrong.
Gated on the existing `system_settings:read`, deliberately with **no
permission of its own** — a read-only report of what is deployed does not have
the distinct blast radius that justified splitting out
`push:*`/`broadcasts:*`/`nodes:*`/`storage_config:*`.
- `GET /api/admin/about` - Deployment report: API version, deploy document fields, live `runtime` block, database liveness (`system_settings:read`)

### AI (Admin-only)
Runtime-configurable, admin-governed, bring-your-own-key AI (epic #419) — the
kill switch, key policy, per-provider enablement and admin/org key, and the
model catalog, all editable with no restart at `/admin/settings/ai` and
`/admin/settings/ai/models`. `@ApiTags('AI Administration')`. See
[`docs/specs/ai-platform.md`](docs/specs/ai-platform.md) and
[`docs/runbooks/ai-configuration.md`](docs/runbooks/ai-configuration.md).
- `GET /api/admin/ai/config` - The `ai` namespace plus one entry per provider (`enabled`, `baseUrl`, capabilities, masked `keyStatus`); the admin key itself is never returned (`ai_config:read`)
- `PUT /api/admin/ai/config` - Full replace of the non-secret configuration; `If-Match` version check (`ai_config:write`)
- `PUT /api/admin/ai/providers/{provider}/key` - Set/replace the admin (org) key; verified against the provider first, 400 `AI_KEY_INVALID` and nothing stored on rejection (`ai_config:write`)
- `DELETE /api/admin/ai/providers/{provider}/key` - Remove the admin key; body `{"confirmation":"REMOVE"}`, warns if this leaves `byok_with_org_fallback` with no fallback (`ai_config:write`)
- `POST /api/admin/ai/providers/{provider}/test` - Three checks — `credentials`, `list_models`, `responses_smoke` (a real, billed call) — against the submitted or stored key; always 200, read `success` (`ai_config:write`)
- `GET /api/admin/ai/models` - Paginated model catalog, filterable by provider/capability/enabled/deprecated (`ai_config:read`)
- `PATCH /api/admin/ai/models/{id}` - Enable/disable a model or override its capabilities; sets `capabilitySource: "admin_override"` (`ai_config:write`)
- `POST /api/admin/ai/models/refresh` - Enqueue `ai.catalog.refresh` for one provider using the admin key; 409 with no admin key configured (`ai_config:write`)

### AI
The caller's own AI surface: usable models, BYOK keys, and calling AI itself.
`@ApiTags('AI')`. Every route except `GET /api/ai/config` sits behind
`AiEnabledGuard` (403 `details.reason: "AI_DISABLED"` while AI is off) and
requires `ai:use`. See
[`docs/specs/ai-platform.md`](docs/specs/ai-platform.md).
- `GET /api/ai/config` - Whether AI is enabled, the key policy, `allowBackgroundRuns` (whether `POST /api/ai/runs` accepts a request at all), and which providers are enabled/carry an org key; reachable while AI is disabled — how a client learns to hide its AI surfaces (any authenticated user, no `ai:use` required)
- `GET /api/ai/keys` - List the caller's provider keys, masked (`ai:use`)
- `PUT /api/ai/keys/{provider}` - Set/replace the caller's key; verified against the provider first, then reachable models computed, then stored (`ai:use`)
- `DELETE /api/ai/keys/{provider}` - Remove the caller's key; 204, idempotent (`ai:use`)
- `POST /api/ai/keys/{provider}/test` - Two checks only — `credentials`, `list_models` — deliberately no billed smoke call against the caller's own account; always 200 (`ai:use`)
- `GET /api/ai/models` - Models the caller can use right now: admin-enabled, not deprecated, and reachable with their resolved key (`ai:use`)
- `POST /api/ai/responses` - One AI response via `AiService.forUser(id).respond(...)`; 1 MB body limit, function tools not accepted over HTTP (`ai:use`)
- `POST /api/ai/responses/stream` - The same request as SSE (`Accept: text/event-stream`, no `stream` flag) — `event: <type>` frames, `: ping` every 15s, ending with `response.completed` or an in-band `error` frame; every pre-stream refusal is an ordinary JSON error over an unbuffered nginx route (issue #433, epic #419) (`ai:use`)
- `POST /api/ai/runs` - Queue a background AI response (`ai.response.run`); 202 `{ runId, jobId }`; 400 `AI_INVALID_REQUEST` when `ai.defaults.allowBackgroundRuns` is off (`ai:use`)
- `GET /api/ai/runs/{id}` - Get one background run, scoped to the caller — `{ id, status, provider, modelId, output, errorCode, errorMessage, createdAt, completedAt }`; 404 for another user's run (`ai:use`)
- `POST /api/ai/runs/{id}/cancel` - Cancel a background run, scoped to the caller; idempotent — a finished run is returned unchanged (`ai:use`)

### Health
- `GET /api/health/live` - Liveness check
- `GET /api/health/ready` - Readiness check (includes DB)

## RBAC Model

### Roles
- **Admin**: Full access, manage users and system settings
- **Contributor**: Standard capabilities, manage own settings
- **Viewer**: Least privilege (default), manage own settings

### Key Permissions
- `system_settings:read/write` - System settings access
- `user_settings:read/write` - User settings access
- `users:read/write` - User management
- `rbac:manage` - Role assignment
- `allowlist:read/write` - Allowlist management (Admin only)
- `storage:read/write/delete` - Storage object access (own objects)
- `storage:read_any/write_any/delete_any` - Storage object access (all objects, Admin only)
- `jobs:read/write` - Background job queue: inspect vs. retry/reset/delete
- `nodes:read/write` - Worker node fleet: audit vs. register/claim/revoke. **Split from
  `jobs:*`, not folded into it** — "what work is queued" and "which machines are attached
  to this deployment" are different questions, and a Settings UI Pattern rule 3 card gated
  on `jobs:read` would be advertising a permission the nodes controller never checks
- `db_backup:read/write/restore` - Database backup: inspect vs. schedule/trigger/cancel/delete
  vs. **restore or roll back**. `:restore` is a **third**, deliberately separate permission —
  not part of `:write` — because scheduling a nightly dump and replacing the live database
  are not the same authority, and a deployment must be able to grant the first to someone
  it does not trust with the second. Folding it into `:write` would let every existing
  `db_backup:write` holder silently acquire the ability to roll back production
- `broadcasts:read/write` - Admin notification broadcasts (epic #319)
- `push:read/write` - Web Push (VAPID) configuration: generate, rotate, enable/disable
  (epic #355). **Not a reuse of `system_settings:*`** — generating/rotating key material
  has a real, described blast radius (every existing subscriber goes dark until it
  re-subscribes) that should not ride along with routine settings edits, mirroring why
  `broadcasts:*` and `nodes:*` were split out rather than folded into
  `system_settings:*`/`jobs:*`
- `storage_config:read/write` - Object-storage configuration: provider, bucket, region,
  endpoint, credential (issue #375, epic #372). **Neither `system_settings:*` nor
  `storage:*`** — not the former because a wrong bucket or a rotated-out secret breaks
  every upload, avatar, job artifact and database backup in the deployment at once,
  the same "distinct blast radius" argument `push:*`/`broadcasts:*`/`nodes:*` each made;
  not the latter, which is the closer-looking mistake — `storage:*` gates *object access*
  and is seeded to Viewer and Contributor, so reusing it would put this
  credential-bearing configuration screen in front of the entire user base. See
  [`docs/specs/storage-providers.md`](docs/specs/storage-providers.md)
- `ai_config:read/write` - Deployment-wide AI configuration: kill switch, key policy, provider
  enablement, admin/org keys, model catalog enablement and overrides (epic #419). Seeded
  **Admin only**. **Not a reuse of `system_settings:*`** — a wrong key policy or a wrongly
  enabled model has a blast radius specific to this platform, the identical argument that
  split out `storage_config:*`, `push:*`, `broadcasts:*` and `nodes:*` rather than folding
  each into a permission seeded far more broadly for unrelated settings
- `ai:use` - May call AI with the caller's own key (or the org fallback key, when the
  deployment's key policy allows it): every consumer-facing route under `/api/ai/*` except
  the always-open `GET /api/ai/config`. Seeded to **all three roles** — using AI with a key
  the caller themselves supplied is not an administrative act, the same posture managing
  one's own settings or storage objects already takes. Deliberately **not** folded into
  `ai_config:*`: an administrator must be able to grant "may use AI" broadly while keeping
  "may reconfigure the AI platform for the whole deployment" Admin-only — see
  [`docs/specs/ai-platform.md`](docs/specs/ai-platform.md) §11

## Database Tables

- `users` - User accounts with profile info
- `user_identities` - OAuth provider identities (provider + subject)
- `roles` / `permissions` / `role_permissions` - RBAC
- `user_roles` - User-to-role assignments
- `system_settings` - Global app settings (JSONB)
- `user_settings` - Per-user settings (JSONB)
- `audit_events` - Action audit log
- `refresh_tokens` - JWT refresh tokens (hashed)
- `allowed_emails` - Allowlist for access control
- `device_codes` - Device authorization codes (RFC 8628)
- `storage_objects` - File metadata, status, storage references
- `storage_object_chunks` - Multipart upload chunk tracking
- `personal_access_tokens` - User-created long-lived API tokens (hashed)
- `jobs` - The background queue (epic #254). `subject_type`/`subject_id` are both plain
  `text`, nullable, no FK either way — a job's subject is polymorphic (a storage object
  today, something else tomorrow), and a fork's own tables cannot be enumerated by a
  Prisma relation. `attempts` is charged **at claim time**, not on completion or failure —
  see `job-claim.service.ts` — so a process that dies mid-run (OOM kill, hard crash) still
  bounds its retries; a job read inside `process()` always sees its own attempt already
  counted. Two indexes exist **only** in `migration.sql`, not in `schema.prisma`, because
  Prisma cannot express a partial unique index: `jobs_active_dedup_uniq_idx` (`dedup_key`
  `WHERE status IN ('pending','running') AND dedup_key IS NOT NULL`) is the actual dedup
  enforcement, and `database_backup_runs_active_uniq_idx` below is its counterpart. This is
  deliberate, intentional schema drift — do not "fix" it by adding a `@@unique` to the model.
  `claim_token` (nullable `uuid`, no default, no index; issue #361) identifies **one claim**
  of a row, not one kind of claimant — `claimedByNodeId: null` alone can't tell two API
  replicas apart, so a replica whose job was reaped and re-claimed by another replica could
  extend that other replica's lease without knowing it lost the row. Minted fresh, per row,
  by the claim statement itself (`gen_random_uuid()`, never a bound parameter); non-null
  **exactly while the row is claimed** — every un-claim path (settle, the lease reaper, a
  retry reset) clears it alongside `claimedByNodeId`/`leaseExpiresAt`, and every write that
  speaks for a claim — lease renewal and every `JobTerminalService` settle/retry/defer write
  (#477) — is conditional on it, so a stalled executor cannot settle, retry or re-announce a
  row that was reaped or re-claimed. Not published by the
  admin job list (`JOB_LIST_SELECT` omits it, same as `payload`) — it is internal ownership
  machinery, not something an operator reads. The node control plane is token-matched too
  (issue #364): the claim response hands the token to the node, which quotes it back on all
  six routes that speak for a held job, so a node's own stalled-and-re-claimed slot can no
  longer renew or settle the run its newer slot is executing. See `docs/specs/job-queue.md`
  §6.9 for the full argument, including why an un-upgraded node stays exactly as
  self-ambiguous as before until it upgrades.
- `job_stats_rollup` - One row per job type, incrementally accumulating succeeded/failed
  counts and duration sums so lifetime stats survive the history purge. `sumDurationMs` is
  `Float`, not `BigInt`, to avoid crashing `JSON.stringify` at read time.
- `worker_nodes` - Registered worker node fleet (epic #254): identity, declared
  `eligibleTypes`/`concurrency`, operator `status` (`online`/`draining`/`offline`/`disabled`).
  Health is never stored — it is derived from `lastHeartbeatAt` at read time.
- `node_credentials` - `nod_…` bearer credentials a worker node authenticates with. Mirrors
  `personal_access_tokens`' hash/prefix/show-once shape, minus a mandatory expiry (a node
  runs unattended for months; revocation, not a clock, is the control).
- `job_node_secrets` - One row per short-lived, job-scoped credential a node has been issued
  (epic #345, issue #349). Records the broker `kind`, the credential's **handle** (e.g. a
  minted PostgreSQL role name) and its `expiresAt`/`revokedAt` — **never the credential's
  material**; the table has no column that could hold one. `@@unique([jobId, kind])` makes a
  second grant for the same job and broker unrepresentable, so a re-request while the lease
  is live extends the existing grant instead of minting a second. Three revocation paths can
  set `revokedAt`: the job-settle listener, `NodeSecretSweepTask`'s cron, and `VALID UNTIL`
  itself at the database level, which is why the row's `expiresAt` is bounded by the job's
  lease rather than being a clock of its own.
- `database_backup_runs` - One row per backup/restore attempt, with its own heartbeat and
  stale window — **not** a `jobs` row, because the lease reaper's `stuckThresholdMinutes`
  (default 30 min) would reset a legitimately multi-hour `pg_dump`/restore to pending and
  start a second one against the same storage key. At most one active run (`pending` or
  `running`) is enforced by `database_backup_runs_active_uniq_idx`, the same
  raw-SQL-only partial unique index pattern as `jobs` above — never by a `findFirst`
  before the insert, which cannot close the race a concurrent request needs closed.
- `ai_models` - The discovered/classified model catalog (epic #419), one row per
  `(provider, modelId)`. `capabilities` is JSONB (`AiModelCapabilities`, Zod-validated at
  the consuming layer) rather than typed columns because its shape is provider-specific and
  grows with Phase 2/3 capabilities; `capabilitySource` (`'unclassified'` default) records
  whether it came from a provider's own classifier or an `admin_override`. `enabled`
  defaults to `false` — the same "discovery alone changes nothing" posture
  `WorkerNode.status` and `databaseBackup.enabled` both take — so a freshly discovered
  model is inert until an administrator (or a later sync's own policy) turns it on.
  `discoveredAt` vs. `lastSeenAt` splits creation time from liveness, mirroring
  `WorkerNode.registeredAt`/`.lastHeartbeatAt`.
- `user_ai_keys` - One BYOK row per `(userId, provider)`, cascade-deleted with the user.
  `secret` is ciphertext only (`encryptSecret(plaintext, 'ai_user_key')`) — a cipher
  *purpose* dedicated to this table and distinct from the `'ai'` purpose the admin/org key's
  `CredentialsService` row uses, so the two secret spaces cannot be confused by construction
  even by accident. `reachableModelIds` is a DEPLOYMENT-independent fact about the key
  itself (which models it can actually reach, as opposed to `ai_models.enabled`, which is a
  deployment-wide policy decision) — a key with a narrower API scope or a provider-side
  allowlist can legitimately reach fewer models than the deployment otherwise offers.
  Recomputed at key-set time, on the weekly `ai.keys.recheck` job, and whenever
  `ai.catalog.refresh` emits `AI_CATALOG_SYNCED_EVENT`.
- `ai_runs` - One row per background AI response (`ai.response.run`, epic #419).
  `jobId` is nullable and deliberately **not a foreign key**, mirroring `jobs.subjectType`/
  `subjectId`'s polymorphism argument above. `request` holds the **full normalized
  request** — instructions, the complete input, tool definitions, structured-output
  schema — built by `toStoredRunRequest` so the job that executes it can re-issue an
  identical call; it is never truncated or redacted, and it is never the caller's key,
  which the executor resolves separately at run time. `status` is `pending
  |running|succeeded|failed|cancelled`, a plain string for the same forward-compatibility
  reason other state-machine columns in this schema are.
- `ai_usage_events` - One row per provider round-trip (success, failure or cancellation;
  epic #419) — `userId` nullable/`SetNull` for a system-initiated catalog sync, `keySource`
  (`user|org|admin_discovery`) records whose key paid, `operation`
  (`responses|images|audio.transcribe|audio.speech|embeddings|catalog`) is a plain string
  for the same reason `AiUsageEvent.operation`'s own comment gives: a new operation kind
  must cost zero migrations here. Token columns are all nullable (not every operation or
  provider reports every count); `units` is JSONB for non-token-metered operations
  (`{ images: 2 }`, `{ audioSeconds: 31.4 }`).

## Operations Admin Settings Group

A third `ADMIN_SECTIONS` group (`apps/web/src/config/adminSections.tsx`),
alongside `General` and `Access` — issue #266, epic #254. `General` is
configuration an administrator *sets*; `Operations` is the running system: work
in flight, the machines executing it, and the copies of the data taken while it
ran. Six cards at `/admin/settings/*`, each gated on the exact permission its
controller enforces (Settings UI Pattern rule 3):

- **Jobs** (`/admin/settings/jobs`, `jobs:read`) and **Job Insights**
  (`/admin/settings/jobs/insights`, `jobs:read`, nested under Jobs)
- **Worker Nodes** (`/admin/settings/workers`, `nodes:read`)
- **Database Backup** (`/admin/settings/db-backup`, `db_backup:read`)
- **Broadcasts** (`/admin/settings/broadcasts`, `broadcasts:read`, epic #319)
- **About** (`/admin/settings/about`, `system_settings:read`, issue #401,
  epic #397) — what commit is running, when it was installed, and (since
  issue #392, epic #388) the deploy host, proxy runtime and history left by
  `appctl deploy`. `/admin/settings/deployment` redirects here: this card is
  the extension of the existing About feature the deployment-visibility work
  landed on, not a second destination — see
  [`docs/runbooks/deployment-info.md`](docs/runbooks/deployment-info.md).

All six read permissions are seeded Admin-only, so writes are gated inside
each page (disabling controls) rather than by a second card permission — the
card gate is about reachability, the page gates content; About has no write
side at all. `Maintenance` is a `General` card, not an `Operations` one — it
is a system setting, not a running-system view.

## AI Admin Settings Group

A fourth `ADMIN_SECTIONS` group, **appended** after `Operations` — issue #425,
epic #419, the same append-only rule `Broadcasts` and `About` already follow:
the hub, the rail and the drill-down list render this array in declaration
order, so an insertion would move every existing card for a reader who has
learnt where they are. Two cards at `/admin/settings/ai*`, both gated on
`ai_config:read` — the literal string `ai-admin.controller.ts` enforces on its
reads (Settings UI Pattern rule 3):

- **AI** (`/admin/settings/ai`, `ai_config:read`, no `feature`) — switches AI
  on for the deployment, chooses the key policy, and configures each
  provider. Deliberately carries no `feature: 'ai'`: it is the page an
  administrator switches AI **on** from, and gating it on AI already being on
  would make the switch unreachable in exactly the state it exists to change.
- **AI Models** (`/admin/settings/ai/models`, `ai_config:read`,
  `feature: 'ai'`) — nested under the AI route so `settingsPageTitle`'s
  longest-prefix rule titles it "AI Models" rather than "AI" (the Job
  Insights precedent). Feature-gated: a model catalog for a switched-off
  platform is a page about nothing.

Both cards gate writes internally (`ai_config:write`) rather than by a second
card permission, the same reachability-vs-content posture every other group
in this file takes. The per-user counterpart is the `AI Keys` card in
`USER_SETTINGS_SECTIONS` (`/settings/ai`, `permission: 'ai:use'`,
`feature: 'ai'`) — `ai:use` is seeded to all three roles, so this card is
gated by a real, withholdable grant rather than by role, and hidden while AI
is off by the identical `feature` mechanism. See
[`docs/specs/ai-platform.md`](docs/specs/ai-platform.md) and the MANDATORY AI
Platform Rules above.

## Access Control: Email Allowlist

The application uses an **email allowlist** to restrict access to pre-authorized users only.

### How It Works
1. Admins add email addresses to the allowlist before users can login
2. During OAuth login, the user's email is checked against the allowlist
3. If the email is not in the allowlist, login is denied with a clear error message
4. Exception: `INITIAL_ADMIN_EMAIL` always bypasses the allowlist check

### Configuration
- `INITIAL_ADMIN_EMAIL` environment variable grants initial admin access
- This email is automatically added to the allowlist during database seeding

### Admin Management
- Access allowlist management at `/admin/settings/users` (Allowlist tab; `/admin/users` still redirects here)
- Two tabs available:
  - **Users**: Manage existing registered users
  - **Allowlist**: Pre-authorize email addresses for future logins

### Status Tracking
- **Pending**: Email added to allowlist but user hasn't logged in yet
- **Claimed**: User has successfully logged in and created an account
- Claimed entries cannot be removed (prevents accidentally removing existing user access)

## Security Guidelines

- Secrets via environment variables only (see `.env.example`)
- JWT access tokens are short-lived (15 min default)
- Refresh tokens in HttpOnly cookies with rotation
- Input validation on all endpoints
- File uploads: images only, size/type limits, randomized filenames
- Email allowlist restricts application access to pre-authorized users

## Testing Requirements

- Unit tests: isolated logic (services, guards, validators)
- Integration tests: API + DB + RBAC flows with test DB
- Mock OAuth in CI (no real Google dependency)
- Frontend: component and hook tests

## Environment Variables

Key variables (see `infra/compose/.env.example` for full list):

**Application:**
- `NODE_ENV` - Environment (development/production)
- `PORT` - API port (default: 3000)
- `APP_URL` - Base URL (default: http://localhost:3535)

**Database (individual connection parameters):**
- `POSTGRES_HOST` - Database hostname (default: localhost)
- `POSTGRES_PORT` - Database port (default: 5432)
- `POSTGRES_USER` - Database user (default: postgres)
- `POSTGRES_PASSWORD` - Database password (default: postgres)
- `POSTGRES_DB` - Database name (default: appdb)
- `POSTGRES_SSL` - Enable SSL connection (default: false)

Note: `DATABASE_URL` is constructed automatically from these variables at runtime.

**Authentication:**
- `JWT_SECRET` - JWT signing secret (min 32 chars)
- `JWT_ACCESS_TTL_MINUTES` - Access token TTL (default: 15)
- `JWT_REFRESH_TTL_DAYS` - Refresh token TTL (default: 14)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - Google OAuth credentials
- `INITIAL_ADMIN_EMAIL` - First user with this email becomes Admin
- `DEVICE_CODE_EXPIRY_MINUTES` - Device code lifetime (default: 15)
- `DEVICE_CODE_POLL_INTERVAL` - Device polling interval in seconds (default: 5)
- `DEVICE_TOKEN_EXPIRY_DAYS` - Token lifetime for device sessions in days (default: 7)
- `DEVICE_PAT_EXPIRY_DAYS` - Lifetime of the PAT minted when a device (e.g. the CLI) requests `clientInfo.tokenType: "pat"`, in days; clamped to 1-999 (default: 90)
- `SECRETS_ENCRYPTION_KEY` - Base64-encoded 32-byte AES-256 key (generate with `openssl rand -base64 32`) that encrypts runtime-configured credentials (SMTP, Web Push, and — since epic #372 — the object-storage secret access key) before they are stored in the `credentials` table. Formally optional at boot until a credential is stored (see `docs/runbooks/rotate-secrets-encryption-key.md`); in practice required for a working deployment, since uploads, avatars and database backups all need the storage credential this key protects. Note: credentials configured at runtime through the UI/API live encrypted in the database, not in the environment — unlike every other secret in this section.

**Email (SES fallback only):**
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` - Credential for the SES email transport. **SES-only since epic #372** — before that, these two were shared with the (then env-var-configured) S3 storage provider; storage now has its own credential in the encrypted store and never reads these.
- `SES_REGION` - Fallback region for SES when `email.sesRegion` is not set in the settings namespace. **Replaces `S3_REGION`, which supplied this value before issue #377** — a deployment that relied on `S3_REGION` to region SES must set this instead. No default; an unset region fails as "SES region is not configured" rather than guessing wrong. See `infra/compose/.env.example`'s own comment on this key for why it must never appear as a second commented example line.

⚠ There is no `STORAGE_PROVIDER`/`S3_BUCKET`/`S3_REGION`/`S3_ENDPOINT` (or
equivalent) environment variable anywhere in this application, and there
must never be one again. Object storage — provider, bucket, region,
endpoint, credential — is configured entirely at runtime through
`/admin/settings/storage`, with no restart. See "Storage Configuration
(Admin-only)" and `storage_config:read`/`storage_config:write` above, and
[`docs/specs/storage-providers.md`](docs/specs/storage-providers.md) /
[`docs/runbooks/storage-configuration.md`](docs/runbooks/storage-configuration.md).

**Background Job Queue** (all bare/unprefixed, like `POSTGRES_*` — API-side vars never take
the CLI's `APPCTL_` prefix; see `infra/compose/.env.example` for the full comments):
- `JOBS_MAX_ATTEMPTS` - Attempts before a job is permanently `failed`, charged at claim time (default: 3)
- `JOBS_RETRY_BASE_MS` / `JOBS_RETRY_MAX_MS` - Retry backoff bounds, doubling with jitter (default: 2000 / 60000)
- `JOBS_RATELIMIT_MAX_HITS` - Times a job may be provider-rate-limited before giving up — a budget separate from `JOBS_MAX_ATTEMPTS` (default: 10)
- `JOBS_RATELIMIT_BASE_MS` / `JOBS_RATELIMIT_MAX_MS` - Rate-limit deferral backoff bounds (default: 30000 / 900000)
- `JOBS_WORKER_CONCURRENCY` - Jobs this process runs at once; fixed at startup (default: 2)
- `JOBS_POLL_MS` - Idle poll interval before asking for work again (default: 5000)
- `JOBS_WORKER_MODE` - `all` (every type — the default), `system` (only types no node may claim **in this deployment right now** — the complement of `NodeOffloadService.offeredTypes()`, so a node-eligible type whose gates are closed is still claimed here), or `off` (enqueue only); an unrecognised value warns and behaves as `all`
- `JOBS_JOB_TIMEOUT_MS` - Per-job timeout before the slot is freed and the job retries/fails (0 disables; default: 600000)
- `JOBS_SYSTEM_MODE_EXTRA_TYPES` - Comma-separated types the `system` worker mode should claim **in addition** to its complement — for running a type the fleet is also allowed to run (a small or paused fleet). Never needed to keep a type running at all: a node-eligible type this deployment does not offer to nodes is already in the complement. Unset by default
- `JOBS_REAPER_ENABLED` - Whether this process reclaims jobs abandoned by a dead executor; independent of `JOBS_WORKER_MODE`. Only the literal `false` turns it off (default: on)

**Worker Node Fleet:**
- `NODE_STALE_OFFLINE_ENABLED` - Whether this process marks a node offline once its heartbeat is older than `nodes.staleHeartbeatSeconds × nodes.offlineStaleMultiplier`. Only the literal `false` turns it off (default: on)
- `NODE_OFFLINE_PRUNE_ENABLED` - Whether this process forgets offline nodes past `nodes.offlineRetentionDays` (their jobs are unclaimed, not deleted). Depends on the sweep above being on. Only the literal `false` turns it off (default: on)
- `NODE_SECRET_SWEEP_ENABLED` - Whether this process runs the ten-minute cron that revokes expired or orphaned per-job credentials brokered to worker nodes (epic #345, issue #349) — the third permanent job-queue exemption (see the MANDATORY rules above). Only the literal `false` turns it off (default: on). Independent of `JOBS_WORKER_MODE`, like the lease reaper, and for the same reason: a credential brokered to a node in a fleet this process does not execute jobs for still needs revoking. Whether a credential is ever brokered **at all** is the separate `nodes.jobSecretBrokerEnabled` system setting, default off — see [`docs/runbooks/node-job-secrets.md`](docs/runbooks/node-job-secrets.md)

**Maintenance Mode:**
- `MAINTENANCE_MODE` - Environment override that outranks the persisted setting. Set to `true` to force the window open even if the app cannot start (a pre-migration deploy), or to `false` to force it shut (recovery from a window opened with `allowAdmins` false). Only the literal strings `'true'`/`'false'` count; anything else (including unset) means "no override, use the stored setting". Requires an application restart to take effect. See `docs/runbooks/maintenance-mode.md`. ⚠️ Document a value for this variable as prose ("set to `true`"), never as an inline `# MAINTENANCE_MODE=true` example — `apps/cli`'s `parseEnvExample` reads *any* commented `# KEY=value` line in `infra/compose/.env.example` as declaring an optional variable, so an illustrative assignment inside prose registers as a second declaration and fails the CLI's env-spec test. `infra/compose/.env.example` already carries exactly one commented default (`# MAINTENANCE_MODE=false`) and a comment stating this rule — do not add a second commented line for this key.

**Database Backup:**
- `DB_BACKUP_SCHEDULE_ENABLED` - Whether this process runs the backup scheduler: a ten-minute cron that enqueues the housekeeping sweep, starts a backup (by enqueuing `db.backup.run`) when the configured schedule has come due, and enqueues the retained-database drop. Defaults to on; only the literal `false` turns it off, and it is deliberately independent of `JOBS_WORKER_MODE` — the *tick* is not itself queue work (it only decides whether to enqueue), so an API running as a pure control plane must still queue its own backups even though `JOBS_WORKER_MODE=off` means nothing on this process will execute them. Everything about the schedule itself (enabled, frequency, time of day, timezone, retention count, stale window) is a `databaseBackup` system setting, not an environment variable — as is `nodeOffloadEnabled` (default **false**), which decides whether a worker node may take the dump at all. See `docs/specs/database-backup.md`.

**Observability:**
- `OTEL_ENABLED` - Enable OpenTelemetry (default: true)
- `OTEL_EXPORTER_OTLP_ENDPOINT` - OTEL Collector endpoint
- `UPTRACE_DSN` - Uptrace connection string

**AI Platform:**

There are no AI environment variables; AI is configured entirely at runtime,
with no restart, at `/admin/settings/ai` (epic #419). Do not add
`OPENAI_API_KEY` or any equivalent to `infra/compose/.env.example` — this is
the identical two-sources-of-truth rule already stated for object storage
above: the kill switch, key policy, provider enablement and the admin/org key
all live in the `ai` system-settings namespace plus `CredentialsService`
(purpose `'ai'`), resolved per call, never read from `process.env`. See
[`docs/specs/ai-platform.md`](docs/specs/ai-platform.md) §2 and §14's
rejected alternative, and
[`docs/runbooks/ai-configuration.md`](docs/runbooks/ai-configuration.md).

## Common Patterns

### Adding a New API Endpoint
1. Create controller method with decorators for auth/RBAC
2. Add service method with business logic
3. Update OpenAPI annotations
4. Add unit + integration tests
5. Update API.md if needed

### Adding a New Setting
1. Update Zod schema for validation
2. Add migration if schema structure changes
3. Update TypeScript types
4. Add frontend UI if user-facing

### Adding a Notification

Three steps, and no migration — the same "one registry entry" promise the
settings hub makes on its own axis (epic #109, wired end to end by #128).

1. **Declare the event** in `apps/api/src/notifications/notification-events.ts`
   (`NOTIFICATION_EVENTS`): a stable dotted `key` (`billing.invoice_ready`), a
   `label` and `description` written as user-facing copy, the `channels` it can
   genuinely be delivered over (`email`, `browser`), and `defaultEnabled`. Add
   `mandatory: true` only for events a user must not be able to silence — a
   privilege or security change. This one entry feeds the dispatcher, the
   `/settings/notifications` matrix and the docs; there is no second list to
   update, and no preference row is created for anybody (absent means enabled).

2. **Write the template(s)**, one per channel the event declares.
   - *Email*: a new `apps/api/src/email/templates/<name>.email.ts` exporting a
     payload interface and a pure function returning `{ subject, html, text }`.
     Build the body with the `html` tagged literal so every interpolation is
     escaped by construction, pass it to `renderLayout`, put any CTA URL
     through the layout (it applies `safeUrl`), and **hand-write the text
     part** — there is deliberately no HTML-to-text helper. Register it in
     `templates/index.ts` (`EmailTemplateDataMap` **and** `EMAIL_TEMPLATES`;
     the compiler rejects half a registration), then map the event key to the
     template name in `EVENT_EMAIL_TEMPLATES`
     (`notifications/channels/email-notification.channel.ts`). A missing entry
     is a recorded delivery failure, not a silent skip.
   - *Browser*: an entry in `EVENT_BROWSER_TEMPLATES`
     (`notifications/channels/browser-notification.channel.ts`) returning
     `{ title, body, link? }`. Optional — a miss falls back to the registry's
     label and description. `link` must be a root-relative path.
   - `test-email.email.ts` and `role-changed.email.ts` are the worked examples.

3. **Call `notify()` at the real trigger**, from a service whose module
   `imports: [NotificationsModule]`:

   ```ts
   await this.notifications.notify('billing.invoice_ready', userId, payload);
   ```

   Place it **after** the triggering write has committed and **outside** any
   `$transaction`. `notify` is detached — it schedules the dispatch and returns
   before anything is rendered or sent — so it never rejects, never joins your
   transaction, and never delays your response; a send failure becomes a
   `notification_deliveries` row, never an exception. Annotate the payload with
   the template's data type: `notify` takes `data: unknown`, so the call site is
   the only place its shape is checked.

   For a recipient who has **no user account** (an allowlist invitation), use
   `notifyAddress(eventKey, email, payload)`. It resolves the address to an
   account when one exists — so real users' preferences are never skipped — and
   otherwise dispatches through the same gate with no stored preferences, which
   the sparse absent-key contract already defines as "use the event's default".

Live examples of all three steps: `AuthService.handleGoogleLogin`
(`user.welcome`), `AllowlistService.addEmail` (`allowlist.invitation`), and
`UsersService.updateUserRoles` (`security.role_changed`, mandatory).

Epic #254's four operational events (`jobs.job_failed`, `nodes.node_offline`,
`db_backup.backup_failed`, `db_backup.restore_completed` — the last one
`mandatory: true`) are worked examples of this same recipe, registered in
`notification-events.ts` beside the ones above; see the events' own
in-file comments and `docs/specs/browser-notifications.md`'s operational-events
section for why no roll-up/digest exists for `jobs.job_failed`.

### Adding a Job Type

One class, self-register, add to your module, enqueue — the same "one
registry entry" shape as Adding a Notification above, and no migration:
`Job.type` is a plain string column precisely so a new handler costs zero
schema change (epic #254). Full recipe, with a live node-eligible example, is
[`apps/api/src/jobs/handlers/README.md`](apps/api/src/jobs/handlers/README.md);
this is the summary.

1. **Implement `JobHandler`** (`apps/api/src/jobs/job-handler.interface.ts`):
   a `readonly type` string (dotted, lowercase, product-neutral, e.g.
   `'export.csv'` — **permanent** once jobs of that type exist) and an async
   `process(job): Promise<void>`. **Throw to fail** — there is no result
   object; a thrown error becomes `Job.lastError` plus a retry, a normal
   return means the work committed and is durable. Be idempotent where you
   can: the queue is at-least-once, never exactly-once.

2. **Self-register** from `onModuleInit()`:
   ```ts
   onModuleInit(): void {
     this.registry.register(this);
   }
   ```
   There is no decorator and no central dispatch table — this one line is the
   entire mechanism. A duplicate `type` overwrites the earlier registration
   and logs a warning (a fork deliberately shadowing a framework handler).

3. **Add it as a provider** in the module that owns the feature, importing
   `JobsModule` for the registry:
   ```ts
   @Module({ imports: [JobsModule], providers: [MyHandler] })
   export class MyFeatureModule {}
   ```

4. **Enqueue** via `JobsService` (exported by `JobsModule`):
   ```ts
   await this.jobs.enqueue({
     type: 'my-feature.do-the-thing',
     reason: 'upload',
     subjectType: 'storage_object',
     subjectId: object.id,
     payload: { objectId: object.id },
   });
   ```
   `payload` is opaque JSONB — keep it to identifiers, not copies of data, so
   a job run minutes later re-reads current state. Enqueueing the same
   `type` + subject twice is deduplicated for free while an earlier job is
   `pending`/`running`; pass `skipDedup: true` when several jobs against the
   same subject are legitimately distinct work.

The type then **appears in the admin dashboard automatically** —
`JobHandlerRegistry.types()` drives it, no migration, no enum, no queue
wiring. Add a friendly label in `job-type-labels.ts` if you want one (optional
polish; an unmapped type renders as its raw string, never blank).

**Node eligibility — what makes a type node-eligible, precisely:** a handler
carries **both** `nodeResultSchema` (a Zod schema validating what a remote
worker node posts back) and `persistNodeResult(job, result): Promise<void>`
(writes an *already-validated* result down — persist only, never
recomputation, never a second call to whatever provider the node used), or
**neither** — never exactly one; a schema with no persist function describes
a payload nobody can store, and a persist function with no schema would trust
an unvalidated remote body. There is deliberately no `nodeEligible: boolean`
flag: deriving eligibility from the two members makes an inconsistent state
unrepresentable, and `JobHandlerRegistry.serverOnlyTypes()` is that
derivation — it is what the `system` worker mode and the node claim endpoint
both read, so a type missing either member is one **no node can ever claim**.

`example-echo.handler.ts` and `example-checksum.handler.ts` are the two
worked examples, and the difference between them **is** the eligibility
line above: `example.echo` is server-only — it implements only `process`,
logs its payload, and returns. `example.checksum` (#269) implements both
`process` (server path) *and* `nodeResultSchema` +
`persistNodeResult` (node path), routing both through one private write
method so a job's stored result cannot depend on which executor claimed it —
that "one write, two paths" shape is the one thing to copy when writing a
node-eligible handler of your own.

Five more optional members, all on `JobHandler`, each following the same
"presence is the declaration" rule as the pair above — implement one only
when the default is genuinely wrong for this type (see the MANDATORY rules
above for the first two as binding policy, not just options):

- `profile?: { maxRuntimeMs, maxAttempts }` — overrides the deployment-wide
  `JOBS_JOB_TIMEOUT_MS`/`JOBS_MAX_ATTEMPTS` for this type alone. Declare it for
  a type that legitimately runs for hours (`maxRuntimeMs`) or must never be
  auto-retried (`maxAttempts: 1`). The lease and its renewal interval are
  *derived* from `maxRuntimeMs` — do not add a third field.
- `deriveOutputKey?(job)` — overrides the node data plane's default upload key
  (`node-outputs/<jobId>/<uuid>`) when the artifact's location is part of its
  contract (a row records the key, a retention sweep lists a prefix). Must be
  idempotent per job — re-derive from values already fixed on the job, or
  re-read the row this job's first call already created.
- `nodeOffloadEnabled?(): Promise<boolean>` — a runtime policy read (not a
  static flag) letting a deployment say "not this workload" about a type that
  is structurally node-eligible. Read at claim time by
  `NodesService.nodeEligibleTypes`; never changes what `serverOnlyTypes()`
  reports.
- `nodeSecretBroker?: JobSecretBroker` — declares that a remote executor of
  this type needs a credential, and how to mint/revoke one. See MANDATORY
  rule 3 above and `apps/api/src/jobs/job-secret-broker.ts`.
- `canDelete?(job): Promise<string | null>` — a reason to refuse an admin
  delete of this job (`DELETE /api/admin/jobs/{id}`), or `null` to allow.
  Implement it only when a non-terminal row of this type is load-bearing for
  state the feature keeps outside the `jobs` table; return `null` once the
  job is terminal. A cheap read, never a write — and a throw refuses the
  delete (fail closed). The broadcast start/chunk handlers are the worked
  example (issue #480).

`db-backup/handlers/db-backup-run.handler.ts` (`db.backup.run`, epic #345) is the
worked example that uses all four: a `profile` sized for a multi-hour dump
with `maxAttempts: 1`, `deriveOutputKey` re-reading the backup's own run row,
`nodeOffloadEnabled` reading `databaseBackup.nodeOffloadEnabled`, and
`nodeSecretBroker` minting a short-lived read-only PostgreSQL role. See
[`docs/specs/job-queue.md`](docs/specs/job-queue.md) and
[`docs/specs/worker-nodes.md`](docs/specs/worker-nodes.md) for the full design
— the claim's `FOR UPDATE SKIP LOCKED`, the lease, the data plane's presigned
URLs, and the rejected alternatives.

### Using AI in a Feature

The AI platform (epic #419) is documented in full in
[`docs/specs/ai-platform.md`](docs/specs/ai-platform.md) and
[`apps/api/src/ai/README.md`](apps/api/src/ai/README.md); this is the
day-to-day recipe. Import `AiModule`, inject `AiService`, and call
`forUser(userId)`:

```ts
@Module({ imports: [AiModule], providers: [MyFeatureService] })
export class MyFeatureModule {}
```

```ts
constructor(private readonly ai: AiService) {}

async summarize(userId: string, text: string) {
  const res = await this.ai.forUser(userId).respond({ input: `Summarise: ${text}` });
  return res.outputText;
}
```

No SDK, no key, no policy check of your own — `forUser` runs the full gate
pipeline (kill switch, provider/model enablement, capability match, key
resolution, output-token clamp), records one `ai_usage_events` row per
round-trip, and traces the call. Six entry points, all on the client
`forUser` returns:

- **`respond(req, opts?)`** — one response. `req.input` is a string or
  `AiInputItem[]` (text/image/file parts); `opts.signal` aborts it.
- **`stream(req, opts?)`** — an `AsyncIterable<AiStreamEvent>`. Lazy: a gate
  or pre-stream provider failure surfaces on the first iteration. Use this
  for an in-process consumer that is already committed to iterating.
- **`openStream(req, opts?)`** — the SSE-route form: the returned promise
  itself rejects with the `AiError` for anything that fails *before* the
  first event, so an HTTP handler can answer it as an ordinary JSON error
  rather than an in-band frame; after that, iterate exactly like `stream`.
- **`respondStructured({ schema, schemaName?, strict?, ...req }, opts?)`** —
  `schema` is a Zod schema; `parsed` on the result is typed and always
  present, or the call throws `AiError('AI_STRUCTURED_OUTPUT_INVALID')`.

  ```ts
  const weather = z.object({ city: z.string(), tempC: z.number() });
  const { parsed } = await this.ai.forUser(userId).respondStructured({
    schema: weather,
    input: 'What is the weather in Paris right now, roughly?',
  });
  ```
- **`runTools({ input, tools, maxSteps? }, opts?)`** — the function-calling
  agent loop (up to 8 gated round-trips by default, max 20). Define a tool
  with `defineTool` (`ai/core/tools.ts`) — one Zod schema doubles as the
  provider-facing JSON Schema and the validation of the model's arguments:

  ```ts
  const getWeather = defineTool({
    name: 'get_weather',
    description: 'Look up the current weather for a city.',
    parameters: z.object({ city: z.string() }),
    execute: async ({ city }, ctx) => lookupWeather(city, ctx.userId),
  });

  const result = await this.ai.forUser(userId).runTools({
    input: 'What is the weather in Paris?',
    tools: [getWeather.tool],
  });
  ```
- **`startRun(req)`** — queues the request as a background `ai.response.run`
  job and returns `{ runId, jobId }` at once; poll with
  `AiRunsService.get(userId, runId)` / cancel with `.cancel(...)`. Throws
  `AiError('AI_INVALID_REQUEST')` for a function tool (it cannot survive the
  queue hop — use `runTools` in-process instead) or when
  `ai.defaults.allowBackgroundRuns` is off.

**Picking a model**: pass `req.model` (and `req.provider` when more than one
is registered) to pin it, or leave both unset to fall back to the caller's
own `user_settings.ai.defaultModel` — `AiService` resolves this the same way
either path is called, so a feature never re-implements the fallback.

**Handling `AiError`**: every failure this platform can produce is an
`AiError` with a stable `.code` (never a raw provider SDK error) — catch it
and switch on `.code`, not on `err.message`, which is deliberately generic
for anything wrapping a caught SDK error. `docs/specs/ai-platform.md` §13
has the full table (`AI_DISABLED`, `AI_KEY_REQUIRED`, `AI_MODEL_NOT_ENABLED`,
`AI_CAPABILITY_UNSUPPORTED`, `AI_RATE_LIMITED`, …); a job handler does
`throw err.toRateLimitError() ?? err;` so a provider throttle defers the job
rather than charging an attempt, the same idiom `RateLimitError` already
uses elsewhere in this codebase.

### Adding an AI Provider

A second (or third) provider is an adapter implementation against the
existing contract, never a platform change — see
[`docs/specs/ai-platform.md`](docs/specs/ai-platform.md) §14 for the full
design; this is the summary, and `apps/api/src/ai/providers/openai/` is the
one worked example today.

1. **Implement `AiProviderAdapter`** (`ai/core/provider-adapter.interface.ts`)
   in its own `apps/api/src/ai/providers/<provider>/` folder: `id` (permanent
   once jobs/usage/keys reference it), `displayName`, `listModels`,
   `verifyKey`, `classifyModel`, and whichever capability ports
   (`responses`, `images`, `audio`, `embeddings`, `realtime`) the provider
   genuinely supports — **presence is the declaration**, exactly like
   `JobHandler.nodeResultSchema`/`persistNodeResult`; there is no
   `supportsImages: boolean` to disagree with the code.
2. **Self-register** from `onModuleInit()`:
   ```ts
   onModuleInit(): void {
     this.registry.register(this);
   }
   ```
   `AiProviderRegistry` mirrors `JobHandlerRegistry` deliberately: explicit
   registration, last registration wins with a warning, one pattern to
   learn across both registries.
3. **Write a classifier** for `classifyModel` — a curated, per-provider
   pattern match against known model-id shapes, returning
   `AiModelCapabilities` (`ai/core/capabilities.ts`) or `null` for an id the
   classifier does not recognize. Hand-curated on purpose: guessing a
   model's capabilities wrong is worse than an honest "unclassified, an
   administrator should look at this" (`capabilitySource: 'unclassified'`).
4. **Map the adapter's own errors onto `AiErrorCode`** (`ai/core/ai-error.ts`)
   — no SDK error may ever escape an adapter; wrap with `AiError.wrap(err,
   code, message)` or throw a specific `AiError` directly. `AiError`'s
   `cause` is stored non-enumerable specifically so an SDK error that echoes
   request headers or a masked key in its message never reaches
   `JSON.stringify` or a structured log line.
5. **Run the conformance kit** (`describeAiProviderConformance`,
   `apps/api/src/ai/testing/conformance.ts`) against the new adapter. It
   asserts, uniformly across every provider, that `listModels` returns ids,
   `verifyKey`'s ok/invalid mapping is correct, `classifyModel` returns
   schema-valid capabilities or `null`, and — if `responses` is implemented
   — `create`/`stream`/structured output/a tool round-trip all behave, and
   every error surfaces as an `AiError`, never a raw SDK exception.
6. **Register the provider id.** Add it to `AI_PROVIDER_IDS`
   (`common/schemas/settings.schema.ts`) — a growing, code-owned list, not a
   closed set — so the `ai.providers.<id>` settings slot and the admin UI's
   provider list both recognize it, and add the new provider module
   (`<provider>.module.ts`) to `AiModule`'s `imports`.

Nothing about the registry, the gate pipeline, the admin API or the HTTP
surface changes to add a provider — they already operate on
`AiProviderAdapter` and `AiProviderRegistry.ids()`.

### Worker Node Fleet, Maintenance Mode

Distributed worker nodes (server + CLI + container + TUI) and the maintenance
window are the rest of epic #254 (issues #257, #266–#282). Nothing about
either needs restating here beyond the endpoint groups, permissions, tables
and environment variables already listed above in their own sections. The
design (registration, the claim/lease/data-plane mechanics, capability
probing, heap tuning, the fleet health sweep) is
[`docs/specs/worker-nodes.md`](docs/specs/worker-nodes.md); the operator guide
is [`docs/deployment/worker-nodes.md`](docs/deployment/worker-nodes.md); the
CLI's `node` command reference is
[`apps/cli/README.md`](apps/cli/README.md#running-a-worker-node). Maintenance
mode's design (why no new permission, the environment/memory/persisted layer
precedence, the `allowAdmins: false` break-glass) is
[`docs/specs/maintenance-mode.md`](docs/specs/maintenance-mode.md); the
operator runbook is
[`docs/runbooks/maintenance-mode.md`](docs/runbooks/maintenance-mode.md).

### Browser Notifications and Web Push

OS-level browser notifications — a service worker precaching the app shell
and hosting the `push`/`notificationclick` handlers Android requires, a
brand-parameterized PWA manifest, an 8-state notification capability model,
an admin kill switch that mutes the OS toast without ever muting the durable
`notifications` row, and Web Push behind a VAPID key pair that ships disabled
by default — is epic #215 (issues #216–#233). The design decisions that
shape this area (why `injectManifest` over `generateSW`, why the service
worker must never call the API, why `sw.js` must be served `no-cache`, why a
non-admin learns the toggle from `GET /api/notifications/config` rather than
`system_settings`, why nothing under `/api` is ever precached) are documented
in full, with rationale and rejected alternatives, in
[`docs/specs/browser-notifications.md`](docs/specs/browser-notifications.md).
Generating, enabling, rotating, and disabling VAPID keys is
[`docs/runbooks/vapid-keys.md`](docs/runbooks/vapid-keys.md). Since issue #355
this is also runtime-configurable, live, with no restart, through an admin UI
at `/admin/settings/push`. Don't restate either here; extend those two
instead.

### Admin Notification Broadcasts

Sending a message to every active user — composed in the app, sent now or
scheduled, over whichever of email/in-app/push the deployment supports — is
epic #319 (issues #320–#325), gated by the `broadcasts:read` /
`broadcasts:write` permission pair, raised through two registry events
(`admin.broadcast`, muteable; `admin.broadcast_critical`, `mandatory: true`),
and fanned out over two job types (`admin.broadcast.start`,
`admin.broadcast.chunk`) rather than a new scheduler or a second notification
system. A chunk or start job that fails permanently flips its broadcast
`sending` -> `failed` via a `job.settled` listener (`BroadcastFailureListener`,
issue #459), and `POST /api/admin/broadcasts/:id/resume` (`broadcasts:write`)
continues it from its committed cursor. The admin API lives under
`/api/admin/broadcasts`; the settings surface is the `Broadcasts` card at
`/admin/settings/broadcasts`. The design
decisions this rests on (why two event keys and not a per-send flag, why the
per-broadcast channel choice can only narrow and where the `critical ⇒
browser` rule is actually enforced, why the audience is frozen at a cutoff,
why fan-out chunks must be enqueued with `skipDedup: true`, why `notifyNow()`
exists beside the detached `notify()`) are documented in full, with
rationale and rejected alternatives, in
[`docs/specs/notification-broadcasts.md`](docs/specs/notification-broadcasts.md).
Don't restate any of that here; extend that file instead.

### Database Backups

A backup **is** a queue job (`db.backup.run`, epic #345) and may be claimed by
a worker node — but `database_backup_runs` is still **not** a `jobs` row and
must not become one. `jobs.stuckThresholdMinutes` defaults to 30 minutes, so a
run kept on the queue's own clock would be reset to `pending` mid-dump and a
**second `pg_dump`** would start against the same storage key; the job survives
that only because `db.backup.run` declares its own `maxRuntimeMs` and the lease
is derived from it. `database_backup_runs` remains a dedicated table with its
own heartbeat, its own stale window (`databaseBackup.runStaleMinutes`) and its
own terminal states — and because a node cannot write that heartbeat at all,
the stale sweep asks the JOB's lease before giving up on a run. Two more
rules that are easy to break by accident: **at most one active run at a time
is enforced by a partial UNIQUE index** (`database_backup_runs_active_uniq_idx`),
never by a `findFirst` before the insert — Prisma cannot express that index,
so it lives hand-written in the migration and is intentional schema drift; and
**the archive is never buffered** — `pg_dump`'s stdout streams straight into
object storage through a metering `Transform`, with both the upload and the
dump's exit code awaited, because either one alone will happily report success
on a truncated archive.

The design (the model, why the restore audit lives on the backup's own row,
the streaming contract, the read-it-back verification, the failure ordering,
cancellation, the storage-provider constraint, and the rejected alternatives)
is documented in full in
[`docs/specs/database-backup.md`](docs/specs/database-backup.md). Diagnosing a
`pg_dump` client/server version mismatch is
[`docs/runbooks/postgres-client-version.md`](docs/runbooks/postgres-client-version.md).
Don't restate either here; extend those two instead.

Running the dump on a worker node needs a database connection, and no amount of
presigning produces one. `db-backup/pg-job-role.broker.ts` is the first
`JobSecretBroker` in this repository (epic #345): per job it mints a
`appjob_<job>_<random>` login role holding `CONNECT` + `USAGE` + `SELECT` and
nothing else, `VALID UNTIL` the job's lease + 60s, through `withAdminConnection`
outside the Prisma pool. `pg_dump` **does not need `SUPERUSER`** — `--no-owner
--no-acl` keeps ownership and grants out of the archive, so a SELECT-only role
produces the same bytes. Three layers bound a grant: the settle listener, the
sweeper, and `VALID UNTIL`, which PostgreSQL enforces itself and which no
switched-off cron can miss. A role without `CREATEROLE` is the **ordinary**
managed-PostgreSQL case and answers `guided` with paste-ready SQL, never a 4xx.
A node also needs a **network route** to PostgreSQL; there is deliberately no
tunnelling, because that would put the API in the data path the presigned-URL
data plane exists to keep it out of. Operator guide:
[`docs/runbooks/node-job-secrets.md`](docs/runbooks/node-job-secrets.md).

The type is **offered** to a node only when three things agree, all intersected
at claim time and none of them mutating the registry: `nodes
.jobSecretBrokerEnabled` (may the broker issue anything), `databaseBackup
.nodeOffloadEnabled` (may this workload leave the server — default false, and a
deliberately separate switch), and the broker's own `usable()` probe (can it
mint here at all). Verification never moves with the work: the node reports a
size, a digest and the key it was given, and the **server** reads the uploaded
archive back before setting `verified_at`. `docs/specs/database-backup.md` §16
carries the whole design, including why `bytes` crosses the wire as a decimal
string.

Restoring one is the other half, and it has two rules of its own. **No
pre-flight path may create, drop or rename anything** — an operator asks "can
I restore this?" precisely when they have not decided to. And **the cluster
admin connection lives outside the Prisma pool**, on the `postgres`
maintenance database: those pooled connections are exactly what must be gone
before a rename can succeed, and a database cannot be renamed from a session
connected to it. A capability gate that fails (managed PostgreSQL denying
`CREATEDB` is the ordinary case) answers with a ready-to-paste command block
rather than a 4xx — that `guided` outcome is a designed-in path, not a
fallback. The gates, the three outcomes, the identifier and name-builder
rules, and the rejected alternatives are in
[`docs/specs/database-restore.md`](docs/specs/database-restore.md); the
operator procedure, written to be usable with the application down, is
[`docs/runbooks/database-restore.md`](docs/runbooks/database-restore.md).
Extend those two rather than restating them here.

### Object Storage

Which object-storage provider (AWS S3, Cloudflare R2, or an S3-compatible
endpoint), bucket and credential this deployment uses is
administrator-editable at runtime, with no restart, since epic #372 (issues
#373–#377): a `storage` system-settings namespace plus an encrypted secret,
resolved per call by `StorageConfigService`, behind the unchanged
`STORAGE_PROVIDER` token every existing consumer already injects. There is
no environment variable for any of it — `STORAGE_PROVIDER`/`S3_BUCKET`/
`S3_REGION`/`S3_ENDPOINT` were retired by issue #377, and adding any of them
back is exactly the two-sources-of-truth ambiguity this epic exists to end.
The design (the settings/secret split and why, the resolver's cache and its
synchronous `getBucket()` snapshot, one driver for three provider shapes,
tri-state `forcePathStyle`, the admin API's two probes and why they always
answer `200`, the switch confirmation and what it does not do, the
unconfigured-503 posture, and the rejected alternatives) is documented in
full in [`docs/specs/storage-providers.md`](docs/specs/storage-providers.md);
the operator runbook — first-time setup per provider, creating the bucket,
rotating a key with no restart, and recovering from a misconfigured or
accidentally switched deployment — is
[`docs/runbooks/storage-configuration.md`](docs/runbooks/storage-configuration.md).
Don't restate either here; extend those two instead.

## Specialized Subagents (MANDATORY)

**CRITICAL REQUIREMENT**: This project uses specialized subagents for all development work. You MUST delegate tasks to the appropriate subagent. Do NOT attempt to perform development tasks directly without using the designated agent.

### Why Subagents Are Mandatory
- Each agent contains domain-specific knowledge from the System Specification
- Agents ensure consistent patterns and conventions across the codebase
- Agents have the full context needed for their specialized area
- Direct implementation without agents risks missing requirements

### Available Agents

| Agent | Domain | MUST Use For |
|-------|--------|--------------|
| `backend-dev` | NestJS API, Fastify, auth, RBAC | **ANY** backend code: endpoints, services, guards, middleware, JWT, OAuth |
| `frontend-dev` | React, MUI, TypeScript | **ANY** frontend code: components, pages, hooks, theming, responsive design |
| `database-dev` | PostgreSQL, Prisma | **ANY** database work: schema changes, migrations, seeds, queries |
| `testing-dev` | Jest/Supertest (API), Vitest/RTL (web) | **ANY** testing: unit tests, integration tests, typecheck, test fixtures |
| `docs-dev` | Technical documentation | **ANY** documentation: ARCHITECTURE.md, SECURITY.md, API.md, README updates |
| `ops-dev` | Routine operations (Haiku) | Rebuilding/restarting containers, running Prisma migrations, running typecheck. NEVER for state-changing git operations |

### Mandatory Delegation Rules

1. **Backend code changes** → ALWAYS use `backend-dev`
2. **Frontend code changes** → ALWAYS use `frontend-dev`
3. **Database/Prisma changes** → ALWAYS use `database-dev`
4. **Writing or updating tests** → ALWAYS use `testing-dev`
5. **Documentation updates** → ALWAYS use `docs-dev`
6. **Routine ops (container rebuilds, migrations, typecheck)** → use `ops-dev`. IMPORTANT: `ops-dev` must NEVER perform state-changing git operations (pull, merge, push, commit, worktree management, branch operations) — those are always handled by the main agent directly, and `ops-dev` is instructed to refuse them

### Multi-Domain Tasks

For tasks spanning multiple domains, you MUST invoke multiple agents sequentially:

**Example: "Add a new user preference setting"**
1. `database-dev` → Add migration for schema change
2. `backend-dev` → Implement API endpoint
3. `frontend-dev` → Build UI component
4. `testing-dev` → Write tests for all layers
5. `docs-dev` → Update API documentation

### Usage Examples
```
# Backend work - MUST use backend-dev
"Use backend-dev to implement the user settings endpoint"

# Frontend work - MUST use frontend-dev
"Use frontend-dev to create the theme toggle component"

# Database work - MUST use database-dev
"Use database-dev to add audit_events table migration"

# Testing work - MUST use testing-dev
"Use testing-dev to write integration tests for auth"

# Documentation work - MUST use docs-dev
"Use docs-dev to update SECURITY.md with new auth flow"

# Routine ops - use ops-dev (never for git operations)
"Use ops-dev to rebuild the api container and run migrations"
```

### What You Should NOT Do Directly
- Do NOT write NestJS controllers, services, or guards without `backend-dev`
- Do NOT create React components or pages without `frontend-dev`
- Do NOT modify Prisma schema or create migrations without `database-dev`
- Do NOT write Jest/Vitest/RTL tests without `testing-dev`
- Do NOT update documentation files without `docs-dev`

The only exceptions are:
- Reading files to understand context
- Answering questions about the codebase
- Planning and coordination between agents
- Running simple commands (git status, npm install, etc.)
