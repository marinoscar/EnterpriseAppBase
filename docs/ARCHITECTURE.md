# Architecture

Last reviewed: 2026-09

## Contents

1. [Purpose and audience](#1-purpose-and-audience)
2. [System overview](#2-system-overview)
3. [Architecture principles](#3-architecture-principles)
4. [Technology stack](#4-technology-stack)
5. [Subsystem map](#5-subsystem-map)
6. [Data architecture](#6-data-architecture)
7. [Authorization](#7-authorization)
8. [Background work](#8-background-work)
9. [Frontend architecture](#9-frontend-architecture)
10. [Infrastructure](#10-infrastructure)
11. [Observability](#11-observability)
12. [Extension points](#12-extension-points)
13. [Related documents](#13-related-documents)

---

## 1. Purpose and audience

This repository is a template. You fork it to start a new enterprise web application on a production-grade foundation instead of an empty folder.

It establishes sign-in (Google OAuth, JWT, an email allowlist), role-based authorization, a registry-driven settings framework, object storage, a PostgreSQL-backed job queue with optional remote worker nodes, notifications, database backup and restore, an admin-governed AI platform, a first-party CLI, and OpenTelemetry observability backed by GreptimeDB.

This document is the map of how those pieces fit together today. It is written for a team (people and coding agents) that has just forked the template. Design rationale lives in `docs/specs/`; operator procedures live in `docs/runbooks/`. Each subsystem below links to both.

---

## 2. System overview

### 2.1 Components

```
   Browser (React SPA)       appctl CLI              Worker nodes (appctl node)
          │                      │                       │               │
          │ session JWT          │ pat_ token            │ nod_ token    │ presigned
          │                      │                       │ /api/nodes/*  │ GET / PUT
          ▼                      ▼                       ▼               │
   ┌──────────────────────────────────────────────────────────┐         │
   │ nginx :3535   security headers, same-origin routing       │         │
   │   /          → web                                        │         │
   │   /api       → api   (SSE routes unbuffered)              │         │
   │   /api/docs  → api   (Scalar API reference)               │         │
   └────────┬──────────────────────────────┬──────────────────┘         │
            │                              │                            │
   ┌────────▼─────────┐       ┌────────────▼─────────────────────┐      │
   │ web              │       │ api   NestJS + Fastify  :3000     │      │
   │ React 19 + MUI   │       │ controllers → services → Prisma   │      │
   │ (Vite build)     │       │ in-process job worker pool        │      │
   └──────────────────┘       └──┬────────┬────────┬────────┬────┘      │
                                 │        │        │        │           │
                                 ▼        │        ▼        ▼           │
                          PostgreSQL 16   │   AI providers  SMTP / SES, │
                          (data, job      │   (server-side  Web Push    │
                           queue, JSONB   │    calls only)              │
                           settings)      ▼                             │
                                   Object storage  ◄────────────────────┘
                                   (AWS S3, Cloudflare R2, S3-compatible)

   api ── OTLP ──► otel-collector ──► GreptimeDB :4000/:4003  (telemetry.compose.yml)
```

- The browser, the CLI and worker nodes all reach the API through nginx on one origin.
- The API is the only component that talks to AI providers, email and Web Push, and the only one with long-lived database access.
- Worker nodes hold no durable database or storage credential. They claim jobs over `/api/nodes/*` and move bytes directly against object storage through short-lived presigned URLs the API mints per job. A job that needs a database connection (the backup) receives a short-lived, job-scoped credential instead.
- Telemetry leaves the API over OTLP to an OpenTelemetry Collector, which redacts credential-bearing headers and exports to GreptimeDB (`telemetry.compose.yml`); the API reads it back over the PostgreSQL wire protocol for the telemetry explorer and AI assistant. The collector also scrapes the application's PostgreSQL itself (`postgresql` receiver, `POSTGRES_MONITOR_USER`), so database metrics land in the same store; it probes uptime and TLS expiry (`httpcheck`) and reads nginx's internal-only `stub_status` (`nginx`). See [specs/telemetry.md](specs/telemetry.md).

### 2.2 Request lifecycle

Every API request passes through the same stages, in this order:

| # | Stage | Where | What it does |
|---|---|---|---|
| 1 | nginx | `infra/nginx/nginx.conf` | Adds security headers, routes `/api` to the API. `/api/notifications/stream` and `/api/ai/responses/stream` are unbuffered for SSE. |
| 2 | Request ID | `apps/api/src/common/middleware/request-id.middleware.ts` | Assigns a request ID and captures trace context for log correlation. |
| 3 | Maintenance gate | `apps/api/src/common/maintenance/maintenance.guard.ts` | The application's only global guard (`APP_GUARD`). Answers `503` while a maintenance window is open, except on routes marked `@AllowDuringMaintenance()`. |
| 4 | Feature gate | `apps/api/src/ai/…` (`AiEnabledGuard`) | Controller-level, on `/api/ai/*` consumer controllers only. Answers `403 AI_DISABLED` while AI is switched off. |
| 5 | Authentication | `apps/api/src/auth/guards/jwt-auth.guard.ts` | Applied by `@Auth()`. Accepts a session JWT, a `pat_` personal access token, or a `nod_` node credential (confined to `/api/nodes/*`). Rejects deactivated users and a credential whose org is no longer an active membership (#724). Sets `request.user` (the loaded graph) and `request.principal` (ADR 0001's `Principal`: user id, `activeOrgId` (absent for a system-scoped node), memberships with role and status, roles, permissions, credential kind `session`/`device`/`pat`/`node`), read with `@CurrentUser()` and `@CurrentPrincipal()`. Skipped on routes marked `@Public()`. |
| 6 | Roles | `apps/api/src/auth/guards/roles.guard.ts` | Applied by `@Auth({ roles })`. The caller needs any one listed role. |
| 7 | Permissions | `apps/api/src/auth/guards/permissions.guard.ts` | Applied by `@Auth({ permissions })`. The caller needs all listed permissions, read from `request.principal.permissions` (the active org's). |
| 8 | Interceptors and validation | `LoggingInterceptor`, `TransformInterceptor`, `ZodValidationPipe` | Logs the request, validates input against Zod schemas, wraps success bodies in `{ data, meta }`. |
| 9 | Controller → service → Prisma | `apps/api/src/<module>/` | Controllers stay thin; services hold business logic and ownership checks; Prisma is the only data access path. A handler that touches tenant data takes the active organization with `@CurrentOrg()` (`principal.activeOrgId`) and its service reads and writes through `PrismaService.forOrg(orgId)` / `runInOrg(orgId, fn)`, which set `app.org_id` transaction-locally as the first statement; PostgreSQL row-level security then shows the transaction that organization's rows only (#725; [SECURITY-ARCHITECTURE.md §18](SECURITY-ARCHITECTURE.md#18-tenant-isolation-rls)). A job carries `orgId` in its payload and does the same. |
| 10 | Exception filter | `HttpExceptionFilter` | Formats every error into the standard error envelope. |

`@Auth()` (`apps/api/src/auth/decorators/auth.decorator.ts`) also stamps the enforced roles and permissions onto the OpenAPI operation, so the "Requires" line in the API reference is generated from the same metadata the guards read. Response envelopes, pagination and error codes are described in [API.md](API.md).

---

## 3. Architecture principles

**Separation of concerns.** The web app renders and collects input; the API owns every business rule and every authorization decision. A permission check in the UI only decides what to show. The API enforces it again. See [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md).

**Same-origin hosting.** nginx serves the UI at `/`, the API at `/api` and the API reference at `/api/docs`. There is no CORS configuration to maintain, and the refresh-token cookie is first-party.

**API-first.** Every capability exists as an HTTP endpoint before it has a UI. The OpenAPI document is generated from the code (`npm run openapi:dump`), linted by Spectral in CI, and served by Scalar at `/api/docs`. It is the per-endpoint reference. See [API.md](API.md).

**Security by default.** Controllers apply `@Auth()` with the exact permission they need; public routes are marked `@Public()` explicitly. Secrets never reach the browser, and runtime-configured secrets are encrypted at rest. See [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md).

**Every long-running activity is a queue job.** Work that outlives the request or cron tick that started it is a registered `JobHandler`, enqueued through `JobsService`. A `@Cron` only decides whether work is due and enqueues it. Three recovery crons are the permanent exceptions (see [§8.3](#83-permanent-cron-exemptions)). See [specs/job-queue.md](specs/job-queue.md).

**Settings surfaces are registry-driven.** Every settings page is a card in one of two registries, rendered by one shared `SettingsHub` component. A route without a registry entry is not a settings page. See [specs/settings-ui.md](specs/settings-ui.md).

**Runtime configuration over environment variables.** Object storage, AI providers and keys, Web Push (VAPID) keys and SMTP are configured by an administrator in the UI, live, with no restart. They have no environment variables, and adding one would create a second source of truth. See [specs/storage-providers.md](specs/storage-providers.md) and [specs/ai-platform.md](specs/ai-platform.md).

**Presence is the declaration.** Optional capabilities are declared by implementing a member, never by a boolean flag. A job handler is node-eligible because it has both `nodeResultSchema` and `persistNodeResult`. An AI provider supports images because its adapter has an `images` port. A flag could disagree with the code; a member cannot. See [specs/job-queue.md](specs/job-queue.md) and [specs/ai-platform.md](specs/ai-platform.md).

---

## 4. Technology stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 24 (`.nvmrc`, `engines`), npm workspaces `apps/*` and `packages/*` |
| API | NestJS 11 on the Fastify adapter, TypeScript |
| Validation | Zod via `nestjs-zod` (not class-validator) |
| Database | PostgreSQL 16, Prisma 7 with `@prisma/adapter-pg` |
| Authentication | Passport Google OAuth 2.0, JWT access tokens, rotating refresh-token cookie |
| Web | React 19, Material UI, react-router 7, Vite |
| CLI | TypeScript, Commander (subcommands), ink (interactive menu) |
| Observability | OpenTelemetry SDK, Pino structured logs, GreptimeDB |
| API reference | OpenAPI generated from code, Scalar UI at `/api/docs`, Spectral lint |
| Testing | Jest + Supertest (API), Vitest + React Testing Library (web and CLI), Playwright (e2e) |
| Containers | Docker, Docker Compose (`infra/compose/`) |
| Reverse proxy | nginx, same-origin routing |

---

## 5. Subsystem map

Each subsection describes one subsystem the template ships: what it does, where the code lives, how it is reached, and where to read more. Permissions refer to the matrix in [§7](#7-authorization).

### 5.1 Authentication: Google OAuth, JWT and the email allowlist

Users sign in with Google through Passport (`GET /api/auth/google`). On the callback the API checks the email against the allowlist, provisions or updates the user, issues a short-lived JWT access token (15 minutes by default) and sets a refresh token in an HttpOnly cookie. The browser receives the access token at `/auth/callback?token=…` and keeps it in memory. `POST /api/auth/refresh` rotates the refresh token on every use; the server stores only its hash.

A failed sign-in redirects to `/auth/callback?error=<code>` with a code from a closed set, and the web app shows a fixed explanation screen with a way to try a different account ([sign-in failure contract](SECURITY-ARCHITECTURE.md#sign-in-failure-contract)).

Access is restricted to allowlisted emails. `INITIAL_ADMIN_EMAIL` bypasses the check, is seeded onto the allowlist and becomes Admin on first sign-in. Every other new user gets the Viewer role. An allowlist entry is `pending` until its owner signs in, then `claimed`; claimed entries cannot be removed. Revoke access by deactivating the user instead.

Organization membership at sign-in follows `TENANCY_MODE` ([§10.4](#104-environment-variables)). In `single` (the default) every signing-in user is ensured a membership in the default organization, at creation and, self-healing, at later sign-ins. In `multi` only the `INITIAL_ADMIN_EMAIL` account auto-joins, and a user with no active membership is refused with `no_organization`. `GET /api/auth/me` reports the mode as `tenancyMode`, and the `tenancy.mode` doctor check flags a database that contradicts it ([user provisioning](SECURITY-ARCHITECTURE.md#user-provisioning)).

- **Code:** `apps/api/src/auth/`, `apps/api/src/allowlist/`, `apps/api/src/users/`, `apps/api/src/organizations/` (`TenancyService`)
- **UI:** `/admin/settings/users` (Users and Allowlist tabs)
- **Permissions:** `users:read`, `users:write`, `rbac:manage`, `allowlist:read`, `allowlist:write`
- **Read more:** [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md)

### 5.2 Role-based access control

Four roles grant 40 permissions named `resource:action`, split by scope (#723): the **system** role Admin (held in `user_roles`) operates the deployment, and the **org** roles Org admin, Contributor and Viewer (held on a membership, `memberships.role_id`) operate one organization; a request's permissions are the system roles' grants plus the current-org membership role's (`PrincipalFactory`, [§7](#7-authorization)). Each role and permission is declared once, with its description and default role grants, in a file beside the module that enforces it (`<module>.permissions.ts`), and registered into the role and permission registries (`apps/api/src/common/permissions/`). `roles.constants.ts` derives `ROLES` and `PERMISSIONS` from those declarations, and `npm run catalog:permissions --workspace=api` writes them to the committed `apps/api/prisma/catalog/permissions.json`, which the seed reads (the production image has no `src/`) and hands to `seedPlatform` (`@marinoscar/platform-db/seed`). Roles and permissions are rows (`roles`, `permissions`, `role_permissions`, `user_roles`); the seed only upserts them. A controller names the exact permission it needs in `@Auth({ permissions: [...] })`; the web app reads the same strings to decide which cards, routes and controls to show. An app adds its own roles and permissions in `apps/api/src/app-registrations/permissions.ts`.

- **Code:** `apps/api/src/auth/guards/`, `apps/api/src/common/permissions/`, `apps/api/src/common/constants/roles.constants.ts`, `apps/api/prisma/catalog/permissions.json`, `apps/api/prisma/seed-data.ts`, `apps/api/prisma/seed-app.ts`
- **Recipe:** [common/permissions/README.md](../apps/api/src/common/permissions/README.md)
- **Matrix:** [§7](#7-authorization)
- **Read more:** [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md)

### 5.3 Device authorization (RFC 8628)

A device without a browser (the CLI, a script, a kiosk) calls `POST /api/auth/device/code`, shows the user a code and the verification URL `/activate`, and polls `POST /api/auth/device/token`. The user approves the request on `/activate` while signed in. The device can ask for a personal access token instead of a session (`clientInfo.tokenType: "pat"`); this is how `appctl login` gets a long-lived token.

- **Code:** `apps/api/src/device-auth/`
- **UI:** `/activate`
- **Permissions:** any signed-in user approves their own devices
- **Read more:** [DEVICE-AUTH.md](DEVICE-AUTH.md), [device-auth README](../packages/platform-api/src/identity/device-auth/README.md)

### 5.4 Personal access tokens

A personal access token (`pat_…`) is a long-lived bearer token that acts with its owner's full authority on every authenticated route. The server stores only a hash and a display prefix; the raw token is shown once. Tokens expire, and revocation is immediate.

- **Code:** `apps/api/src/pat/`
- **UI:** `/settings/tokens` ("Access Tokens")
- **Permissions:** any signed-in user manages their own tokens
- **Read more:** [personal-access-tokens.md](personal-access-tokens.md)

### 5.5 Settings framework

Settings are stored as JSONB and validated by Zod schemas. System settings are rows in `system_settings`; per-user settings are one row per user in `user_settings` (see [§6.2](#62-settings-storage)). Writes are versioned; admin configuration endpoints use an `If-Match` version check.

The `global` system settings document and the optional user settings are built from **namespaces** held in two registries (`apps/api/src/settings/registry/`). Each namespace is declared once, beside its owning module (`<module>.system-settings.ts`, `<module>.user-settings.ts`), with its stored schema, partial, request-body and response branches, defaults and PATCH merge. The composed schemas, the request DTOs, `DEFAULT_SYSTEM_SETTINGS`, the seed defaults (generated `apps/api/prisma/catalog/system-settings-defaults.json`) and the services' merge and salvage are derived from the registries. An app adds its own namespaces, or fields inside a platform namespace, in `apps/api/src/app-registrations/settings.ts`. Registration refuses secret-named fields.

In the web app, every settings page is a card in a registry: `ADMIN_SECTIONS` (`/admin/settings`) or `USER_SETTINGS_SECTIONS` (`/settings`). The shared `SettingsHub` component, the Console navigation rail and the AppBar title resolver all read those registries, so they never disagree about which pages exist. A card's `permission` is the exact string the API controller enforces; a card's `feature` hides it while a platform feature (today only AI) is off. Tabs are reserved for parallel content inside one page.

- **Code:** `apps/api/src/settings/` (namespace registries: `apps/api/src/settings/registry/`), `apps/web/src/config/adminSections.tsx`, `apps/web/src/config/userSettingsSections.tsx`, `apps/web/src/components/settings/SettingsHub.tsx`
- **UI:** `/settings`, `/admin/settings` (inventory in [§9.2](#92-settings-pages))
- **Permissions:** `system_settings:read/write`, `user_settings:read/write`
- **Read more:** [specs/settings-ui.md](specs/settings-ui.md), [settings/registry/README.md](../apps/api/src/settings/registry/README.md)

### 5.6 Object storage

Files live in an S3-compatible object store: AWS S3, Cloudflare R2, or any S3-compatible endpoint. Which one is resolved at runtime, per call, from the `storage` system-settings namespace plus an encrypted secret access key. Every consumer injects the `STORAGE_PROVIDER` token, bound to a resolving provider that delegates to an S3 client built for the configuration in force. An unconfigured deployment answers storage calls with `503`.

Uploads come in two shapes. A simple upload (`POST /api/storage/objects`, up to 100 MB) streams through the API. A resumable upload initializes a multipart upload, lets the client send parts directly to the bucket through presigned URLs, then completes it. A completed upload checks, in the same transaction, whether any registered processor applies: if none does the object is marked `ready` immediately; otherwise the object is marked `processing` and the `storage.object.process` job runs the applicable processors (for example, metadata extraction) and stores their results on the object. Profile pictures and AI outputs are storage objects too. Abandoned uploads are swept by the `storage.cleanup.stale-uploads` job. Every key prefix a writer uses is declared in the storage key-prefix registry (`storage/storage-key-prefix.registry.ts`; apps add theirs in `app-registrations/storage-prefixes.ts`), and `npm run storage:purge` deletes only under those prefixes.

- **Code:** `apps/api/src/storage/` (`objects/`, `config/`, `providers/`, `processing/`)
- **UI:** `/admin/settings/storage`
- **Permissions:** `storage_config:read/write` for configuration; object routes see [§7](#7-authorization)
- **Read more:** [specs/storage-providers.md](specs/storage-providers.md), [runbooks/storage-configuration.md](runbooks/storage-configuration.md)

### 5.7 Background job queue

The `jobs` table is the queue. There is no Redis or message broker. Executors claim runnable rows with one atomic `FOR UPDATE SKIP LOCKED` statement, so any number of claimants (in-process worker slots, API replicas, remote nodes) can run without coordinating with each other. Attempts are charged at claim time. Each claim carries a lease and a per-claim token; the executor renews the lease while it works, and every settle write is conditional on still holding that claim. A lease reaper requeues or fails rows whose executor died. Idle in-process workers poll, and are also woken early by a `jobs.enqueued` message on the event bus ([§5.21](#521-event-bus)); the poll remains the guarantee.

A job type is one `JobHandler` class that self-registers from `onModuleInit()`. `Job.type` is a plain string, so a new type needs no migration. Enqueueing the same type and subject twice is deduplicated while the first job is active. Failures retry with exponential backoff; provider rate limits defer the job on a separate budget. `job_stats_rollup` keeps lifetime counts and durations after the history purge removes old rows. The job inventory is in [§8](#8-background-work).

- **Code:** `apps/api/src/jobs/`
- **UI:** `/admin/settings/jobs`, `/admin/settings/jobs/insights`
- **Permissions:** `jobs:read`, `jobs:write`
- **Read more:** [specs/job-queue.md](specs/job-queue.md), [handlers README](../apps/api/src/jobs/handlers/README.md)

### 5.8 Worker nodes

A worker node is an `appctl node` process on another machine that executes node-eligible job types. It authenticates with a `nod_` credential that can reach only `/api/nodes/*`, registers, heartbeats, claims jobs under a lease, and posts a validated result back for the server to persist. Input and output bytes move directly between the node and object storage through presigned URLs. A job that needs a database connection (the backup) gets a short-lived, job-scoped credential from a secret broker; the server records the credential's handle, never its material.

Whether a structurally eligible type is actually offered to nodes is a runtime decision made at claim time (a deployment-wide broker switch, the feature's own setting, and the broker's capability probe). `JOBS_WORKER_MODE=system` claims exactly the complement, so the API and the fleet partition the queue. Health is derived from `lastHeartbeatAt`; `nodes.fleet.sweep` marks silent nodes offline and `nodes.fleet.prune` forgets old ones.

- **Code:** `apps/api/src/nodes/`, `packages/platform-cli/src/engine/node/`, `infra/compose/worker.compose.yml`
- **UI:** `/admin/settings/workers`
- **Permissions:** `nodes:read`, `nodes:write`
- **Read more:** [specs/worker-nodes.md](specs/worker-nodes.md), [runbooks/run-worker-nodes.md](runbooks/run-worker-nodes.md), [runbooks/node-job-secrets.md](runbooks/node-job-secrets.md)

### 5.9 `appctl` CLI

The first-party command-line client is [`@marinoscar/platform-cli`](../packages/platform-cli/README.md) (the commands, the ink TUI, the deploy pipeline and the worker-node engine), composed by `apps/cli` with the app's identity in one `createCli({ identity, version, ... })` call. An app adds its own commands, TUI screens, deploy steps and node executors through the package's registries rather than forking the CLI ([apps/cli/README.md § Extending the CLI from an app](../apps/cli/README.md#extending-the-cli-from-an-app)). It has five command groups:

| Command | Purpose |
|---|---|
| `init` | Creates `infra/compose/.env` for a new checkout (run by `npm run setup`) |
| `login`, `config` | Device-flow sign-in that stores a personal access token; CLI configuration |
| `api <method> <path>` | Generic authenticated call to any endpoint, so the CLI never goes stale |
| `deploy doctor\|install\|update\|status\|list\|about\|certs\|uninstall` | Installs and updates the application on a VPS behind a shared host proxy |
| `node config\|enroll\|register\|start\|stop\|status\|logs\|set-concurrency\|doctor\|install-deps\|service\|heap-snapshot` | Runs and manages a worker node |

In a real terminal with no arguments it opens an interactive ink menu. `appctl deploy` writes a state document the API reads for the About page ([§5.15](#515-about-and-deployment-info)).

- **Code:** `packages/platform-cli/src/` (the `engine` slice: `commands/`, `deploy/`, `node/`, `tui/`; public entry points `/commands`, `/tui`, `/deploy`, `/node`, `/api-client`, `/testing`); `apps/cli/src/` (`cli.ts`, `app.ts`, `branding.ts`, `examples/`)
- **Read more:** [apps/cli/README.md](../apps/cli/README.md), [specs/vps-deploy.md](specs/vps-deploy.md), [runbooks/deploy-to-vps.md](runbooks/deploy-to-vps.md)

### 5.10 AI platform

The AI platform is an admin-governed, bring-your-own-key capability over five providers: `openai`, `anthropic`, `gemini`, `azure-openai` and `openai-compatible`. It offers responses (plain, streaming, structured output, function-calling tool loops), embeddings, image generation and editing, transcription, text-to-speech and realtime voice sessions, plus background runs and usage reporting.

A feature uses AI by injecting `AiService` and calling `forUser(userId)`. That client runs one gate pipeline for every call: kill switch, provider and model enablement, capability match, key resolution (the user's own key, or the org key under `byok_with_org_fallback` or for a holder of `ai_config:write`), rate limits and output caps. It records one `ai_usage_events` row per provider round trip. Provider SDKs are imported only inside `apps/api/src/ai/providers/<provider>/`. Every provider call happens on the server; the only credential an AI route ever returns is a realtime session's ephemeral secret. Media and background runs are server-only queue jobs, never node-eligible. The web app includes an admin-only AI Playground at `/ai`.

- **Code:** `apps/api/src/ai/` (`core/`, `providers/`, `runtime/`, `catalog/`, `keys/`, `usage/`, `config/`, `http/`)
- **UI:** admin `/admin/settings/ai`, `/admin/settings/ai/models`, `/admin/settings/ai/usage`; user `/settings/ai`; admin-only Playground `/ai`
- **Permissions:** `ai_config:read/write` (admin), `ai:use` (consumer)
- **Read more:** [specs/ai-platform.md](specs/ai-platform.md), [AI module README](../apps/api/src/ai/README.md), [runbooks/ai-configuration.md](runbooks/ai-configuration.md)

### 5.11 Notifications, email and Web Push

Every notification is an event declared once, next to the module that raises it (`<module>.notifications.ts`), with its channels, default, email template and browser renderer; an application declares its own in `app-registrations/notifications.ts`. Events, channels, email templates and their bindings are registries filled at import time by `notifications/registry/notification.manifest.ts`, and an application's channel transport registers itself into `NotificationChannelSenderRegistry` from its own module. A caller raises it with `notify(eventKey, userId, payload)`. The dispatcher narrows the declared channels by admin policy (`system_settings.notifications`), then by the user's preferences, and delivers each channel through its sender. Every attempt is a `notification_deliveries` row. Mandatory events (such as a role change) ignore user preferences. The live SSE stream fans out across API replicas through the event bus ([§5.21](#521-event-bus)).

The channels are email (SMTP or SES, configured at `/admin/settings/email`), in-app (a `notifications` inbox row pushed to open tabs over an SSE stream), and Web Push (VAPID keys generated and rotated at `/admin/settings/push`). The web app ships a service worker that handles push and notification clicks.

- **Code:** `apps/api/src/notifications/`, `apps/api/src/email/`
- **UI:** `/admin/settings/notifications`, `/admin/settings/push`, `/admin/settings/email`; user `/settings/notifications`
- **Permissions:** `system_settings:read/write` (email, policy), `push:read/write` (VAPID keys)
- **Read more:** [notifications README](../apps/api/src/notifications/README.md), [notification registries](../apps/api/src/notifications/registry/README.md), [specs/browser-notifications.md](specs/browser-notifications.md), [runbooks/vapid-keys.md](runbooks/vapid-keys.md)

### 5.12 Admin broadcasts

An administrator composes a message for every active user, sends it now or schedules it, and chooses channels (email, in-app, push). The `admin.broadcast.start` job freezes the audience at a cutoff and enqueues the first `admin.broadcast.chunk`; each chunk delivers one page of recipients, commits its cursor and enqueues its successor. A failed broadcast can be resumed from its committed cursor. Critical broadcasts use a mandatory event key that users cannot mute.

- **Code:** `apps/api/src/notifications/broadcasts/`
- **UI:** `/admin/settings/broadcasts`
- **Permissions:** `broadcasts:read`, `broadcasts:write`
- **Read more:** [specs/notification-broadcasts.md](specs/notification-broadcasts.md)

### 5.13 Database backup and restore

A backup is the `db.backup.run` job: `pg_dump` streams straight into object storage (never buffered), and the server reads the archive back to verify it. Backups run on a schedule (`databaseBackup` settings) or on demand. Each attempt is a `database_backup_runs` row with its own heartbeat and stale window; a partial unique index allows at most one active run. With the offload switches on, a worker node can take the dump using a brokered, SELECT-only PostgreSQL role.

A restore (`db.restore.run`) replaces the live database from a chosen backup, opening a maintenance window around the rename. A rollback undoes it; the displaced database is retained for `databaseBackup.oldDatabaseRetentionHours`, then dropped by `db.restore.old-db-drop`. Restore is a separate permission from backup. When the database role lacks a needed privilege (common on managed PostgreSQL), the API answers `guided` with paste-ready SQL instead of an error. With `DEPLOYMENT_MODE=saas` in-app restore and rollback are disabled entirely, and recovery is the provider's point-in-time recovery. The tenant tables force row-level security, so every dump and restore (the API's, a worker node's, the minted SELECT-only role's) passes `--enable-row-security` **and** the `app.rls_bypass` startup option, and needs a direct connection to the database; the Doctor check `backup.rls-bypass` proves a dump would carry every row ([SECURITY-ARCHITECTURE.md §18](SECURITY-ARCHITECTURE.md#18-tenant-isolation-rls)).

- **Code:** `apps/api/src/db-backup/`
- **UI:** `/admin/settings/db-backup`
- **Permissions:** `db_backup:read`, `db_backup:write`, `db_backup:restore`
- **Read more:** [specs/database-backup.md](specs/database-backup.md), [specs/database-restore.md](specs/database-restore.md), [runbooks/database-restore.md](runbooks/database-restore.md), [runbooks/postgres-client-version.md](runbooks/postgres-client-version.md), [runbooks/node-job-secrets.md](runbooks/node-job-secrets.md)

### 5.14 Maintenance mode

A maintenance window takes the application out of service on purpose. While open, every API route answers `503` with an operator message and `Retry-After`, except sign-in, health, token refresh, device activation and the maintenance endpoints themselves. The state resolves from three layers: the `MAINTENANCE_MODE` environment variable (break-glass, both directions), an in-memory override (used by the restore swap), and the persisted `maintenance` setting. The web app shows a maintenance screen and banner.

- **Code:** `apps/api/src/common/maintenance/`, `apps/web/src/components/common/MaintenanceGate.tsx`
- **UI:** `/admin/settings/maintenance`
- **Permissions:** `system_settings:read/write`
- **Read more:** [specs/maintenance-mode.md](specs/maintenance-mode.md), [runbooks/maintenance-mode.md](runbooks/maintenance-mode.md)

### 5.15 About and deployment info

`GET /api/admin/about` reports what is deployed: the API version, the fields of the state document `appctl deploy` writes (commit, ref, domain, proxy runtime, host facts, deploy history), a live runtime block and database liveness. It always answers `200`; a missing or malformed deploy document is reported as a field, not an error.

- **Code:** `apps/api/src/about/`
- **UI:** `/admin/settings/about` (`/admin/settings/deployment` redirects here)
- **Permissions:** `system_settings:read`
- **Read more:** [runbooks/deployment-info.md](runbooks/deployment-info.md), [specs/vps-deploy.md](specs/vps-deploy.md)

### 5.16 Encrypted credentials

Secrets configured at runtime are encrypted with AES-256-GCM under `SECRETS_ENCRYPTION_KEY` before they are stored. `CredentialsService` holds deployment-owned secrets in `credentials`, addressed by `(purpose, name)`: the SMTP password, the VAPID private key, the storage secret access key and the AI org keys. `UserCredentialsService` holds user-owned secrets in `user_credentials` under an owner-bound cipher domain, so a row moved to another user fails authentication instead of decrypting. Users' AI provider keys live in their own table, `user_ai_keys`, under a dedicated cipher purpose. No API ever returns secret material; admin screens show a masked status.

- **Code:** `apps/api/src/credentials/`, `apps/api/src/user-credentials/`; the cipher and its startup check are in `@marinoscar/platform-api/core` (`packages/platform-api/src/core/crypto/`, [§5.22](#522-platform-core-marinoscarplatform-apicore))
- **Read more:** [specs/user-credentials.md](specs/user-credentials.md), [runbooks/rotate-secrets-encryption-key.md](runbooks/rotate-secrets-encryption-key.md), [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md)

### 5.17 Observability

The API is instrumented with OpenTelemetry for traces, metrics and logs, and logs structurally with Pino. The optional telemetry stack (OTel Collector + GreptimeDB) runs from `telemetry.compose.yml`, with a SQL explorer and an AI assistant over the collected data. On a VPS deployment the stack ships by default and an administrator can (re)deploy the GreptimeDB/collector containers from `/admin/settings/telemetry`, through `stack-agent` — the sidecar that holds the Docker socket so the API never has to. See [§11](#11-observability) and [specs/telemetry.md](specs/telemetry.md).

Telemetry is one slice in five platform packages, each with a README that follows the package documentation standard and catalogs its extension points:

| Layer | Package subpath | README |
|---|---|---|
| Wire shapes | `@marinoscar/platform-contract/telemetry` | [contract](../packages/platform-contract/src/telemetry/README.md) |
| API: settings and export gate, GreptimeDB client, explorer, assistant, dashboard, stack surface, the two telemetry job types, Doctor checks | `@marinoscar/platform-api/telemetry` | [api](../packages/platform-api/src/telemetry/README.md) |
| Web: settings page, explorer, dashboard | `@marinoscar/platform-web/telemetry/headless` and `/ui` | [web](../packages/platform-web/src/telemetry/README.md) |
| CLI: the worker's span relay, the deploy wizard's env metadata | `@marinoscar/platform-cli/telemetry` | [cli](../packages/platform-cli/src/telemetry/README.md) |
| Infra: collector and GreptimeDB compose files, collector configuration and its app overlay | `@marinoscar/platform-infra/telemetry` | [infra](../packages/platform-infra/src/telemetry/README.md) |

The API slice reaches the app only through six host ports (`TELEMETRY_AUDIT_SINK`, `TELEMETRY_SETTINGS_STORE`, `TELEMETRY_CREDENTIAL_STORE`, `TELEMETRY_JOBS`, `TELEMETRY_AI`, `TELEMETRY_APP_INFO`), bound by `TelemetryHostModule` in `apps/api/src/platform/telemetry/`, where `telemetry.config.ts` calls `TelemetryModule.forRoot({ host, imports, metricGroups, dashboard })`. Its extension points are the module options (metric groups, verdict thresholds), the metric-group registry and the `VERDICT_POLICY` token; the reference app's examples are in `apps/api/src/platform-extensions/telemetry/` (the "App activity" group) and the slice's invariants run as a conformance suite ([specs/telemetry.md §12](specs/telemetry.md#12-packaging-and-extension-points)).

### 5.18 Template tooling

`scripts/rename.mjs` rebrands a fork (application name, repository slug, brand colours) from `packages/shared/identity.json`. `scripts/new-project.mjs` resets the release state a fork inherits. The `/new-project` and `/rename-app` skills in `.claude/skills/` drive both for a coding agent.

- **Read more:** [RENAMING.md](RENAMING.md)

### 5.19 Testing

The API uses Jest and Supertest for mocked integration tests (`*.integration.spec.ts`) and real-PostgreSQL tests (`*.db.spec.ts`, `npm run test:db`). The web app and CLI use Vitest. Playwright end-to-end tests live in `tests/e2e`; pixel-baseline visual tests live in `tests/visual`, with their harness in `apps/web/visual`. See [TESTING.md](TESTING.md).

### 5.20 Admin Doctor

`GET /api/admin/doctor` runs a set of read-only checks and answers one question: is every capability of this deployment configured, reachable and healthy? Each capability's own module contributes its checks (`<module>/doctor/`), which register themselves with `DoctorCheckRegistry`. `DoctorService` runs them in parallel, skips a check whose dependency did not pass, bounds each with a timeout, caches the report for 15 seconds and always answers `200`: a failing check is a row with a `remedy` and the settings page that fixes it. No check sends, writes, spends tokens or enqueues a job. The host-level counterpart is `appctl deploy doctor` ([§5.9](#59-appctl-cli)). `GET /api/admin/doctor/support-bundle` packages the report, the versions and a 24-hour telemetry summary into one redacted JSON download for support tickets: sections self-register with `SupportBundleRegistry`, pass strict schemas and a central redaction pass, and each download is audited as `support_bundle:download` ([doctor spec §2.10](specs/doctor.md#210-support-bundle)).

- **Code:** `@marinoscar/platform-api/doctor` (`packages/platform-api/src/doctor/`: contract, registry, service, controller factory), the first packaged slice (#696); the app's binding is `apps/api/src/doctor/doctor.config.ts`, its checks are `apps/api/src/*/doctor/`
- **UI:** `/admin/settings/doctor`: `@marinoscar/platform-web/doctor/ui` (`DoctorPage`, `doctorSettingsPage`), bound by `apps/web/src/pages/Admin/DoctorPage.tsx`
- **Host ports:** the packaged controller and page reach the app through `apps/api/src/platform/` and `apps/web/src/platform/platformHost.tsx`, the single places the app is bound to the platform
- **Permissions:** `system_settings:read`
- **Read more:** [specs/doctor.md](specs/doctor.md), [runbooks/doctor.md](runbooks/doctor.md)

### 5.21 Event bus

A small publish/subscribe seam, the `EventBus` interface behind the `EVENT_BUS` token, that reaches every API process sharing the database, not just the publishing one. It is what lets a second API replica run without losing live behaviour. `EventBusModule` is `@Global()` and imported once in `app.module.ts`; `EVENT_BUS_ADAPTER` (deployment topology, read once at boot) picks the adapter:

| Adapter | Transport | Use |
|---|---|---|
| `in-process` | A `Map` in this process. | Exactly one API replica; the default when the variable is unset (tests, local dev). |
| `postgres` | `pg_notify` to publish, one `LISTEN` session to receive. | Any number of replicas; the `.env.example` value. |

Delivery is local-once (on every adapter) and remote at-most-once with no replay: a process drops its own echo by origin, and a message sent while a listener reconnects is lost. Every consumer therefore keeps a durable fallback. Payloads are JSON in a 7,500-byte envelope (Postgres caps `NOTIFY` at 8,000); larger data travels as a reference. The bus never carries a secret, and `publish` is never called inside a transaction.

All logical channels are multiplexed onto one physical Postgres channel, `platform_bus`, as `{ v, c, o, p }`, so subscribing never issues SQL. The listener is a dedicated `pg.Client` on the **application** database, outside the Prisma pool, because `LISTEN` is session state a pooled connection cannot hold; it is the same structural reason the restore's admin connection (`db-backup/admin-connection.util.ts`) lives outside the pool, though that one attaches to the maintenance database. It never blocks startup and reconnects with backoff. A transaction-mode pooler (PgBouncer in transaction mode, RDS Proxy) cannot carry it.

| Logical channel | Publisher | Subscriber | Payload |
|---|---|---|---|
| `notifications.stream` | `NotificationStreamService.publish` | every replica's `NotificationStreamService` | `{ userId, event }`, or `{ userId, ref }` when oversize |
| `jobs.enqueued` | `JobsService.enqueue` (due now; never `enqueueWithin`) | every running `JobWorker` (not mode `off`) | `{ type }` |
| `auth.principal.invalidate` | `PrincipalCache.invalidate` / `invalidateUser`, after a user, role, membership, PAT-revoke or device-session-revoke write commits | every replica's `PrincipalCache` | `{ userId }` or `{ all: true }` |

- **Code:** `apps/api/src/common/event-bus/`
- **Doctor:** `core.event-bus` reports the adapter and the listener's state.
- **Read more:** [specs/browser-notifications.md §2.13](specs/browser-notifications.md#213-fan-out-across-replicas), [specs/job-queue.md](specs/job-queue.md) (Worker modes, "Wake-up")

### 5.22 Platform core (`@marinoscar/platform-api/core`)

The primitives every other platform slice builds on, consumed by the API as a package rather than kept in `apps/api/src/common/` (issue #698): the typed registry primitive (`defineRegistry`, `Registry`, `RegistryFreezeService`), the org-aware principal and scope types ([ADR 0001](adr/0001-org-aware-principal-and-scope.md)), `HttpExceptionFilter` with `ErrorDto`, `withVerbatimErrorBody` and `DatabaseSeedException`, the secret cipher (`encryptSecret`, `decryptSecret`, `userCredentialPurpose`) with `verifyEncryptionKeyAtStartup`, and the OpenAPI tag registry (`openApiTags`). Code only, no tables; it imports no other slice and no Prisma client. The app registers `HttpExceptionFilter` as its `APP_FILTER` (`app.module.ts`), provides `RegistryFreezeService` (`CommonModule`), calls `verifyEncryptionKeyAtStartup(() => prisma.credential.count(), logger)` before binding the port (`main.ts`), and registers its OpenAPI taxonomy in `openapi/tags.ts`. `apps/api/test/platform/no-local-core-copies.spec.ts` fails if a local copy of any of these reappears under `apps/api/src/common/`.

- **Code:** `packages/platform-api/src/core/`
- **Read more:** [core README](../packages/platform-api/src/core/README.md), [specs/platform-packages.md](specs/platform-packages.md) (Dependency graph)

### 5.23 Sharing: groups and grants (`@marinoscar/platform-api/sharing`)

Groups inside an organization (epic #666, issue #728): a set of users that can own and share content, never a tenant (spec decision D6). Members hold a group role, `admin` (manage the group, its members and invites), `editor` or `viewer`; the last `admin` can neither be demoted nor leave (409 `LAST_GROUP_ADMIN`). Invitations are by email address, one pending invite per group and address (`group_invites_pending_uniq_idx`), expire at read time (no cron) and are answered by the invitee from `GET /api/groups/invites/mine`; the `groups.invitation` notification (email and browser) is sent after the invite commits. Every query runs in one transaction scoped to the caller's active organization, so a group of another organization is a 404 like a group the caller does not belong to. An app table can be owned by a user or a group (`owner_user_id` / `owner_group_id`, `ON DELETE RESTRICT`, exactly one owner); its resource type registers with `registerGroupOwnedResource`, and deleting a group that still owns rows answers 409 `GROUP_OWNS_RESOURCES` with per-type counts. `ownedByMeOrMyGroups()` is the "owned by me or by a group I belong to" query fragment; `PrincipalGroupsProvider` fills `Scope.groupIds` lazily, cached on the principal cache's TTL and invalidated across replicas on the event bus channel `sharing.groups.invalidate`.

| Route | Permission (org) | Group rule |
|---|---|---|
| `GET /api/groups?scope=mine\|all` | `groups:read` (`all`: + `groups:admin`) | `mine`: groups the caller belongs to |
| `POST /api/groups` | `groups:write` | the creator becomes `admin` in the same transaction |
| `GET /api/groups/invites/mine`, `POST /api/groups/invites/:inviteId/accept\|decline` | `groups:read` | the caller's own address; expired: 410 |
| `GET /api/groups/:id`, `GET /api/groups/:id/members` | `groups:read` | member or `groups:admin`, else 404 |
| `PATCH`/`DELETE /api/groups/:id` | `groups:write` | group `admin` or `groups:admin` |
| `POST /api/groups/:id/members`, `PATCH /api/groups/:id/members/:userId` | `groups:write` | group `admin`; the person must be a member of the organization; failed lookups by email are throttled per account |
| `DELETE /api/groups/:id/members/:userId` | `groups:read` | leave (self); removing someone else needs `groups:write` and the group `admin` role |
| `GET`/`POST /api/groups/:id/invites`, `DELETE /api/groups/:id/invites/:inviteId` | `groups:read` / `groups:write` | group `admin` |

Grants (issue #729): one record of a registered resource type shared with a user or a group of the same organization (link grants: below), with one of the type's roles and an optional expiry. An app makes a table shareable with one `registerResourceType({ type, roles, actions, ownership, loadOwners, ... })` call; `AccessPolicy` (`can`, `decide`, `require`, `roleFor`, `decideMany`) is the one decision point above row-level security: unknown type a programming error, missing or other-org record denied, a missing `actionPermissions` entry a 403 naming the permission even for the owner, a `bypassPermissions` entry (and `sharing:admin` for `share`) allowed, otherwise the maximum of owner, owning-group member (`groupRoleMap`), active unexpired user and group grants and the type's `defaultVisibility: 'org'` role. A denial of a `denyAs: 'not_found'` type (the default) is the same 404 as a missing record. Decisions are batched (one owner query per type, one grant query) and memoised per request only, so a revocation takes effect on the next request. `accessibleWhere` / `accessibleSql` / `sharedResourceIds` answer "resources I can see" per scope (`owned`, `groups`, `shared`, `all`); `accessibleWhere` inlines at most 1,000 shared ids and switches to the `EXISTS` form above that. One active grant per resource and grantee (`grants_active_user_uniq_idx`, `grants_active_group_uniq_idx`; the API upserts on them), soft revocation, `sharing.shared_with_you` (email and browser) after a user grant is created or its role changes, events `sharing.grant.created|updated|revoked`, audit `grant:create|update|revoke`. There is no foreign key to the record: apps call `GrantsService.deleteForResources(tx, type, ids)` in their delete transaction, and the daily `sharing.grants.prune` job deletes dangling grants and those revoked or expired past `grants.retentionDays` (default 90).

| Route | Permission (org) | Sharing rule |
|---|---|---|
| `GET /api/grants?resourceType&resourceId` | `sharing:read` | the `share` action on the record, else 404 |
| `POST /api/grants` | `sharing:write` | `share` on the record; role grantable to the grantee kind; grantee an active member (or a group) of the record's organization (422 otherwise); no self-grant; failed lookups by email throttled per account |
| `PATCH /api/grants/:id` | `sharing:write` | `share` on the grant's record, else 404 |
| `DELETE /api/grants/:id` | `sharing:read` | the grantee removing their own access; anyone else needs `sharing:write` and `share` on the record, else 404 |
| `GET /api/grants/shared-with-me` | `sharing:read` | active, unexpired grants to the caller or their groups, with the type's `describe()` labels |
| `POST /api/grants/links` | `sharing:write` | `share_link` (else `share`) on the record; a role the type lists under `grantable.link`; 503 without `SECRETS_ENCRYPTION_KEY` |
| `GET /api/grants/links?resourceType&resourceId` | `sharing:read` | the same action, else 404 |
| `GET /api/public/links/current` | none (**deliberately public**, `@Public()`) | the `X-Link-Token` header; every invalid link the same 404; 429 past the per-address miss limit |

Link shares (issue #730): a grant of kind `link` shares one record, with one role the type lists under `grantable.link` (none by default), to anyone holding its token. The token (`lnk_` + 32 random bytes) is returned once by `POST /api/grants/links` and stored as a SHA-256 hash (`link_token_hash`, unique) plus a ciphertext under `sharing.link:<grantId>`, so the sharer can copy the link again; the share URL `<APP_URL>/s#lnk_…` keeps it in the fragment, and the SPA sends it in `X-Link-Token`. Resolution is the slice's one cross-organization read (one `grants` row by hash, bypass reason `link-resolution`); everything after it, and an app's own public route (`LinkGrantGuard`, `@LinkGrantResource`, `@CurrentLinkGrant`, `LinkGrantsService.withLinkScope`), runs in the grant's organization with no user. Every failure is the same 404, failures are throttled per client address (30 per 10 minutes), public responses carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and links default to 30 days, capped at 365 (`links` options). Changing and revoking go through `PATCH`/`DELETE /api/grants/:id` (audit `grant:link:create|update|revoke`); resolutions are counted, not audited.

- **Code:** `packages/platform-api/src/sharing/`, `packages/platform-contract/src/sharing/`, the `sharing` fragment and `0026_add_groups`, `0027_add_grants` in `packages/platform-db/`; the app's binding is `apps/api/src/platform/sharing/`
- **Tables:** `groups`, `group_members`, `group_invites`, `grants` (all `org`, row-level security forced)
- **Metrics:** `app.sharing.group_mutations` (`op`), `app.sharing.access_decisions` (`resource_type`, `outcome`, `via`), `app.sharing.link_resolutions` (`outcome`, `resource_type`)
- **Doctor:** `sharing.groups.orphaned` (warn: groups without an admin)
- **Read more:** [sharing README](../packages/platform-api/src/sharing/README.md), [specs/platform-packages.md](specs/platform-packages.md#tenancy-and-access-model)

---

## 6. Data architecture

### 6.1 Prisma models

The schema is composed from per-slice fragments in `packages/platform-db/schema/` (one file per slice: identity, settings, storage, credentials, notifications, jobs, db-backup, ai, sharing; plus `base.prisma` for the generator and datasource) and the app's own `apps/api/prisma/fragments/`. `npm run db:compose --workspace=api` writes the generated, committed folder `apps/api/prisma/schema/` that Prisma reads; a back-relation on a platform model (`User`, `Job`, `StorageObject`, `Organization`, `Group`) is an `extend model` block in the fragment that owns the foreign key ([platform packages spec](specs/platform-packages.md#known-hard-problem-relations-to-package-owned-models)). The fragments' block comments carry per-column reasoning. All 37 models, grouped by subsystem:

| Subsystem | Model | Table | Purpose |
|---|---|---|---|
| Identity | `User` | `users` | User account, profile, active flag |
| Identity | `UserIdentity` | `user_identities` | OAuth identity (provider + subject) linked to a user |
| Identity | `AllowedEmail` | `allowed_emails` | Allowlist entry, `pending` or `claimed` |
| Identity | `RefreshToken` | `refresh_tokens` | Hashed refresh tokens, rotated on use |
| Identity | `PersonalAccessToken` | `personal_access_tokens` | Hashed `pat_` tokens with display prefix and expiry |
| Identity | `DeviceCode` | `device_codes` | RFC 8628 device authorization requests |
| Identity | `AuditEvent` | `audit_events` | Security-relevant action log |
| Identity | `Organization` | `organizations` | A tenancy boundary; exactly one row is the default organization (`is_default`) |
| Identity | `Membership` | `memberships` | A user's membership of an organization, `active` or `suspended`, with its org role (`role_id`, required); unique per `(org_id, user_id)` |
| Identity | `Invite` | `org_invites` | An invitation of an email address to an organization, with the org role it grants (`role_id`; NULL means the default org role); unique per `(org_id, email)` |
| RBAC | `Role` | `roles` | Admin (scope `system`), Org admin, Contributor, Viewer (scope `org`) |
| RBAC | `Permission` | `permissions` | The `resource:action` permissions, each `system` or `org` scope |
| RBAC | `RolePermission` | `role_permissions` | Role-to-permission grants (same scope only) |
| RBAC | `UserRole` | `user_roles` | User-to-SYSTEM-role assignments (org roles live on `memberships.role_id`) |
| Settings | `SystemSettings` | `system_settings` | Keyed JSONB rows for deployment settings |
| Settings | `UserSettings` | `user_settings` | One JSONB settings document per user |
| Secrets | `Credential` | `credentials` | Encrypted deployment-owned secrets by `(purpose, name)` |
| Secrets | `UserCredential` | `user_credentials` | Encrypted user-owned secrets, owner-bound cipher domain |
| Storage | `StorageObject` | `storage_objects` | File metadata, status, storage key, processing results |
| Storage | `StorageObjectChunk` | `storage_object_chunks` | Multipart upload part tracking |
| Notifications | `Notification` | `notifications` | In-app inbox rows |
| Notifications | `NotificationDelivery` | `notification_deliveries` | One row per channel delivery attempt |
| Notifications | `PushSubscription` | `push_subscriptions` | Browser Web Push subscriptions |
| Notifications | `NotificationBroadcast` | `notification_broadcasts` | Admin broadcasts, audience cutoff and cursor |
| Jobs | `Job` | `jobs` | The queue: type, payload, status, attempts, lease, claim token |
| Jobs | `JobStatsRollup` | `job_stats_rollup` | Lifetime per-type counts and durations |
| Nodes | `WorkerNode` | `worker_nodes` | Registered worker nodes, declared types and concurrency |
| Nodes | `NodeCredential` | `node_credentials` | Hashed `nod_` credentials |
| Nodes | `JobNodeSecret` | `job_node_secrets` | Handle (never material) of a per-job brokered credential |
| Backup | `DatabaseBackupRun` | `database_backup_runs` | One row per backup or restore attempt, own heartbeat |
| AI | `AiModel` | `ai_models` | Model catalog per `(provider, modelId)`, capabilities, enablement |
| AI | `UserAiKey` | `user_ai_keys` | Encrypted BYOK key per `(userId, provider)`, reachable models |
| AI | `AiRun` | `ai_runs` | Background AI runs (response, image, transcription, speech) |
| AI | `AiUsageEvent` | `ai_usage_events` | One row per provider round trip, tokens, key source |
| Sharing | `Group` | `groups` | A set of users inside one organization that can own and share content (never a tenant); `metadata` for app fields, `version` for `If-Match` |
| Sharing | `GroupMember` | `group_members` | A user's membership of a group with a `GroupRole` (`admin`, `editor`, `viewer`); unique per `(group_id, user_id)` |
| Sharing | `GroupInvite` | `group_invites` | An invitation of an email address to a group with the role it grants; state derived from `accepted_at`, `declined_at`, `revoked_at`, `expires_at` |
| Sharing | `Grant` | `grants` | One record (polymorphic `resource_type`, `resource_id`, no foreign key) shared with a user, a group or a link (`GrantGranteeKind`), with a role, an optional `expires_at` and a soft `revoked_at`; one active grant per resource and grantee; link columns for #730 |

Conventions: UUID primary keys, `timestamptz` timestamps, JSONB for extensible shapes, cascade deletes from `users` where the data belongs to the user. Users are deactivated, not deleted.

Ownership is declared, not implied. Every model with a foreign key to `User` (30 models, 37 fields) is registered in the user-owned data registry with the key's role (owner: the row belongs to the user; actor: the row only names who acted), a purge policy that must match the relation's `onDelete`, an export policy and a rationale. A tripwire test fails when a `User` relation is unregistered or a policy contradicts the schema. `ScopedPrismaService.forUser(userId)` returns a Prisma client confined to one user's rows in owner models; `asSystem(actor)` is the named escape for system work. The mechanism lives in `@marinoscar/platform-api/core` (schema-independent, so packaged slices use it too) and the tripwires run as its `userOwnedData` conformance suite; the app keeps its registrations. See [prisma/ownership/README.md](../apps/api/src/prisma/ownership/README.md) and [SECURITY-ARCHITECTURE.md §17](SECURITY-ARCHITECTURE.md#17-user-owned-data-and-scoped-access).

Every model also has an **ownership kind**, registered in the model ownership registry (`apps/api/src/prisma/ownership/platform-model-ownership.ts`; the mechanism is `modelOwnershipRegistry` in `@marinoscar/platform-api/core`): `org` (NOT NULL `org_id`, row-level security forced: `StorageObject`, `StorageObjectChunk`, `AiRun`, and the sharing slice's `Group`, `GroupMember`, `GroupInvite`, `Grant`), `org-optional` (nullable `org_id`; `AiUsageEvent` has a policy too, and a row without an organization is visible to the system client only; `AuditEvent` has none yet), `user` (personal, `forUser` scope) and `system` (deployment-wide). An identity table that merely references an organization (`Membership`, `Invite`, org-bound tokens) declares `orgReference`. `org_id` foreign keys are `Restrict` for storage and AI runs and `SetNull` for usage and audit history, and the upload-chunk link to its object is the composite `(object_id, org_id)`, as the group-member and group-invite links to their group are `(group_id, org_id)` and a group grant's link to its group is `(grantee_group_id, org_id)`. The eight policies are listed in `RLS_POLICIES` (`packages/platform-db/rls-policies.json`) and are intentional drift like the raw-SQL indexes: Prisma cannot express them, `platform db drift` asserts them, and `apps/api/test/tenancy/rls-coverage.db.spec.ts` fails on an `org` table without one or an `org_id` column nobody classified. The API must connect as an ordinary role, or none of it applies. See [SECURITY-ARCHITECTURE.md §18](SECURITY-ARCHITECTURE.md#18-tenant-isolation-rls).

Six unique indexes exist only in hand-written migration SQL because Prisma cannot express a partial unique index: `jobs_active_dedup_uniq_idx` (job deduplication while `pending`/`running`), `database_backup_runs_active_uniq_idx` (at most one active backup run), `organizations_default_uniq_idx` (exactly one default organization), `group_invites_pending_uniq_idx` (one pending invite per group and address), `grants_active_user_uniq_idx` and `grants_active_group_uniq_idx` (one active grant per resource and user or group), plus the non-unique partial `jobs_attempts_gt1_idx` and `jobs_succeeded_duration_idx`. This is intentional schema drift. Do not add a `@@unique` to the models to "fix" it. The eight are listed in `RAW_SQL_INDEXES` in `@marinoscar/platform-db`; its tripwire fails on an unlisted partial or expression index and on a fragment that redeclares one.

Migrations are installed from `@marinoscar/platform-db`. The base's 22 migrations are the package's platform history v1 (`packages/platform-db/migrations/0001_initial` to `0022_add_retention_created_at_indexes`, with a manifest of hashes); `0023_add_organizations` is the first migration appended after it, followed by `0024_split_system_org_roles`, `0025_org_scoped_rls` (`org_id` on the tenant tables and the row-level security policies) and `0026_add_groups` (the sharing slice's tables, #728); `apps/api/prisma/migrations/` holds the installed copies under their original directory names, and `apps/api/prisma/platform.lock` maps each package id to its directory and records the hash. `npm run db:check` proves the copies are byte-identical, `db:check:database` compares the `_prisma_migrations` ledger, and `db:drift` proves the history equals the composed schema and the raw-SQL indexes exist. See the [platform-db README](../packages/platform-db/README.md#platform-history-v1).

The retention sweeps read "oldest rows older than the cutoff" across every user, so `notifications`, `notification_deliveries` and `ai_runs` each carry a plain `created_at` index (migration `add_retention_created_at_indexes`); `audit_events` already had one. See [runbooks/data-retention.md](runbooks/data-retention.md).

### 6.2 Settings storage

`system_settings` holds three rows, each keyed:

| Key | Contents | Edited at |
|---|---|---|
| `global` | The namespaced system settings document below | Per-namespace admin pages and `/api/system-settings` |
| `email` | Email transport (`ses` or `smtp`) and sender settings; the SMTP password is in `credentials` | `/admin/settings/email` |
| `webPush` | `{ enabled, publicKey, subject }`; the private key is in `credentials` | `/admin/settings/push` |
| `telemetry_connection` | Stored GreptimeDB connection; own version counter; not reachable through `/api/system-settings`. A custom (literal) host stores the whole row (host, PG port, database, reader/admin usernames) and its own credentials wholly. An automatic host (`{ host: null }`), or an absent row, means the `GREPTIME_*` deployment default applies wholly — port, database, logins and passwords included. See [specs/telemetry.md §8](specs/telemetry.md#8-runtime-connection). | `/admin/settings/telemetry` (Connection section) |

Namespaces of the `global` document (`systemSettingsSchema`, composed from the system settings namespace registry in registration order; each row is declared in the file named in [settings/registry/README.md](../apps/api/src/settings/registry/README.md)):

| Namespace | Holds |
|---|---|
| `notifications` | Deployment policy: `browserEnabled`, `disabledEvents` |
| `jobs` | History retention and purge, stuck-job threshold |
| `nodes` | Heartbeat staleness, offline retention, `jobSecretBrokerEnabled` |
| `databaseBackup` | Schedule, retention, stale window, restore rollback mode, `nodeOffloadEnabled` |
| `maintenance` | Window state, message, `allowAdmins` |
| `storage` | Provider, bucket, region, endpoint, access key ID, path style (secret key is in `credentials`) |
| `ai` | Kill switch, key policy, per-provider settings, hosted tools, limits, usage retention |
| `telemetry` | Collection switch, retention, query bounds, instance id, telemetry assistant |
| `retention` | `{ enabled, days }` per table: `notifications`, `notificationDeliveries`, `auditEvents` (off by default), `aiRuns`. See [runbooks/data-retention.md](runbooks/data-retention.md) |

Every read completes missing namespaces from each namespace's declared defaults, so the stored document is always whole. The seed writes the same defaults from the generated `apps/api/prisma/catalog/system-settings-defaults.json` (`npm run catalog:settings --workspace=api`).

`user_settings.value` (`userSettingsSchema`): the core fields `theme` and `profile` (display name, image source, uploaded image), then the optional namespaces from the user settings namespace registry: `dataTables`, `navigation`, `notifications` (per-event channel preferences) and `ai` (default model). An absent optional namespace means "use the defaults".

---

## 7. Authorization

### 7.1 Roles

Roles come in two kinds (issue #723; spec: [platform packages, "Tenancy and access model"](specs/platform-packages.md#tenancy-and-access-model)). Every role and every permission declares its **scope**, and a role is granted only permissions of its own scope (the permission registry refuses anything else at import time).

| Role | Scope | Held through | Intended for |
|---|---|---|---|
| Admin (`admin`) | system | `user_roles` | Deployment operators. Holds every **system** permission. `ROLES.ADMIN`, and so every `@Auth({ roles: [ROLES.ADMIN] })`, means this role. |
| Org admin (`org_admin`) | org | the membership's `role_id` | An organization's administrator. Holds every **org** permission, including `org_members:*` and `org_invites:*`. Not a deployment operator. |
| Contributor (`contributor`) | org | the membership's `role_id` | Organization members who may also use AI. |
| Viewer (`viewer`) | org | the membership's `role_id` | Least privilege. `DEFAULT_ORG_ROLE`: the role of every new membership, and what a NULL `org_invites.role_id` means. |

**Effective permissions** are the union of the user's system roles' grants and the grants of the role on the user's **current-org membership** (`PrincipalFactory`, `apps/api/src/auth/principal.factory.ts`, used by the guards, `/api/auth/me` and the users list). The current org is the **active org** the request's credential is bound to (PP-6.4, #724): the access token's `org` claim, a PAT's or device session's `org_id`; a node credential has none and gets system grants only. A graph loaded outside a request (the users list, a pre-#724 token) uses the sign-in rule: the default organization in single-org mode, the active membership with the latest `lastActiveAt` in multi-org mode. A suspended membership contributes nothing. `roles` on `/api/auth/me` and on the users list is the system role names plus the current org role name, so a system administrator shows `admin` and `org_admin`.

The initial administrator gets the system `admin` role plus `org_admin` on the default organization. In single-org mode, `PUT /api/users/:id/roles` keeps its body: `admin` toggles the system role and sets the membership role to `org_admin`; `contributor`/`viewer` set the membership role. In multi-org mode it changes system roles only and answers 400 for an org role name.

`ai:use` is withheld from Viewer so that a brand-new account cannot spend the deployment's org AI key without an administrator deciding it should. Grant it to a specific Viewer with a `role_permissions` row, or promote the account to Contributor.

### 7.2 Permission matrix

This is the single home for the matrix. Source: each permission's `defaultGrants` in its declaration file (`apps/api/src/<module>/<module>.permissions.ts`, registered by `apps/api/src/common/permissions/permission.manifest.ts`), generated into `rolePermissions` in `apps/api/prisma/catalog/permissions.json`, which the seed reads and passes to `seedPlatform` as `roleGrants`. The registry is the source of truth, not `seed-data.ts`, which only loads the catalog (`ROLE_PERMISSIONS` there is a derived view for tests). `apps/api/test/prisma/permission-catalog.spec.ts` fails when a row here disagrees with those grants.

| Permission | Scope | Admin | Org admin | Contributor | Viewer | Gates |
|---|---|:-:|:-:|:-:|:-:|---|
| `system_settings:read` | system | ✓ | | | | Read system settings, email, notification policy, maintenance, About; run the Doctor (`GET /api/admin/doctor`, `/admin/settings/doctor`) and download its support bundle (`GET /api/admin/doctor/support-bundle`); reach `/admin/settings`; view the telemetry services status |
| `system_settings:write` | system | ✓ | | | | Change system settings, email, notification policy; open or close maintenance; (re)deploy the telemetry services |
| `user_settings:read` | org | | ✓ | ✓ | ✓ | Read own settings and own uploaded profile picture |
| `user_settings:write` | org | | ✓ | ✓ | ✓ | Change own settings; upload or remove own profile picture |
| `users:read` | system | ✓ | | | | List and view users; reach `/admin/settings` |
| `users:write` | system | ✓ | | | | Update users (for example, activation) |
| `rbac:manage` | system | ✓ | | | | Assign roles |
| `allowlist:read` | system | ✓ | | | | View the allowlist |
| `allowlist:write` | system | ✓ | | | | Add or remove allowlist entries |
| `storage:read` | org | | ✓ | ✓ | ✓ | List, get and download storage objects |
| `storage:write` | org | | ✓ | ✓ | | Upload objects, update metadata, delete own objects |
| `storage:delete_any` | system | ✓ | | | | Delete another user's object (except their profile image) |
| `jobs:read` | system | ✓ | | | | Inspect the job queue and insights |
| `jobs:write` | system | ✓ | | | | Retry, reset, delete jobs; reset insight history |
| `nodes:read` | system | ✓ | | | | View worker nodes and node credentials |
| `nodes:write` | system | ✓ | | | | Register nodes, mint and revoke `nod_` credentials, claim jobs |
| `db_backup:read` | system | ✓ | | | | View backup policy, runs, preflight |
| `db_backup:write` | system | ✓ | | | | Change policy; start, cancel, delete backups |
| `db_backup:restore` | system | ✓ | | | | Restore a backup or roll a restore back |
| `broadcasts:read` | system | ✓ | | | | View broadcasts |
| `broadcasts:write` | system | ✓ | | | | Create, schedule, send, resume broadcasts |
| `push:read` | system | ✓ | | | | View Web Push configuration |
| `push:write` | system | ✓ | | | | Generate, rotate, enable, remove VAPID keys |
| `storage_config:read` | system | ✓ | | | | View object-storage configuration |
| `storage_config:write` | system | ✓ | | | | Change storage configuration, test it, create the bucket |
| `ai_config:read` | system | ✓ | | | | View AI configuration, model catalog, usage report |
| `ai_config:write` | system | ✓ | | | | Change AI configuration, admin keys, models; refresh the catalog |
| `ai:use` | org | | ✓ | ✓ | | Call AI and manage own AI keys (`/api/ai/*` except `GET /api/ai/config`) |
| `telemetry:read` | system | ✓ | | | | View the telemetry policy and store status; reach `/admin/settings/telemetry` |
| `telemetry:write` | system | ✓ | | | | Change telemetry policy (retention, query bounds, the AI assistant); save, test or reset the GreptimeDB connection |
| `telemetry:query` | system | ✓ | | | | Run explorer queries, export results, use the telemetry AI assistant (with `ai:use`), view the telemetry dashboard |
| `org_members:read` | org | | ✓ | | | `GET /api/org/members`: the active organization's members and their org roles (`org-members.controller.ts`, #726) |
| `org_members:write` | org | | ✓ | | | `PATCH`/`DELETE /api/org/members/:userId`: change a member's org role, suspend or remove members (#726) |
| `org_invites:read` | org | | ✓ | | | `GET /api/org/invites`: the active organization's invitations (`org-invites.controller.ts`, #726) |
| `org_invites:write` | org | | ✓ | | | `POST /api/org/invites`, `DELETE /api/org/invites/:id`: invite people (adds an allowlist entry), revoke invitations (#726) |
| `organizations:read` | system | ✓ | | | | `GET /api/admin/organizations`: the deployment's organizations with member counts (`organizations-admin.controller.ts`, #726) |
| `organizations:write` | system | ✓ | | | | `POST`/`PATCH /api/admin/organizations`: create an organization with a first-admin invitation, rename one (#726) |
| `groups:read` | org | | ✓ | ✓ | ✓ | `GET /api/groups` (`scope=mine`), `GET /api/groups/:id` and `/members` as a member, `GET /api/groups/invites/mine`, accept or decline an invitation, leave a group (`@marinoscar/platform-api/sharing`, #728) |
| `groups:write` | org | | ✓ | ✓ | | `POST /api/groups`; as a group `admin`: `PATCH`/`DELETE /api/groups/:id`, add, re-role and remove members, create and revoke invitations (#728) |
| `groups:admin` | org | | ✓ | | | `GET /api/groups?scope=all`; read and administer every group of the organization, member or not (#728) |
| `sharing:read` | org | | ✓ | ✓ | ✓ | `GET /api/grants` (with the `share` action on the record), `GET /api/grants/shared-with-me`, `DELETE /api/grants/:id` for your own access (#729) |
| `sharing:write` | org | | ✓ | ✓ | | `POST /api/grants`, `PATCH /api/grants/:id`, revoke someone else's grant, each with the `share` action on the record (#729) |
| `sharing:admin` | org | | ✓ | | | A bypass for the `share` action on every record of every resource type, so an org admin can revoke a leak (#729) |
| `org_settings:read` | org | | ✓ | | | `GET /api/org-settings`: the active organization's settings overrides and their effective values; each namespace's own read permission then gates its fields (`@marinoscar/platform-api/settings`, #733) |
| `org_settings:write` | org | | ✓ | | | `PATCH /api/org-settings` (`If-Match`): change the active organization's overrides; each namespace's own write permission then gates its fields (#733) |

**Note on `storage:*`.** Every `/api/storage/objects` route requires `storage:read` (list, get, download) or `storage:write` (uploads, metadata updates, delete). Ownership is enforced on top: a caller may act only on their own objects unless they also hold `storage:delete_any`, which lifts the ownership check for delete on every object except another user's profile image (removed only via `DELETE /api/user-settings/profile-image` by its owner).

Separate permission families (`push:*`, `nodes:*`, `storage_config:*`, `ai_config:*`, `db_backup:restore`, `telemetry:*`) exist because each gates something with a distinct blast radius. Folding them into `system_settings:*` would hand that authority to anyone granted routine settings access. See [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md) for the design.

### 7.3 Principal cache

`AuthService.validateJwtPayload` resolves a JWT's user, roles and permissions through `PrincipalCache` (`apps/api/src/auth/principal-cache/`, a leaf `PrincipalCacheModule` imported by each module that reads or invalidates it, one instance per process): an in-process map keyed by `(userId, orgId, tokenKind)` (#724), at most 10,000 deep-frozen entries, each bound to its key's org and credential kind, each kept for `AUTH_PRINCIPAL_CACHE_TTL_SECONDS` (default 30; `0` disables it). The device-session (`did`) check runs first and is never cached; PATs and node credentials bypass the cache. The cached entry is the principal graph (system roles and memberships with their org roles, `PRINCIPAL_USER_INCLUDE`); `PrincipalFactory` derives the effective permissions from it on every request. The invalidation sites, each called after its write commits and outside any transaction, are `UsersService.updateUser` and `updateUserRoles` (system roles, deactivation; `invalidateUser`), `OrganizationsService` (membership create, remove, status and role change; `invalidateUser`), `PatService.revokeToken` and `DeviceAuthService.revokeDeviceSession` (`invalidateUser`), `AuthService` (first-login admin grant, provider-profile update), `AdminBootstrapService.assignAdminRole`, `UserSettingsService` (display-name sync) and `TestAuthService` (role swap). `invalidateUser(userId)` drops every entry of the user (all orgs, all kinds); `invalidate` drops the local entries synchronously and publishes on `auth.principal.invalidate` ([§5.21](#521-event-bus)), so other replicas follow within bus latency; the TTL bounds staleness when the bus is down. `test/auth/principal-invalidation-sites.spec.ts` fails when a new `user`/`userRole`/`role`/`rolePermission`/`membership` write appears in a file that never invalidates. Doctor: `auth.principal-cache`. Guarantee: [SECURITY-ARCHITECTURE.md §1](SECURITY-ARCHITECTURE.md#1-authentication).

---

## 8. Background work

### 8.1 Job-type inventory

All 28 registered job types. Handler paths are relative to `apps/api/src/`. A type is node-eligible when its handler carries both `nodeResultSchema` and `persistNodeResult`.

| Type | Handler | What it does | Node-eligible |
|---|---|---|:-:|
| `ai.catalog.refresh` | `ai/catalog/ai-catalog-refresh.handler.ts` | Syncs one provider's model catalog with the admin key; daily and on admin request | No |
| `ai.response.run` | `ai/runtime/ai-response-run.handler.ts` | Executes one background AI response | No |
| `ai.image.generate` | `ai/runtime/ai-image-generate.handler.ts` | One image generation or edit; outputs become the user's storage objects | No |
| `ai.audio.transcribe` | `ai/runtime/ai-audio-transcribe.handler.ts` | Streams a user's recording to the provider; stores the transcript on the run | No |
| `ai.audio.speech` | `ai/runtime/ai-audio-speech.handler.ts` | Text-to-speech; the audio becomes the user's storage object | No |
| `ai.usage.purge` | `ai/usage/ai-usage-purge.handler.ts` | Deletes `ai_usage_events` past `ai.usageRetentionDays`, in batches; daily | No |
| `ai.runs.purge` | `ai/runtime/ai-runs-purge.handler.ts` | Deletes terminal `ai_runs` past `retention.aiRuns`, in batches; daily at 01:00; not gated on the kill switch | No |
| `ai.keys.recheck` | `ai/keys/ai-keys-recheck.handler.ts` | Re-verifies stale user keys for one provider, refreshes reachable models | No |
| `job.history.purge` | `jobs/handlers/job-history-purge.handler.ts` | Deletes old finished jobs after folding them into `job_stats_rollup` | No |
| `example.echo` | `jobs/handlers/example-echo.handler.ts` | Worked server-only example: logs its payload | No |
| `example.checksum` | `jobs/handlers/example-checksum.handler.ts` | Worked node-eligible example: hashes a storage object | Yes |
| `auth.token.cleanup` | `auth/handlers/token-cleanup.handler.ts` | Deletes expired or revoked refresh tokens and expired PATs | No |
| `nodes.fleet.sweep` | `nodes/handlers/node-fleet-sweep.handler.ts` | Marks nodes with stale heartbeats offline | No |
| `nodes.fleet.prune` | `nodes/handlers/node-fleet-prune.handler.ts` | Forgets nodes offline longer than `nodes.offlineRetentionDays` | No |
| `admin.broadcast.start` | `notifications/broadcasts/handlers/broadcast-start.handler.ts` | Starts a broadcast: freezes the audience, enqueues the first chunk | No |
| `admin.broadcast.chunk` | `notifications/broadcasts/handlers/broadcast-chunk.handler.ts` | Delivers one page of recipients, enqueues its successor | No |
| `notifications.inbox.purge` | `notifications/retention/notification-inbox-purge.handler.ts` | Deletes `notifications` inbox rows past `retention.notifications`, in batches; daily at 01:00 | No |
| `notifications.deliveries.purge` | `notifications/retention/notification-deliveries-purge.handler.ts` | Deletes `sent`/`failed` `notification_deliveries` past `retention.notificationDeliveries` (never `queued`); daily at 01:00 | No |
| `audit.events.purge` | `common/retention/audit-events-purge.handler.ts` | Deletes `audit_events` past `retention.auditEvents` (off by default); daily at 01:00 | No |
| `storage.cleanup.stale-uploads` | `storage/handlers/storage-cleanup.handler.ts` | Cleans up abandoned uploads, aborting billed multipart parts | No |
| `storage.object.process` | `storage/handlers/storage-object-process.handler.ts` | Runs registered post-upload processors on one object and marks it `ready`/`failed` | No |
| `db.backup.run` | `db-backup/handlers/db-backup-run.handler.ts` | Streams `pg_dump` into object storage | Yes |
| `db.backup.sweep` | `db-backup/handlers/db-backup-sweep.handler.ts` | Releases stale backup runs, then prunes by retention | No |
| `db.restore.run` | `db-backup/handlers/db-restore-run.handler.ts` | Restores the database from a backup | No |
| `db.restore.old-db-drop` | `db-backup/handlers/db-restore-old-db-drop.handler.ts` | Drops databases a restore displaced once their retention closes | No |
| `device-auth.code.cleanup` | `device-auth/handlers/device-code-cleanup.handler.ts` | Deletes expired device codes | No |
| `telemetry.retention.apply` | `packages/platform-api/src/telemetry/handlers/telemetry-retention.handler.ts` (the telemetry slice) | Sets GreptimeDB's database-level TTL to `telemetry.retentionDays`; daily and on policy change | No |
| `telemetry.stack.deploy` | `packages/platform-api/src/telemetry/stack/telemetry-stack-deploy.handler.ts` (the telemetry slice) | Starts GreptimeDB and the collector through `stack-agent`, on admin request | No |
| `sharing.grants.prune` | `packages/platform-api/src/sharing/jobs/grants-prune.handler.ts` (the sharing slice) | Deletes grants revoked or expired more than `grants.retentionDays` ago and grants whose record no longer exists (each type's `loadOwners`), in chunks; daily at 03:00 | No |

Every `ai.*` type is server-only permanently: no AI key is ever brokered to a worker node. `db.backup.run` is offered to nodes only when `nodes.jobSecretBrokerEnabled` and `databaseBackup.nodeOffloadEnabled` are both on and the broker can mint a role.

Scheduled types are enqueued by small `@Cron` tasks that only decide whether work is due (for example `apps/api/src/jobs/tasks/job-history-purge.task.ts`, using the shared helper `apps/api/src/jobs/housekeeping.enqueue.ts`).

### 8.2 Execution profile and lease

- A handler may declare `profile: { maxRuntimeMs, maxAttempts }`; otherwise `JOBS_JOB_TIMEOUT_MS` and `JOBS_MAX_ATTEMPTS` apply.
- The lease length is derived from `maxRuntimeMs`. Neither executor can choose its own lease.
- The renewal interval is a clamped fraction of the lease, also derived. There is no `leaseMs` or `heartbeatMs` to declare.
- Both executors renew through `JobLeaseService`; settle writes match the claim token, so a stale executor cannot overwrite a newer claim.
- The lease reaper (`JOBS_REAPER_ENABLED`) requeues or fails rows whose lease passed or whose claim is implausible.

### 8.3 Permanent cron exemptions

Three crons do their work inline instead of enqueuing a job. The list is enforced by `apps/api/test/jobs/cron-enqueue-only.spec.ts`.

| Task | Why it cannot be a job |
|---|---|
| `apps/api/src/jobs/tasks/job-stuck-reset.task.ts` | The lease reaper. Recovery that depends on the queue it recovers is not recovery. |
| `apps/api/src/jobs/tasks/temp-file-janitor.task.ts` | Sweeps this process's local disk, which another replica or a node cannot reach. |
| `apps/api/src/nodes/tasks/node-secret-sweep.task.ts` | Revokes brokered node credentials. A wedged queue must not leak live credentials. |

Read more: [specs/job-queue.md](specs/job-queue.md), [specs/worker-nodes.md](specs/worker-nodes.md), [handlers README](../apps/api/src/jobs/handlers/README.md).

---

## 9. Frontend architecture

### 9.1 Routes

Routes are declared in `apps/web/src/App.tsx`.

| Access | Routes |
|---|---|
| Public | `/login`, `/auth/callback`, `/testing/login` (development builds only) |
| Signed in | `/` (home), `/activate` (device approval), `/settings` hub and its pages |
| Admin | `/admin/settings` hub (`system_settings:read`, `users:read` or `org_members:read`) and its pages; `/ai` (AI Playground: `ai:use` and `ai_config:read`, AI enabled) |
| Redirects | `/admin` → `/admin/settings`, `/admin/users` → `/admin/settings/users`, `/admin/settings/deployment` → `/admin/settings/about`; unknown paths → `/` |

`ProtectedRoute` establishes that someone is signed in. `RequirePermission` wraps each gated page with the same permission string its registry card declares and its API controller enforces. `RequireAiEnabled` redirects AI pages while AI is off, and `RequireMultiOrg` redirects the organization pages in a single-org deployment. `MaintenanceGate` swaps the app for a maintenance screen while a window is open.

### 9.2 Settings pages

Every settings page, from `apps/web/src/config/adminSections.tsx` and `apps/web/src/config/userSettingsSections.tsx`. Groups and cards are append-only: the hub and rail render them in declaration order.

| Route | Title | Group | Permission | Feature gate |
|---|---|---|---|---|
| `/admin/settings/email` | Email | General | `system_settings:read` | |
| `/admin/settings/notifications` | Notifications | General | `system_settings:read` | |
| `/admin/settings/push` | Web Push | General | `push:read` | |
| `/admin/settings/storage` | Storage | General | `storage_config:read` | |
| `/admin/settings/maintenance` | Maintenance | General | `system_settings:read` | |
| `/admin/settings/users` | Users & Allowlist | Access | `users:read` | |
| `/admin/settings/jobs` | Jobs | Operations | `jobs:read` | |
| `/admin/settings/jobs/insights` | Job Insights | Operations | `jobs:read` | |
| `/admin/settings/workers` | Worker Nodes | Operations | `nodes:read` | |
| `/admin/settings/db-backup` | Database Backup | Operations | `db_backup:read` | |
| `/admin/settings/broadcasts` | Broadcasts | Operations | `broadcasts:read` | |
| `/admin/settings/about` | About | Operations | `system_settings:read` | |
| `/admin/settings/ai` | AI | AI | `ai_config:read` | none (the page that turns AI on) |
| `/admin/settings/ai/models` | AI Models | AI | `ai_config:read` | `ai` |
| `/admin/settings/ai/usage` | AI Usage | AI | `ai_config:read` | `ai` |
| `/admin/settings/telemetry` | Telemetry | Observability | `telemetry:read` | none (the page that turns telemetry on) |
| `/admin/settings/telemetry/explorer` | Telemetry Explorer | Observability | `telemetry:query` | `telemetry` |
| `/admin/settings/telemetry/dashboard` | Telemetry Dashboard | Observability | `telemetry:query` | `telemetry` |
| `/admin/settings/doctor` | Doctor | Observability | `system_settings:read` | none (reports on AI and telemetry while they are off) |
| `/admin/settings/organization` | Organization | Organizations | `org_members:read` (org) | `orgs` (multi-org mode) |
| `/admin/settings/organizations` | Organizations | Organizations | `organizations:read` (system) | `orgs` (multi-org mode) |
| `/settings/profile` | Profile | Account | | |
| `/settings/appearance` | Appearance | Account | | |
| `/settings/notifications` | Notifications | Account | | |
| `/settings/tokens` | Access Tokens | Security | | |
| `/settings/ai` | AI Keys | Security | `ai:use` | `ai` |

Cards gate reachability; pages gate their own write controls (for example, a `jobs:read` holder without `jobs:write` sees disabled retry buttons). The Users & Allowlist page keeps two tabs because they are parallel views of one question; `allowlist:read` gates the Allowlist tab's content. The Organization page (#726) follows the same precedent: Members and Invites are parallel views of "who belongs to this organization", and `org_invites:read` gates the Invites tab. Both organization cards exist only when `/api/auth/me` reports `tenancyMode: 'multi'` (the `orgs` feature); an organization's own administrator, who holds no system permission, reaches the Console through `org_members:read` and sees only the Organization card. The AppBar's organization switcher (`components/navigation/OrgSwitcher.tsx`) appears in multi-org mode for a user with two or more active memberships.

### 9.3 Layout and breakpoint

The layout switches between a phone treatment (bottom navigation, compact AppBar, drill-down settings list) and a wider treatment (navigation rail, card grid) at MUI's `sm` breakpoint, 600px. Five gates move together: `showRail` in `apps/web/src/components/common/Layout.tsx`, the self-gate in `components/navigation/BottomNav.tsx`, `<main>`'s bottom padding in `Layout.tsx`, and `isCompactWindow` in both `components/settings/SettingsHub.tsx` and `components/navigation/AppBar.tsx`. Change one only after checking all five. See [specs/settings-ui.md](specs/settings-ui.md).

### 9.4 Contexts and API client

| Context | File | Provides |
|---|---|---|
| `ThemeContextProvider` | `apps/web/src/contexts/ThemeContext.tsx` | Light, dark or system theme preference |
| `AuthProvider` | `apps/web/src/contexts/AuthContext.tsx` | Current user, enabled sign-in providers, sign-in and sign-out, the active organization, the user's memberships and `switchOrg` (`POST /api/auth/switch-org`) |
| `NotificationProvider` | `apps/web/src/contexts/NotificationContext.tsx` | In-app inbox and the SSE notification stream |
| `AiConfigProvider` | `apps/web/src/contexts/AiConfigContext.tsx` | The one `GET /api/ai/config` answer: whether AI is on, key policy, enabled providers |

All HTTP calls go through `ApiService` in `apps/web/src/services/api.ts`. It resolves the base URL (`VITE_API_BASE_URL`, default `/api`), attaches the in-memory access token, refreshes it once on `401`, unwraps the `{ data }` envelope, and recognizes the maintenance `503` centrally. Feature-specific clients (`services/jobs.ts`, `services/ai.ts`, `services/storage.ts` and others) are thin wrappers over it. `services/sse.ts` opens event streams against the same base URL.

---

## 10. Infrastructure

### 10.1 Compose files

All files live in `infra/compose/` and are layered with repeated `-f` flags from that folder. Every platform file below, the nginx configuration and the env templates are the committed output of `platform-infra sync` from [`@marinoscar/platform-infra`](../packages/platform-infra/README.md), rendered with the app identity (CLI name, env prefix, service name); the version, the identity and a checksum per file are in `infra/platform-infra.lock.json`, and CI's `npm run platform:infra:sync -- --check` fails on a hand edit. The app changes the stack with **overlays**, never by editing a generated file: `infra/compose/app.*.compose.yml` files, which the deploy appends after the platform files sorted by name ([package README § Infra](../packages/platform-infra/README.md#infra)); `infra/compose/app.example.compose.yml` is the documented, never-applied example. See also [runbooks/telemetry.md §2](runbooks/telemetry.md#2-enable-the-overlay).

| File | Purpose | When used |
|---|---|---|
| `base.compose.yml` | Core services: `nginx`, `api`, `web`. No database service. | Always |
| `dev.compose.yml` | Hot reload, source volumes, exposed ports | Local development |
| `devdb.compose.yml` | Opt-in PostgreSQL 16 container (`db`) for development. The image's bootstrap login stays `postgres`; `postgres-init/10-application-role.sh` creates the ordinary `POSTGRES_USER` role (default `app`) the API runs as, so row-level security applies | Local development without a shared database |
| `telemetry.compose.yml` | OpenTelemetry Collector and GreptimeDB standalone. **Generated** from `@marinoscar/platform-infra/telemetry` (`npm run platform:infra:sync`; never edit by hand). The collector loads `infra/otel/otel-collector-config.yaml` (generated) and then `infra/otel/app-collector.yaml` (app-owned overlay). | When you want traces, metrics and logs locally |
| `prod.compose.yml` | Resource limits, restart policies | Production |
| `vps.compose.yml` | Publishes nothing on a public interface; the app sits behind a shared host proxy. Also adds `stack-agent`, the only service that holds the Docker socket — it lets the admin UI (re)deploy the telemetry containers with no shell step. See [specs/telemetry.md §10](specs/telemetry.md#10-deploying-the-stack-stack-agent). | VPS deployment via `appctl deploy`, after `prod.compose.yml` |
| `vps.telemetry.compose.yml` | Hardens the telemetry stack for a VPS: no collector host ports, GreptimeDB's Postgres wire port on `127.0.0.1` only. **Generated** from `@marinoscar/platform-infra/telemetry`, like `telemetry.compose.yml`. | VPS deployment, after `telemetry.compose.yml` and `vps.compose.yml` (always layered — the telemetry stack ships with every VPS deployment) |
| `test.compose.yml` | Disposable PostgreSQL (`db-test`, host port 5433); the suites connect as the ordinary `app` role created by the same init script | Real-database test runs |
| `worker.compose.yml` | Worker node containers from the published image; scale with `--scale worker=N` | Running a worker fleet |
| `worker.build.compose.yml` | Builds the worker image from source | Developing the worker itself |
| `app.*.compose.yml` | The app's own overlays (app-owned; `app.<name>` for every base mode, `app.<scope>.<name>` for one scope: `dev`, `devdb`, `prod`, `vps`, `worker`) | Appended last by the deploy and `init`'s start command; none in the reference app |

Typical commands:

```bash
cd infra/compose
docker compose -f base.compose.yml -f dev.compose.yml up
docker compose -f base.compose.yml -f dev.compose.yml -f devdb.compose.yml up
docker compose -f base.compose.yml -f dev.compose.yml -f telemetry.compose.yml up
docker compose -f base.compose.yml -f prod.compose.yml up
```

### 10.2 Networks

`base.compose.yml` defines a private bridge network, `app-network`, for `nginx`, `api` and `web`. The `api` service also joins `devnet`, an external network you create once per host (`docker network create devnet`). A PostgreSQL server shared by several apps on that host lives on `devnet`. With `devdb.compose.yml`, the database is the `db` service instead, so `.env` must set `POSTGRES_HOST=db`.

### 10.3 nginx routing

`infra/nginx/nginx.conf` is the single origin. It is generated from `@marinoscar/platform-infra`; the app adds to it through include points in `infra/nginx/app.d/` (`http/`, `server/`, `locations/`, and `permissions-policy.conf`), mounted with `platform/` (`security-headers.conf`, `sse-proxy.conf`) by `base.compose.yml`:

| Location | Upstream | Notes |
|---|---|---|
| `/api/notifications/stream` | api | Buffering off for SSE |
| `/api/ai/responses/stream` | api | Buffering off for SSE |
| `/api/admin/telemetry/assistant/stream` | api | Buffering off for SSE (telemetry AI assistant) |
| `/api` | api | Includes `/api/docs` and `/api/openapi.json` |
| `/` | web | The React app |
| `/nginx-health` | nginx | Proxy health probe |
| `app.d/locations/*.conf` | api (usually) | The app's own routes, included before `/api`; an SSE route's body is `include /etc/nginx/platform/sse-proxy.conf;` |

Connection limits are sized for long-lived SSE, where each stream holds two nginx connections (client and upstream): `worker_connections 16384` and `worker_rlimit_nofile 65536`, with a matching `nofile` ulimit on the `nginx` and `api` services in `base.compose.yml` (pinned by `apps/api/test/nginx-connection-limits.spec.ts`; a CLI-bootstrapped shared proxy gets the same, see [specs/vps-deploy.md](specs/vps-deploy.md#shared-proxy-and-tls)).

Security headers are set at server level from `platform/security-headers.conf`: `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, the app's `Permissions-Policy` (`app.d/permissions-policy.conf`), `Strict-Transport-Security` and a Content-Security-Policy. nginx's `add_header` replaces rather than merges, so a location that adds its own header must repeat the security headers: it includes the same file, as `platform/sse-proxy.conf` does (`apps/api/test/nginx-app-locations.spec.ts`).

### 10.4 Environment variables

The reference for every variable is [`infra/compose/.env.example`](../infra/compose/.env.example). Create `.env` from it with `npm run setup`, which builds the CLI and runs `appctl init`. The policy:

- **Database.** Set `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` and `POSTGRES_SSL`. `DATABASE_URL` is constructed at runtime; do not set it. Use the `npm run prisma:*` scripts, never bare `npx prisma`, so the URL is built for you.
- **Runtime-configured features have no variables.** Object storage, AI, Web Push and SMTP are configured in the admin UI and stored in `system_settings` plus encrypted `credentials`. Never add `STORAGE_PROVIDER`, `S3_BUCKET`, `OPENAI_API_KEY` or similar.
- **`SECRETS_ENCRYPTION_KEY`** encrypts those runtime secrets. It is required for a working deployment.
- **Process tuning** (`JOBS_*`, `NODE_*`, `DB_BACKUP_SCHEDULE_ENABLED`) controls what this process runs, not deployment policy. Deployment policy is a system setting.
- **`EVENT_BUS_ADAPTER`** is deployment topology: `postgres` once more than one API replica shares the database, `in-process` (or unset) for exactly one. It is the same on every replica; see [§5.21](#521-event-bus).
- **`MAINTENANCE_MODE`** is a break-glass override; see [runbooks/maintenance-mode.md](runbooks/maintenance-mode.md).
- **`DEPLOYMENT_MODE`** (`self-hosted`, the default, or `saas`) is a deployment-level fact read once at startup; an invalid value stops the API. `saas` disables in-app database restore and rollback (routes `403`, queued `db.restore.run` jobs refused) in favour of the provider's point-in-time recovery; backups are unchanged. It is reported by `GET /api/admin/about` and the `core.deployment-mode` doctor check. See [specs/database-restore.md](specs/database-restore.md#deployment-mode) and, for the deployment modes themselves, [specs/platform-packages.md](specs/platform-packages.md#deployment-modes).
- **`TENANCY_MODE`** (`single`, the default, or `multi`) is a deployment-level fact read once at startup; an invalid value stops the API. It is deliberately not a runtime setting: switching it changes who can see what. `single` auto-joins every user to the default organization; `multi` joins only the `INITIAL_ADMIN_EMAIL` account automatically and refuses a sign-in with no active membership (`no_organization`). It is reported by `GET /api/auth/me` (`tenancyMode`) and checked by the `tenancy.mode` doctor check. See [§5.1](#51-authentication-google-oauth-jwt-and-the-email-allowlist) and [specs/platform-packages.md](specs/platform-packages.md#tenancy-mode-is-a-deployment-setting).
- **`DEPLOYMENT_NETWORK`** (`online`, the default, or `air-gapped`) is a deployment-level fact read once at startup; an invalid value stops the API. It changes no behaviour: `air-gapped` makes the `network.egress` doctor check grade the deployment's outbound dependencies (a required public one fails, optional ones warn) instead of only listing them. See [runbooks/air-gapped.md](runbooks/air-gapped.md).

The API does not migrate on startup. Run `npm run prisma:migrate` and `npm run prisma:seed` inside the `api` container after the first start and after each upgrade.

### 10.5 Published images

`.github/workflows/images.yml` is the one place images are built for publishing. It pushes four images to GHCR as `ghcr.io/<owner>/<repo>-<role>` (lower-cased from the repository, so a fork publishes under its own name): `api`, `web`, `worker` (`apps/cli/Dockerfile`, target `production`) and `stack-agent`. Each pushed digest carries a BuildKit SBOM and SLSA provenance attestation, a keyless cosign signature (GitHub OIDC) and a non-blocking Trivy scan in code scanning. It is a reusable workflow: `deploy.yml` calls it for app releases (`v*` tags, the semver tag set), the platform release workflow calls it with the platform version and the `next` or `latest` channel, and a manual run pushes `sha-<sha>` tags only. The compose files do not change: `worker.compose.yml` takes the image from `WORKER_IMAGE`, and `vps.compose.yml` still builds the stack-agent on the server, with a documented overlay to run the published one. See [runbooks/container-images.md](runbooks/container-images.md).

---

## 11. Observability

| Signal | Mechanism | Destination |
|---|---|---|
| Traces | OpenTelemetry Node SDK with Node auto-instrumentations (health probes excluded) | OTLP → otel-collector → GreptimeDB |
| Metrics | OpenTelemetry metrics exporter | OTLP → otel-collector → GreptimeDB |
| Logs | Pino structured JSON (`apps/api/src/common/logger/`), pretty-printed in development; also exported over OTLP | stdout, and OTLP → otel-collector → GreptimeDB |

- Instrumentation starts in `apps/api/src/instrumentation.ts`, before the application loads: a call to `initializeOtel()` from `@marinoscar/platform-api/otel-core/sdk` (`packages/platform-api/src/otel-core/`, the Nest-free half of the `otel-core` slice). It runs only when `OTEL_ENABLED=true` (the telemetry overlay sets it on the `api` service) and exports to `OTEL_EXPORTER_OTLP_ENDPOINT`. With `OTEL_ENABLED` unset the API runs unchanged and every instrument is a no-op.
- A second, independent switch — the `telemetry.enabled` system setting — decides whether the SDK's output is actually exported, checked at export time by a runtime gate (`telemetryGate`, `packages/platform-api/src/otel-core/sdk/telemetry-gate.ts`) that starts closed and converges across a fleet within about five seconds of an administrator's change. See [specs/telemetry.md §2](specs/telemetry.md#2-the-two-switches).
- The collector (`infra/otel/otel-collector-config.yaml`) redacts credential-bearing attributes (`Authorization`, `Cookie`, `Set-Cookie`, query strings) before anything reaches GreptimeDB, and authenticates to it as a write-only user.
- The collector also scrapes the host (`hostmetrics` over a read-only `/hostfs` mount), its own pipeline counters and a subset of GreptimeDB's `/metrics`, into their own tables, and probes uptime and TLS expiry of the app, the API and the public origin (`httpcheck`) and nginx's connection counters (`nginx` over an internal `:8081` listener). See [specs/telemetry.md §11.2](specs/telemetry.md#112-data-sources-what-is-collected-and-why-no-docker-stats).
- `AppMetricsModule` (`apps/api/src/common/otel/`, global) is the one place first-party application metrics (`app.*`: jobs, backups, auth, AI, notifications, the event bus) are created; features record through `AppMetricsService`. Every metric is declared in the app-metric registry (`appMetricRegistry` in `@marinoscar/platform-api/otel-core`; the platform's in `platform-app-metrics.ts`, an app's in `app-registrations/telemetry.ts`), and an app emits its own with `add(key, …)`/`record(key, …)`. The instruments, label bounding and the gauge-provider seam are the package's `MetricsHostService` (`OtelMetricsModule`); `AppMetricsService` keeps the typed recorders and the database-backed gauges. See [specs/telemetry.md §11.13](specs/telemetry.md#1113-application-metrics).
- The dashboard's metric groups are a registry too (`packages/platform-api/src/telemetry/metrics/metric-group.registry.ts`: the six platform groups in `groups/`, the reference app's "App activity" group in `apps/api/src/platform-extensions/telemetry/`, a fork's in `app-registrations/telemetry.ts`). `GET /api/admin/telemetry/dashboard/metric-groups` (`telemetry:query`) serves their metadata, and the web renders one section per group. See [specs/telemetry.md §11.14](specs/telemetry.md#1114-metric-catalog-and-the-metrics-route).
- Each log line carries the request ID and trace ID assigned by the request-ID middleware, so a log line leads to its trace.
- Never log secrets. The AI platform, credential stores and auth guards keep key material out of logs, spans and error bodies by design.
- Administrators query GreptimeDB with SQL, export results, and ask an AI assistant about them, from the Telemetry Explorer (`/admin/settings/telemetry/explorer`, `telemetry:query`) — see [specs/telemetry.md](specs/telemetry.md).
- A fixed Telemetry Dashboard (`/admin/settings/telemetry/dashboard`, `telemetry:query`) gives a health verdict, tiles and timelines with no SQL required — see [specs/telemetry.md §11](specs/telemetry.md#11-dashboard).
- The Doctor (`/admin/settings/doctor`, `system_settings:read`) checks that telemetry capture works (export switches, GreptimeDB connection, tables and retention, data freshness) beside every other capability — see [specs/doctor.md](specs/doctor.md#27-check-inventory).
- GreptimeDB dashboard: http://localhost:14000/dashboard when `telemetry.compose.yml` is running.

Health endpoints (public, reachable during maintenance):

| Endpoint | Checks |
|---|---|
| `GET /api/health/live` | The process is running |
| `GET /api/health/ready` | The process can reach the database |
| `GET /api/health` | Full check of all dependencies |

---

## 12. Extension points

| To add | See |
|---|---|
| An API endpoint | [DEVELOPMENT.md](DEVELOPMENT.md) |
| A settings page or setting | [specs/settings-ui.md](specs/settings-ui.md) (UI), [settings/registry/README.md](../apps/api/src/settings/registry/README.md) (API namespace) |
| A background job type | [jobs/handlers/README.md](../apps/api/src/jobs/handlers/README.md) |
| A notification event, email template or channel | [notifications/README.md](../apps/api/src/notifications/README.md) (app entries in `app-registrations/notifications.ts`; API in [notifications/registry/README.md](../apps/api/src/notifications/registry/README.md)) |
| AI in a feature | [ai/README.md](../apps/api/src/ai/README.md) |
| An AI provider | [specs/ai-platform.md](specs/ai-platform.md) |
| A user key type (bring your own key) | [specs/user-credentials.md](specs/user-credentials.md) |
| A Doctor check | [specs/doctor.md §4](specs/doctor.md#4-extending-it-in-a-fork) |
| A packaged slice's access to the app (auth, audit, settings, Prisma; web transport and viewer) | [platform-api core README, Host ports](../packages/platform-api/src/core/README.md#host-ports), [platform-web core README](../packages/platform-web/src/core/README.md) |
| A post-upload storage processor | [processors/README.md](../apps/api/src/storage/processing/processors/README.md) |
| A worker node executor | [executors/README.md](../packages/platform-cli/src/engine/node/executors/README.md) |
| A registry entry (permission, setting, …) | [registry/README.md](../packages/platform-api/src/core/registry/README.md) |
| A permission or role (platform module or app) | [permissions/README.md](../apps/api/src/common/permissions/README.md) |
| An object-storage key prefix | [specs/storage-providers.md §4](specs/storage-providers.md#4-extending-it-in-a-fork) |
| A user-owned model (any model with a `User` relation) | [prisma/ownership/README.md](../apps/api/src/prisma/ownership/README.md) |
| An app metric or dashboard metric group | [runbooks/telemetry.md §8.4](runbooks/telemetry.md#84-adding-an-app-metric-group) |
| An OpenAPI tag (`@ApiTags`) from a slice or module | [core README](../packages/platform-api/src/core/README.md) (`openApiTags`) |
| A secret stored encrypted (a new cipher purpose) | [core README](../packages/platform-api/src/core/README.md) (crypto), [specs/user-credentials.md](specs/user-credentials.md) |

---

## 13. Related documents

Every document in this repository, with its audience and a suggested reading order, is listed in [README.md](README.md).
