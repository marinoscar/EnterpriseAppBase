# System Architecture

**Enterprise Application Foundation**
**Version:** 1.1
**Last Updated:** September 2026

This document provides a comprehensive architectural overview of the Enterprise Application Foundation designed for AI-assisted development with specialized coding agents.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [Architecture Principles](#3-architecture-principles)
4. [Technology Stack](#4-technology-stack)
5. [Component Architecture](#5-component-architecture)
6. [Data Architecture](#6-data-architecture)
7. [Security Architecture](#7-security-architecture)
8. [API Architecture](#8-api-architecture)
9. [Frontend Architecture](#9-frontend-architecture)
10. [Infrastructure Architecture](#10-infrastructure-architecture)
11. [Observability Architecture](#11-observability-architecture)
12. [Testing Architecture](#12-testing-architecture)
13. [Agent-Based Development Model](#13-agent-based-development-model)
14. [Development Workflows](#14-development-workflows)
15. [Appendices](#15-appendices)

---

## 1. Executive Summary

### Purpose

The Enterprise Application Foundation is a production-grade web application template that establishes:

- **Secure Authentication**: OAuth 2.0 with Google (extensible to other providers)
- **Fine-Grained Authorization**: Role-Based Access Control (RBAC) with permissions
- **Flexible Configuration**: JSONB-based settings framework for system and user preferences
- **Enterprise Observability**: OpenTelemetry instrumentation with traces, metrics, and structured logs
- **Agent-Friendly Development**: Modular architecture designed for AI coding agent collaboration

### Key Characteristics

| Aspect | Description |
|--------|-------------|
| **Architecture Style** | Monorepo with API-first design |
| **Hosting Model** | Same-origin (UI and API share base URL) |
| **Auth Strategy** | OAuth 2.0 + JWT with refresh token rotation |
| **Access Control** | Email allowlist + RBAC (Admin/Contributor/Viewer) |
| **Data Storage** | PostgreSQL with Prisma ORM |
| **Extensibility** | JSONB settings, modular NestJS structure |

### Target Audience

- **AI Coding Agents**: Primary consumers for automated development tasks
- **Backend Developers**: NestJS/Node.js engineers
- **Frontend Developers**: React/TypeScript engineers
- **DevOps Engineers**: Infrastructure and deployment specialists
- **Security Teams**: Security review and compliance

---

## 2. System Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              NGINX REVERSE PROXY                             │
│                           (Security Headers, Routing)                        │
│                              http://localhost:3535                           │
├────────────────────────────────────┬────────────────────────────────────────┤
│         /* → Frontend (Web)        │           /api/* → Backend (API)       │
├────────────────────────────────────┼────────────────────────────────────────┤
│                                    │                                        │
│  ┌──────────────────────────────┐  │  ┌──────────────────────────────────┐  │
│  │       REACT FRONTEND         │  │  │       NESTJS + FASTIFY           │  │
│  │                              │  │  │                                  │  │
│  │  ┌────────────────────────┐  │  │  │  ┌────────────────────────────┐  │  │
│  │  │      Pages/Routes      │  │  │  │  │    Controllers/Guards      │  │  │
│  │  │  • Login               │  │  │  │  │  • AuthController          │  │  │
│  │  │  • Home                │  │  │  │  │  • UsersController         │  │  │
│  │  │  • User Settings       │  │  │  │  │  • SettingsController      │  │  │
│  │  │  • System Settings     │  │  │  │  │  • HealthController        │  │  │
│  │  │  • Device Activation   │  │  │  │  └────────────────────────────┘  │  │
│  │  └────────────────────────┘  │  │  │                                  │  │
│  │                              │  │  │  ┌────────────────────────────┐  │  │
│  │  ┌────────────────────────┐  │  │  │  │    Services/Business       │  │  │
│  │  │  Contexts/State        │  │  │  │  │    Logic Layer             │  │  │
│  │  │  • AuthContext         │  │  │  │  │  • AuthService             │  │  │
│  │  │  • ThemeContext        │  │  │  │  │  • UsersService            │  │  │
│  │  │  • SettingsContext     │  │  │  │  │  • SettingsService         │  │  │
│  │  └────────────────────────┘  │  │  │  │  • AllowlistService        │  │  │
│  │                              │  │  │  └────────────────────────────┘  │  │
│  │  ┌────────────────────────┐  │  │  │                                  │  │
│  │  │  Material UI (MUI)     │  │  │  │  ┌────────────────────────────┐  │  │
│  │  │  • Components          │  │  │  │  │    Prisma ORM              │  │  │
│  │  │  • Theming             │  │  │  │  │  • Database Access         │  │  │
│  │  │  • Responsive Design   │  │  │  │  │  • Query Building          │  │  │
│  │  └────────────────────────┘  │  │  │  │  • Migrations              │  │  │
│  │                              │  │  │  └────────────────────────────┘  │  │
│  └──────────────────────────────┘  │  └──────────────────────────────────┘  │
│                                    │                │                       │
│              Port 5173             │                │      Port 3000        │
└────────────────────────────────────┴────────────────┼───────────────────────┘
                                                      │
                                                      ▼
                                     ┌────────────────────────────────┐
                                     │        POSTGRESQL              │
                                     │                                │
                                     │  Tables:                       │
                                     │  • users, user_identities      │
                                     │  • roles, permissions          │
                                     │  • user_roles, role_permissions│
                                     │  • user_settings               │
                                     │  • system_settings             │
                                     │  • refresh_tokens              │
                                     │  • device_codes                │
                                     │  • allowed_emails              │
                                     │  • audit_events                │
                                     │                                │
                                     │           Port 5432            │
                                     └────────────────────────────────┘
                                                      │
                                                      ▼
                                     ┌────────────────────────────────┐
                                     │    OBSERVABILITY STACK         │
                                     │                                │
                                     │  • OTEL Collector              │
                                     │  • Uptrace (Traces/Metrics)    │
                                     │  • ClickHouse (Storage)        │
                                     │                                │
                                     │        Port 14318 (UI)         │
                                     └────────────────────────────────┘
```

### Request Flow

```
┌──────┐    ┌───────┐    ┌─────────────┐    ┌──────────────┐    ┌────────────┐
│Client│───▶│ Nginx │───▶│ JwtAuthGuard│───▶│ RolesGuard   │───▶│ Controller │
└──────┘    └───────┘    └─────────────┘    └──────────────┘    └────────────┘
                              │                    │                   │
                              ▼                    ▼                   ▼
                         Validate JWT       Check Roles/        Business Logic
                         Load User          Permissions         Response
```

---

## 3. Architecture Principles

### 3.1 Separation of Concerns

| Layer | Responsibility | Location |
|-------|---------------|----------|
| **Presentation** | User interaction, rendering, UX | `apps/web/` |
| **API Gateway** | HTTP handling, validation, auth | `apps/api/src/*/controllers/` |
| **Business Logic** | Domain rules, orchestration | `apps/api/src/*/services/` |
| **Data Access** | Database operations, queries | Prisma via services |
| **Infrastructure** | Routing, containers, config | `infra/` |

**Rule**: Frontend handles presentation only. All business logic resides in the API.

### 3.2 Same-Origin Hosting

All components served from the same base URL via Nginx reverse proxy:

| Path | Component | Purpose |
|------|-----------|---------|
| `/` | Frontend (React) | User interface |
| `/api/*` | Backend (NestJS) | REST API |
| `/api/docs` | Scalar API reference | Interactive API documentation |
| `/api/openapi.json` | OpenAPI spec | Machine-readable API schema |

**Benefits**: No CORS complexity, simplified cookie handling, unified deployment.

### 3.3 Security by Default

- **Authentication Required**: All API endpoints require JWT unless explicitly marked `@Public()`
- **Authorization Enforced**: RBAC guards verify roles/permissions before controller execution
- **Input Validated**: Zod schemas validate all request payloads
- **Secrets Protected**: Environment variables only, never committed to source

### 3.4 API-First Design

- **Contract-Driven**: OpenAPI specification generated from code annotations
- **Versioned**: API paths support future versioning (`/api/v1/`)
- **Consistent**: Standardized response format for success and errors
- **Documented**: Every endpoint documented with OpenAPI decorators; the published
  document is assembled in `apps/api/src/openapi/` and linted by Spectral in CI
  (see [`docs/specs/api-documentation.md`](specs/api-documentation.md))

### 3.5 Observable by Design

- **Traced**: OpenTelemetry auto-instrumentation for all HTTP and DB operations
- **Metered**: Request counts, durations, error rates exposed as metrics
- **Logged**: Structured JSON logging with correlation IDs
- **Health-Checked**: Liveness and readiness endpoints for orchestration

---

## 4. Technology Stack

### 4.1 Core Technologies

| Component | Technology | Version | Purpose |
|-----------|------------|---------|---------|
| **Runtime** | Node.js | 24+ (LTS) | Server runtime |
| **Language** | TypeScript | 6.x | Type safety |
| **Backend Framework** | NestJS | 11.x | API structure |
| **HTTP Adapter** | Fastify | 5.x | High-performance HTTP |
| **Frontend Framework** | React | 19.x | UI rendering |
| **UI Library** | Material UI (MUI) | 9.x | Component library |
| **Database** | PostgreSQL | 16+ | Data persistence |
| **ORM** | Prisma | 7.x | Database access |

### 4.2 Authentication & Security

| Component | Technology | Purpose |
|-----------|------------|---------|
| **OAuth Strategy** | Passport.js | OAuth flow handling |
| **OAuth Provider** | Google OAuth 2.0 | Primary identity provider |
| **Token Format** | JWT (HS256) | Stateless authentication |
| **Validation** | Zod | Runtime schema validation |
| **Security Headers** | Helmet (via Nginx) | HTTP security headers |

### 4.3 Infrastructure

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Containerization** | Docker | Application packaging |
| **Orchestration** | Docker Compose | Local development environment |
| **Reverse Proxy** | Nginx | Routing, SSL termination, headers |
| **Observability** | OpenTelemetry + Uptrace | Traces, metrics, logs |
| **Logging** | Pino | Structured JSON logging |

### 4.4 Testing

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Backend Unit Tests** | Jest + jest-mock-extended | Service/guard testing with mocked Prisma |
| **Backend Integration** | Jest + Supertest | HTTP endpoint testing with mocked database |
| **Prisma Mocking** | jest-mock-extended (DeepMockProxy) | Type-safe database mocking |
| **Frontend Tests** | Vitest + React Testing Library | Component and context testing |
| **Frontend API Mocking** | MSW (Mock Service Worker) | Network request interception |
| **E2E (Optional)** | Playwright | Full system testing |

**Key Testing Characteristics:**
- Backend tests use **mocked PrismaService** by default (no real database required)
- Integration tests verify full HTTP request/response cycle with mocked data layer
- Frontend tests run in jsdom environment with MSW intercepting API calls
- Coverage thresholds: 70% minimum for frontend (enforced in vitest.config.ts)

---

## 5. Component Architecture

### 5.1 Repository Structure

```
EnterpriseAppBase/
├── apps/
│   ├── api/                          # Backend API (NestJS + Fastify)
│   │   ├── src/
│   │   │   ├── auth/                 # Authentication module
│   │   │   │   ├── controllers/
│   │   │   │   ├── services/
│   │   │   │   ├── guards/
│   │   │   │   ├── strategies/
│   │   │   │   └── decorators/
│   │   │   ├── users/                # User management module
│   │   │   ├── settings/             # Settings module (user + system)
│   │   │   ├── allowlist/            # Email allowlist module
│   │   │   ├── device-auth/          # Device authorization (RFC 8628)
│   │   │   ├── storage/              # File storage subsystem (§5.4)
│   │   │   ├── pat/                  # Personal access tokens
│   │   │   ├── notifications/        # Notification dispatcher + SSE (§5.5)
│   │   │   ├── email/                # Email providers + templates (§5.6)
│   │   │   ├── credentials/          # Encrypted runtime credential store (§5.6)
│   │   │   ├── openapi/              # /api/docs, /api/openapi.json
│   │   │   ├── test-auth/            # Test-only auth bypass (non-production)
│   │   │   ├── health/               # Health check module
│   │   │   ├── prisma/               # Prisma service
│   │   │   ├── common/               # Shared utilities
│   │   │   │   ├── constants/
│   │   │   │   ├── crypto/           # AES-256-GCM secret cipher
│   │   │   │   ├── schemas/          # Shared Zod namespace schemas
│   │   │   │   ├── filters/
│   │   │   │   └── interceptors/
│   │   │   ├── config/               # Configuration module
│   │   │   ├── instrumentation.ts    # OpenTelemetry bootstrap (loaded before Nest)
│   │   │   └── main.ts               # Application entry
│   │   ├── prisma/
│   │   │   ├── schema.prisma         # Database schema
│   │   │   ├── migrations/           # Migration history
│   │   │   └── seed.ts               # Database seeding
│   │   ├── scripts/                  # dump-openapi.ts, smoke-test.mjs, etc.
│   │   ├── test/                     # Integration tests
│   │   └── Dockerfile
│   │
│   ├── web/                          # Frontend (React + MUI)
│   │   ├── src/
│   │   │   ├── components/           # Reusable UI components
│   │   │   ├── pages/                # Page components
│   │   │   ├── contexts/             # React context providers
│   │   │   ├── hooks/                # Custom hooks
│   │   │   ├── services/             # API client
│   │   │   ├── config/               # Section registries (§ Settings UI Pattern)
│   │   │   ├── theme/                # MUI theme configuration
│   │   │   ├── types/                # TypeScript types
│   │   │   ├── utils/                # Small stateless helpers
│   │   │   └── __tests__/            # Component/page/context tests (mirrors src/)
│   │   └── Dockerfile
│   │
│   └── cli/                          # First-party CLI (`appctl`, epic #110/#168)
│       ├── src/
│       │   ├── commands/             # login, api, config, deploy
│       │   ├── deploy/               # `appctl deploy` pipelines
│       │   │   ├── checks/           # doctor checks (host, dns, tls, database)
│       │   │   └── steps/            # install/update step pipeline
│       │   └── tui/                  # Interactive ink menu (real terminals only)
│       │       └── screens/
│       └── README.md                 # CLI usage, install, deploy command reference
│
├── packages/
│   └── shared/                       # `@app/shared` — cross-app constants (§5.8)
│
├── docs/                             # Documentation
│   ├── ARCHITECTURE.md               # This document
│   ├── SECURITY-ARCHITECTURE.md      # Security details
│   ├── API.md                        # API reference
│   ├── DEVELOPMENT.md                # Development guide
│   ├── TESTING.md                    # Testing guide
│   ├── DEVICE-AUTH.md                # Device auth guide
│   ├── personal-access-tokens.md     # PAT guide
│   ├── deployment/
│   │   └── vps.md                    # VPS deploy runbook
│   ├── runbooks/
│   │   └── rotate-secrets-encryption-key.md
│   └── specs/                        # Living design records (5 total)
│       ├── settings-ui.md
│       ├── navigation-ia.md
│       ├── datatable.md
│       ├── api-documentation.md
│       └── vps-deploy.md
│
├── infra/                            # Infrastructure configuration
│   ├── compose/
│   │   ├── base.compose.yml          # Core services
│   │   ├── dev.compose.yml           # Development overrides
│   │   ├── prod.compose.yml          # Production overrides
│   │   ├── test.compose.yml          # Ephemeral Postgres for tests
│   │   ├── vps.compose.yml           # Loopback-only overrides for a shared host proxy (§10)
│   │   ├── otel.compose.yml          # Observability stack
│   │   └── .env.example              # Environment template
│   ├── nginx/
│   │   └── nginx.conf                # Reverse proxy config
│   └── otel/
│       ├── otel-collector-config.yaml
│       └── uptrace.yml
│
├── tests/                            # Cross-app test suites (own package.json each)
│   ├── e2e/                          # Full-stack Playwright E2E against Compose
│   └── visual/                       # Pixel visual regression (pinned container)
│
├── .claude/                          # AI agent configuration
│   └── agents/
│       ├── backend-dev.md            # Backend specialist
│       ├── frontend-dev.md           # Frontend specialist
│       ├── database-dev.md           # Database specialist
│       ├── testing-dev.md            # Testing specialist
│       ├── docs-dev.md               # Documentation specialist
│       └── ops-dev.md                # Routine operations specialist
│
├── scripts/                          # Repo-level dev/worktree helper scripts
├── install.sh                        # `appctl` installer (curl | bash)
├── openapi.json                      # Generated OpenAPI dump (gitignored; `npm run openapi:dump`)
├── CLAUDE.md                         # AI assistant guidance
└── README.md                         # Project overview
```

### 5.2 Backend Module Structure

Each NestJS module follows a consistent pattern:

```
module-name/
├── module-name.module.ts         # Module definition
├── module-name.controller.ts     # HTTP endpoints
├── module-name.service.ts        # Business logic
├── dto/                          # Data Transfer Objects
│   ├── create-item.dto.ts
│   └── update-item.dto.ts
├── interfaces/                   # TypeScript interfaces
├── guards/                       # Module-specific guards
└── module-name.controller.spec.ts  # Unit tests
```

### 5.3 Frontend Component Structure

Components and pages are **flat files grouped by topic directory**, not one
folder per component. There is no per-component barrel `index.ts` (the sole
exception is `components/datatable/index.ts`, which re-exports a small public
surface for a genuinely multi-file subsystem) and no test file co-located next
to the component it covers — every test lives under `src/__tests__/`, in a
directory tree that mirrors `src/` file-for-file:

```
components/
├── admin/
│   ├── UserList.tsx
│   └── AllowlistTable.tsx
├── navigation/
│   ├── AppBar.tsx
│   ├── NavigationRail.tsx
│   ├── BottomNav.tsx
│   └── NotificationBell.tsx
├── settings/
│   └── SettingsHub.tsx           # Shared by every settings surface (CLAUDE.md rule 4)
└── common/
    └── RequirePermission.tsx

pages/
├── HomePage.tsx
├── UserSettingsHubPage.tsx
└── Admin/
    ├── SettingsHubPage.tsx
    ├── EmailSettingsPage.tsx
    └── UsersPage.tsx

__tests__/
├── components/
│   ├── admin/UserList.test.tsx
│   └── navigation/AppBar.test.tsx
└── pages/
    └── Admin/EmailSettingsPage.test.tsx
```

### 5.4 Storage Subsystem

The storage system provides file upload and management capabilities with support for large files through resumable multipart uploads.

#### Architecture Overview

The storage system uses a provider abstraction pattern to support multiple cloud storage backends while maintaining a consistent API.

```
┌─────────────────────────────────────────────────────────────┐
│                    Storage Module                            │
├─────────────────────────────────────────────────────────────┤
│  Objects Controller                                          │
│  └── Upload/Download/CRUD endpoints                          │
├─────────────────────────────────────────────────────────────┤
│  Objects Service                                             │
│  └── Business logic, ownership validation                    │
├─────────────────────────────────────────────────────────────┤
│  Storage Provider Interface                                  │
│  ├── S3StorageProvider (implemented)                         │
│  └── AzureStorageProvider (future)                          │
├─────────────────────────────────────────────────────────────┤
│  Object Processing Pipeline                                  │
│  └── Async post-upload processing with pluggable processors  │
└─────────────────────────────────────────────────────────────┘
```

#### Upload Flow

**1. Resumable Upload (Large Files)**:
   - Client calls `/api/storage/objects/upload/init` with file metadata
   - Server creates DB record, initializes S3 multipart, returns presigned URLs
   - Client uploads parts directly to S3 (bypasses application server)
   - Client calls `/api/storage/objects/:id/upload/complete` with part ETags
   - Server finalizes upload with S3, triggers processing pipeline

**2. Simple Upload (Small Files < 100MB)**:
   - Client sends file via multipart/form-data to `/api/storage/objects`
   - Server streams directly to S3
   - Processing pipeline triggered on completion

#### Processing Pipeline

Post-upload processing is handled asynchronously via NestJS EventEmitter:

```
ObjectUploadedEvent (emitted)
         ↓
ObjectProcessingService (orchestrator)
         ↓
Registered Processors (run in priority order)
         ↓
Results aggregated into object metadata
         ↓
Status updated: ready | failed
```

**Key Features:**
- Pluggable processor architecture
- Priority-based execution order
- Processors run asynchronously (non-blocking)
- Results stored in object metadata JSONB field
- Extensible for future processing needs (virus scanning, image resizing, etc.)

#### Database Schema

**storage_objects**:
- File metadata, status, storage key
- Owner reference (user_id)
- Processing results in JSONB metadata field

**storage_object_chunks**:
- Tracks multipart upload progress
- Part number, ETag, upload status
- Enables resume capability

#### Module Structure

```
apps/api/src/storage/
├── storage.module.ts                # Module definition
├── objects/
│   ├── objects.controller.ts        # HTTP endpoints
│   ├── objects.service.ts           # Business logic
│   ├── dto/                         # Data transfer objects
│   └── interfaces/
├── providers/
│   ├── storage-provider.interface.ts
│   └── s3-storage.provider.ts
└── processing/
    ├── object-processing.service.ts
    └── processors/
        └── base-processor.interface.ts
```

### 5.5 Notifications Subsystem

Epic #109. One registry declares every notification event; a single
dispatcher fans it out over per-event, per-channel-capable transports; a
durable per-user inbox and an ephemeral live stream sit side by side as two
different answers to two different questions.

#### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                  NOTIFICATION_EVENTS registry                │
│  notifications/notification-events.ts — key, label,          │
│  description, channels[], defaultEnabled, mandatory?         │
├─────────────────────────────────────────────────────────────┤
│  NotificationsService.notify(eventKey, userId, data)         │
│  NotificationsService.notifyAddress(eventKey, email, data)   │
│  └── resolves preferences → resolveChannels() → dispatch     │
├───────────────────────────┬───────────────────────────────────┤
│  EmailNotificationChannel  │  BrowserNotificationChannel       │
│  → EVENT_EMAIL_TEMPLATES   │  → EVENT_BROWSER_TEMPLATES        │
│  → EmailSettingsService    │  → writes `notifications` row     │
│                             │  → publishes to NotificationStream│
├───────────────────────────┴───────────────────────────────────┤
│  NotificationDeliveryService → notification_deliveries table  │
│  (one row per attempt, per channel — the operator's record)   │
└─────────────────────────────────────────────────────────────┘
```

#### The registry is the single declaration point

`NOTIFICATION_EVENTS` (`apps/api/src/notifications/notification-events.ts`) is
plain data, not a Nest provider, read by three consumers that would otherwise
drift: the dispatcher (what to send, over what, to whom), the
`/settings/notifications` preferences matrix (`GET /api/notifications/events`),
and the docs/admin surfaces. Each entry declares:

- `key` — a stable, namespaced (`<area>.<event>`) string persisted in
  preferences and delivery records; never renamed in place.
- `channels` — which of `NOTIFICATION_CHANNELS` (`'email' | 'browser'`) this
  event is *capable* of using (`allowlist.invitation` is email-only because
  its recipient has no account and no open tab by definition).
- `defaultEnabled` — what an untouched account gets.
- `mandatory?: true` — the user cannot opt out on any declared channel; the
  resolver ignores stored preferences entirely for these. Only
  `security.role_changed` is mandatory today.

The **sparse-preference contract**: no preference row is materialised until a
user changes something. Absent means "the registry default applies," resolved
at read time by `readNotificationPreferences` / `resolveChannels`
(`notification-preferences.ts`) — never stored as a default. The write side of
the same contract is the `dataTables`/`navigation`/`notifications` namespaces
in `user_settings.value` (see §6.2).

#### The dispatcher: `notify()` / `notifyAddress()`

`NotificationsService` (`notifications.service.ts`) is the one entry point.
Both methods:

- Fire **after** the triggering write has committed, called **outside** any
  `$transaction` — the notification is not part of the business transaction.
- Are **detached**: the work is scheduled on a later microtask and the
  returned promise resolves as soon as scheduling succeeds, not once anything
  is rendered or sent. There is deliberately no queue (no Redis, no worker,
  no `jobs` table) — the trade-off accepted is no durability and no retry
  across a process crash, in exchange for zero new ops surface.
- **Never reject** — not for a DB failure, a mail server, a template bug, or
  an unknown event key (which is a silent no-op, since a stale key raised by
  an un-updated caller must not fail the action that raised it).
- Record every attempt in `notification_deliveries`, so "did the user get
  it?" is answered by a query, never by log-diving.

`notifyAddress(eventKey, email, data)` exists for a recipient with **no user
account** (an allowlist invitation): it looks the address up first — an
address that resolves to a real account is routed through the ordinary
preference-resolving path, never bypassed — and only falls back to an
account-less recipient (empty preferences, resolving to the registry default)
when truly no account exists.

`NotificationsService.flush()` / `onModuleDestroy()` drain in-flight
dispatches on shutdown, within a bound, so a rolling deploy does not routinely
drop notifications the way a hard crash would.

#### Durable inbox vs. lossy live stream

Two tables answer two different questions, and are not the same data twice:

| | `notification_deliveries` | `notifications` |
|---|---|---|
| Unit | One row per delivery **attempt**, per channel | One row per thing a user should see |
| Audience | Operators ("did we try, what did the provider say?") | The user's own inbox (bell) |
| Covers | Email **and** browser, incl. account-less recipients | Browser channel only, real accounts only |
| On user delete | `SetNull` (audit trail outlives the account) | `Cascade` (personal data, no reader once gone) |

`NotificationStreamService` (`notification-stream.service.ts`) is the SSE
layer on top of the `notifications` table, exposed at `GET
/api/notifications/stream` via Nest's `@Sse()` decorator (confirmed to work
under the Fastify adapter — it unwraps to the raw Node `ServerResponse`). It
is explicitly **not a delivery guarantee**: there is no buffer, no
`Last-Event-ID`, no cross-replica fan-out, and anything published while a
connection is down is lost. The client is expected to refetch `GET
/api/notifications/unread-count` and `GET /api/notifications` on every
(re)connect, which is what makes a gap harmless — the `notifications` table,
not the stream, is the source of truth. Nginx needs a dedicated
`proxy_buffering off` location for this route (see §10.2).

#### Module structure

```
apps/api/src/notifications/
├── notification-events.ts              # The registry
├── notification-preferences.ts         # Sparse-contract resolution
├── notifications.service.ts            # notify() / notifyAddress() dispatcher
├── notification-delivery.service.ts    # notification_deliveries writer
├── notification-store.service.ts       # notifications table CRUD (per-user scoped)
├── notification-stream.service.ts      # SSE subscriber registry
├── notifications.controller.ts         # events / stream / list / unread-count / read
└── channels/
    ├── email-notification.channel.ts   # EVENT_EMAIL_TEMPLATES map
    └── browser-notification.channel.ts # EVENT_BROWSER_TEMPLATES map + inbox write
```

### 5.6 Email & Credentials Subsystem

Two closely related pieces: how outbound mail is sent and templated, and how
the SMTP password (and future runtime secrets) that make it possible are
stored safely.

#### Email provider abstraction and templates

`apps/api/src/email/` defines an `EmailProvider` interface
(`providers/email-provider.interface.ts`) with two implementations —
`SmtpEmailProvider` and `SesEmailProvider` — selected and configured by
`EmailSettingsService` from the admin-configured `email-settings` (`GET/PUT
/api/email-settings`, `system_settings:read`/`:write`) plus the encrypted SMTP
password from `CredentialsService`.

Templates are a **three-way-locked registry** (`templates/index.ts`), the same
"one declaration point" idea as `notification-events.ts` on a different axis:
adding a template means adding both an entry to `EmailTemplateDataMap` (the
data type) and to `EMAIL_TEMPLATES` (the render function) — `EmailTemplateName`
is *derived* from the data map, so a half-registered template is a compile
error in either direction. A notification event is connected to its template
by an explicit, separate map, `EVENT_EMAIL_TEMPLATES`
(`notifications/channels/email-notification.channel.ts`) — kept explicit
rather than derived so a rename on either side fails loudly instead of
silently matching the wrong template.

Every template builds its HTML body with the `html` **tagged template
literal** (`templates/safe-html.ts`): every interpolation is escaped by
construction, so writing a template the natural way is writing it safely, and
emitting deliberately unescaped markup requires reaching for
`SafeHtml.unsafeFromTrustedString` — longer to type, and it greps out of the
tree in one command. There is deliberately **no HTML-to-text conversion
helper** — every template hand-writes its plain-text part alongside the HTML
one. `renderLayout` (`templates/layout.ts`) wraps every template and passes
any CTA URL through `safeUrl`. Live templates: `user-welcome.email.ts`,
`allowlist-invitation.email.ts`, `role-changed.email.ts`,
`test-email.email.ts`.

#### The encrypted credential store

`credentials` (Prisma model `Credential`) holds **runtime-configured**
secrets — an SMTP password typed into the admin UI today, an OAuth client
secret or a second bucket's S3 key potentially tomorrow — addressed by
`(purpose, name)` rather than one bespoke column per consumer. This is
distinct from every *deploy-time* secret in this document's Environment
Variables section (`JWT_SECRET`, `GOOGLE_CLIENT_SECRET`, `AWS_SECRET_ACCESS_KEY`),
which correctly stay in the environment and never touch this table.

`CredentialsService` (`apps/api/src/credentials/`) is the sole reader/writer
and holds two invariants: **no plaintext egress** — `getSecret()` (plaintext,
server-side only) and `describe()`/`list()` (presentation, e.g. a masked
`hint`) are different methods returning different types, and neither this
service nor `common/crypto/secret-cipher.ts` may interpolate a secret value
into a log line or error message; and **blank preserves** — an admin form
renders the password field empty (the stored value is unreadable through the
API) and an empty submission on `PUT /api/email-settings` keeps the stored
password rather than erasing it.

The cipher (`apps/api/src/common/crypto/secret-cipher.ts`) is **AES-256-GCM**,
keyed by `SECRETS_ENCRYPTION_KEY` (base64-encoded 32 bytes). Each row's
`secret` column is a self-describing, base64-encoded payload of
`[iv: 12 bytes][authTag: 16 bytes][ciphertext]`, so the IV and auth tag can
never drift into separate columns from the ciphertext they authenticate. A
per-`purpose` sub-key is derived from the master key via **HMAC-SHA256**
(not a password KDF like scrypt/argon2 — the master key is already
high-entropy, so a KDF's deliberate slowness buys nothing and only costs
CPU), so a ciphertext lifted from one row cannot be decrypted under a
different purpose. `SECRETS_ENCRYPTION_KEY` is optional until the first
credential is stored, then mandatory at boot; see
[`docs/runbooks/rotate-secrets-encryption-key.md`](runbooks/rotate-secrets-encryption-key.md)
for rotation.

### 5.7 The CLI and VPS Deployment

`apps/cli` (`appctl`, epic #110) is the first-party command-line client for
this API: it authenticates via the device authorization flow (§ Device
Authorization), stores a personal access token, and exposes one generic `api
<method> <path>` command plus an interactive ink TUI (`src/tui/`) so it never
goes stale as endpoints are added or renamed. It is an npm workspace package,
built from this monorepo and installed standalone via `install.sh`, not
published to a registry.

`appctl deploy doctor|install|update|status` (epic #168, `apps/cli/src/deploy/`)
is the *entire* VPS deployment story for this application — there is no
separate deploy script, Ansible playbook, or SSH-driving code anywhere else in
the repo, and there shouldn't be. It runs **on** the target VPS (the CLI
itself never dials out over SSH), git-clones/pulls, runs `docker compose
build`/`up` against `infra/compose/vps.compose.yml` (§10.1), migrates and seeds
the database, and hands TLS to a shared host-level reverse proxy rather than
terminating it per-app.

This document does not restate that design — it lives in full, with the
rejected alternatives, in:

- [`docs/specs/vps-deploy.md`](specs/vps-deploy.md) — the design: why it runs
  on the VPS, why TLS is a shared host proxy, why there is no `db` service.
- [`docs/deployment/vps.md`](deployment/vps.md) — the operator runbook:
  prerequisites, first login, troubleshooting.
- [`apps/cli/README.md`](../apps/cli/README.md#deploying-to-a-server) — the
  command reference: flags and exit codes.

### 5.8 `@app/shared`

`packages/shared` (published to the workspace as `@app/shared`, epic #161) is
the single rebranding point for this template: today it exports exactly one
constant, `APP_NAME`, from a hand-written, build-step-free CommonJS module.
Every surface that renders the product's name — the web AppBar and page
title, the OpenAPI document and API reference page, email templates, and the
CLI's banner/`--help`/device name — derives from this one constant rather than
restating it. Full rationale (why CommonJS with no build step, why it isn't
also where `notification-events.ts` lives, the Vite `optimizeDeps.include`
trap) and the current consumer list are maintained in
[`packages/shared/README.md`](../packages/shared/README.md) — see that file
before adding a second constant or a second consumer.

---

## 6. Data Architecture

### 6.1 Entity Relationship Diagram

```
┌────────────────────┐       ┌────────────────────┐
│       users        │       │   user_identities  │
├────────────────────┤       ├────────────────────┤
│ id (PK, UUID)      │──┐    │ id (PK, UUID)      │
│ email (UNIQUE)     │  │    │ user_id (FK)       │──┘
│ display_name       │  └───▶│ provider           │
│ provider_display   │       │ provider_subject   │
│ profile_image_url  │       │ provider_email     │
│ provider_image_url │       │ created_at         │
│ is_active          │       └────────────────────┘
│ created_at         │
│ updated_at         │       ┌────────────────────┐
└────────────────────┘       │    user_settings   │
         │                   ├────────────────────┤
         │                   │ id (PK, UUID)      │
         │                   │ user_id (FK, UNIQUE)│◀─┐
         │                   │ value (JSONB)      │  │
         │                   │ version            │  │
         ▼                   │ updated_at         │  │
┌────────────────────┐       └────────────────────┘  │
│    user_roles      │                               │
├────────────────────┤                               │
│ user_id (FK, PK)   │───────────────────────────────┘
│ role_id (FK, PK)   │──┐
└────────────────────┘  │    ┌────────────────────┐
                        │    │       roles        │
                        │    ├────────────────────┤
                        └───▶│ id (PK, UUID)      │
                             │ name (UNIQUE)      │
                             │ description        │
                             └────────────────────┘
                                       │
                                       ▼
                             ┌────────────────────┐
                             │  role_permissions  │
                             ├────────────────────┤
                             │ role_id (FK, PK)   │
                             │ permission_id (PK) │──┐
                             └────────────────────┘  │
                                                     │
                             ┌────────────────────┐  │
                             │    permissions     │  │
                             ├────────────────────┤  │
                             │ id (PK, UUID)      │◀─┘
                             │ name (UNIQUE)      │
                             │ description        │
                             └────────────────────┘

┌────────────────────┐       ┌────────────────────┐
│  system_settings   │       │   refresh_tokens   │
├────────────────────┤       ├────────────────────┤
│ id (PK, UUID)      │       │ id (PK, UUID)      │
│ key (UNIQUE)       │       │ user_id (FK)       │
│ value (JSONB)      │       │ token_hash (UNIQUE)│
│ version            │       │ expires_at         │
│ updated_by_user_id │       │ created_at         │
│ updated_at         │       │ revoked_at         │
└────────────────────┘       └────────────────────┘

┌────────────────────┐       ┌────────────────────┐
│   allowed_emails   │       │    device_codes    │
├────────────────────┤       ├────────────────────┤
│ id (PK, UUID)      │       │ id (PK, UUID)      │
│ email (UNIQUE)     │       │ device_code_hash   │
│ added_by_id (FK)   │       │ user_code (UNIQUE) │
│ added_at           │       │ user_id (FK)       │
│ claimed_by_id (FK) │       │ client_info (JSONB)│
│ claimed_at         │       │ status             │
│ notes              │       │ expires_at         │
└────────────────────┘       │ last_polled_at     │
                             └────────────────────┘

┌────────────────────┐
│    audit_events    │
├────────────────────┤
│ id (PK, UUID)      │
│ actor_user_id (FK) │
│ action             │
│ target_type        │
│ target_id          │
│ meta (JSONB)       │
│ created_at         │
└────────────────────┘

┌────────────────────┐       ┌────────────────────────┐
│  storage_objects   │       │ storage_object_chunks  │
├────────────────────┤       ├────────────────────────┤
│ id (PK, UUID)      │──┐    │ id (PK, UUID)          │
│ uploaded_by_id (FK)│  │    │ object_id (FK)         │──┘
│ name               │  └───▶│ part_number            │
│ size (BigInt)      │       │ e_tag                  │
│ mime_type          │       │ size (BigInt)          │
│ storage_key        │       │ uploaded_at            │
│ storage_provider   │       └────────────────────────┘
│ bucket             │
│ s3_upload_id       │
│ status             │
│ metadata (JSONB)   │
│ created_at         │
│ updated_at         │
└────────────────────┘

┌──────────────────────┐     ┌────────────────────────┐
│ personal_access_tokens│     │      credentials       │
├──────────────────────┤     ├────────────────────────┤
│ id (PK, UUID)        │     │ id (PK, UUID)          │
│ user_id (FK)         │     │ purpose                │
│ name                 │     │ name                   │
│ token_hash (UNIQUE)  │     │ secret (opaque, AES-GCM)│
│ token_prefix         │     │ hint                   │
│ duration_value       │     │ label                  │
│ duration_unit        │     │ updated_by_user_id (FK)│
│ expires_at           │     │ created_at             │
│ last_used_at         │     │ updated_at             │
│ created_at           │     └────────────────────────┘
│ revoked_at           │     UNIQUE (purpose, name)
└──────────────────────┘

┌─────────────────────────┐   ┌────────────────────┐
│ notification_deliveries │   │    notifications    │
├─────────────────────────┤   ├────────────────────┤
│ id (PK, UUID)           │   │ id (PK, UUID)      │
│ event_key (plain string)│   │ user_id (FK)       │
│ user_id (FK, nullable)  │   │ event_key          │
│ recipient               │   │ title              │
│ channel (plain string)  │   │ body               │
│ status (enum)           │   │ link               │
│ provider_message_id     │   │ read_at            │
│ error                   │   │ created_at         │
│ created_at              │   └────────────────────┘
│ updated_at              │   user_id FK: ON DELETE CASCADE
└─────────────────────────┘   (personal inbox — dies with the account)
user_id FK: ON DELETE SET NULL
(operator audit trail — outlives the account)
```

### 6.2 JSONB Schema Definitions

#### User Settings Shape

`theme` and `profile` are always present; `dataTables`, `navigation`, and
`notifications` are **sparse namespaces** — each is emitted only when the
user has actually stored something for it, and an absent namespace means
"apply the client's built-in default," never a materialised default value.
None of the three ever carries a `.default()` in its Zod schema
(`apps/api/src/common/schemas/user-settings-namespaces.schema.ts`): defaulting
`visibleColumns` to today's column list, for example, would freeze that list
into the row the first time a user touched an unrelated preference, silently
hiding every column added afterward.

```json
{
  "theme": "light | dark | system",
  "profile": {
    "displayName": "string | null",
    "useProviderImage": true,
    "customImageUrl": "string | null"
  },
  "dataTables": {
    "<tableId>": {
      "visibleColumns": ["col1", "col2"],
      "density": "compact | standard | comfortable",
      "sort": { "field": "string", "direction": "asc | desc" },
      "pageSize": 25
    }
  },
  "navigation": {
    "railCollapsed": false
  },
  "notifications": {
    "email": { "user.welcome": false },
    "browser": { "security.role_changed": true }
  }
}
```

`dataTables` is keyed by table id (max 40 tables/user); a `PATCH` replaces a
named table's entry wholesale rather than deep-merging it, and `null` deletes
that table's entry. `notifications` is **channel-outer, event-inner** — the
shape `readNotificationPreferences` parses — and a `PATCH` deep-merges per
event key, where `null` at any of the three levels (namespace / channel /
event) deletes that level and falls back to the registry default. A stored
`false` for a `mandatory: true` event (§5.5) is accepted by the write schema
but is never consulted by the dispatcher — the `mandatory` gate lives solely
in preference *resolution*, not in validation.

#### System Settings Shape

`system_settings.value` — the JSONB column itself — holds only `ui` and
`features`:

```json
{
  "ui": {
    "allowUserThemeOverride": true
  },
  "features": {
    "exampleFlag": false
  }
}
```

`GET/PUT/PATCH /api/system-settings` project this stored row into
`SystemSettingsResponseDto`, which adds a `security` block on the way out:

```json
{
  "ui": {
    "allowUserThemeOverride": true
  },
  "security": {
    "jwtAccessTtlMinutes": 15,
    "refreshTtlDays": 14
  },
  "features": {
    "exampleFlag": false
  },
  "updatedAt": "...",
  "updatedBy": { "id": "...", "email": "..." },
  "version": 1
}
```

`security` is derived, read-only configuration — `jwtAccessTtlMinutes` and
`refreshTtlDays` are read from the `JWT_ACCESS_TTL_MINUTES` /
`JWT_REFRESH_TTL_DAYS` environment variables via `ConfigService`, not from the
database. It is never written to `system_settings.value`: the write schemas
(`updateSystemSettingsSchema` / `patchSystemSettingsSchema`) don't declare it,
so a client that sends it has the key silently stripped by the global
`ZodValidationPipe` before the request reaches the settings service.

### 6.3 Database Design Principles

| Principle | Implementation |
|-----------|---------------|
| **UUID Primary Keys** | All tables use UUID v4 for primary keys |
| **Timestamptz** | All timestamps use `timestamptz` for timezone awareness |
| **JSONB for Flexibility** | Settings stored as JSONB for schema-less extensibility |
| **Cascade Deletes** | Foreign keys cascade on user deletion |
| **Soft Deletes** | Users deactivated via `is_active` flag, not hard deleted |
| **Audit Trail** | `audit_events` table logs all security-relevant actions |

---

## 7. Security Architecture

### 7.1 Authentication Flow

```
┌─────────┐          ┌─────────┐          ┌─────────┐          ┌─────────┐
│  User   │          │ Frontend│          │   API   │          │ Google  │
└────┬────┘          └────┬────┘          └────┬────┘          └────┬────┘
     │                    │                    │                    │
     │  1. Click Login    │                    │                    │
     │───────────────────▶│                    │                    │
     │                    │                    │                    │
     │                    │ 2. Redirect to     │                    │
     │                    │    /api/auth/google│                    │
     │                    │───────────────────▶│                    │
     │                    │                    │                    │
     │                    │                    │ 3. Redirect to     │
     │◀───────────────────┼────────────────────┼────────────────────│
     │                    │                    │    Google OAuth    │
     │                    │                    │                    │
     │  4. Grant Consent  │                    │                    │
     │────────────────────┼────────────────────┼───────────────────▶│
     │                    │                    │                    │
     │                    │                    │ 5. Callback with   │
     │                    │                    │◀───────────────────│
     │                    │                    │    auth code       │
     │                    │                    │                    │
     │                    │                    │ 6. Exchange code   │
     │                    │                    │    for tokens      │
     │                    │                    │───────────────────▶│
     │                    │                    │                    │
     │                    │                    │◀───────────────────│
     │                    │                    │    User profile    │
     │                    │                    │                    │
     │                    │                    │ 7. Check allowlist │
     │                    │                    │    Provision user  │
     │                    │                    │    Generate JWT    │
     │                    │                    │    Store refresh   │
     │                    │                    │                    │
     │                    │ 8. Redirect with   │                    │
     │                    │◀───────────────────│                    │
     │                    │    access token    │                    │
     │                    │    + refresh cookie│                    │
     │                    │                    │                    │
     │ 9. Authenticated   │                    │                    │
     │◀───────────────────│                    │                    │
     │                    │                    │                    │
```

### 7.2 Token Strategy

| Token Type | Storage (Client) | Storage (Server) | Lifetime | Purpose |
|------------|-----------------|------------------|----------|---------|
| **Access Token** | Memory only | None (stateless) | 15 min | API authorization |
| **Refresh Token** | HttpOnly cookie | SHA256 hash in DB | 14 days | Obtain new access tokens |

**Security Properties:**
- Access tokens never touch localStorage (XSS protection)
- Refresh tokens in HttpOnly cookies (JavaScript cannot access)
- Refresh token rotation on each use (reuse detection)
- Database allows server-side revocation

### 7.3 RBAC Model

```
                    ┌─────────────────────────────────────────────┐
                    │                 PERMISSIONS                  │
                    ├─────────────────────────────────────────────┤
                    │ system_settings:read  │ system_settings:write│
                    │ user_settings:read    │ user_settings:write  │
                    │ users:read            │ users:write          │
                    │ rbac:manage           │ allowlist:read       │
                    │ allowlist:write       │                      │
                    └────────────┬───────────┴──────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
        ▼                        ▼                        ▼
┌───────────────┐      ┌───────────────┐      ┌───────────────┐
│     ADMIN     │      │  CONTRIBUTOR  │      │    VIEWER     │
├───────────────┤      ├───────────────┤      ├───────────────┤
│ ALL           │      │ user_settings:│      │ user_settings:│
│ PERMISSIONS   │      │   read/write  │      │   read        │
│               │      │               │      │               │
│ (Full Access) │      │ (Standard     │      │ (Least        │
│               │      │  User)        │      │  Privilege)   │
└───────────────┘      └───────────────┘      └───────────────┘
        │                        │                        │
        └────────────────────────┼────────────────────────┘
                                 │
                                 ▼
                        ┌───────────────┐
                        │     USERS     │
                        │  (Many-to-Many│
                        │   Assignment) │
                        └───────────────┘
```

### 7.4 Access Control Layers

```
Request → Nginx → JwtAuthGuard → RolesGuard → PermissionsGuard → Controller
            │           │             │              │
            │           │             │              └── Check @Permissions()
            │           │             │                  AND logic (all required)
            │           │             │
            │           │             └── Check @Roles() decorator
            │           │                 OR logic (any role matches)
            │           │
            │           └── Validate JWT, load user+roles+permissions
            │               Check user is active
            │
            └── Security headers, rate limiting (optional)
```

### 7.5 Email Allowlist

Before OAuth authentication completes:

1. Check if email matches `INITIAL_ADMIN_EMAIL` (bypass check)
2. Check if email exists in `allowed_emails` table
3. If not found, reject with "Email not authorized"
4. If found, proceed with user provisioning
5. Mark allowlist entry as "claimed" with user ID

**Management:**
- Admins add emails via `/api/allowlist` before users can login
- Claimed entries cannot be removed (protects existing users)
- Use user deactivation (`is_active: false`) to revoke access

---

## 8. API Architecture

### 8.1 Endpoint Categories

| Category | Base Path | Auth Required | Description |
|----------|-----------|---------------|-------------|
| **Health** | `/api/health/*` | No | Liveness/readiness probes |
| **Auth** | `/api/auth/*` | Varies | OAuth, JWT, sessions |
| **Users** | `/api/users/*` | Yes (Admin) | User management |
| **Settings** | `/api/user-settings/*` | Yes | User preferences |
| **System Settings** | `/api/system-settings/*` | Yes (Admin) | App configuration |
| **Allowlist** | `/api/allowlist/*` | Yes (Admin) | Access control |
| **Storage** | `/api/storage/objects/*` | Yes | File upload/download/CRUD |
| **Personal Access Tokens** | `/api/pat/*` | Yes | Manage own long-lived tokens |
| **Notifications** | `/api/notifications/*` | Yes | Event registry, SSE stream, inbox |
| **Email Settings** | `/api/email-settings/*` | Yes (Admin) | SMTP/SES configuration |

### 8.2 Complete Endpoint Reference

#### Authentication Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/auth/providers` | Public | List enabled OAuth providers |
| `GET` | `/api/auth/google` | Public | Initiate Google OAuth |
| `GET` | `/api/auth/google/callback` | Public | OAuth callback handler |
| `POST` | `/api/auth/refresh` | Cookie | Refresh access token |
| `POST` | `/api/auth/logout` | JWT | Single session logout |
| `POST` | `/api/auth/logout-all` | JWT | All sessions logout |
| `GET` | `/api/auth/me` | JWT | Current user info |
| `POST` | `/api/auth/test/login` | Public | Test login bypass (dev only) |

#### Device Authorization (RFC 8628)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/auth/device/code` | Public | Generate device code |
| `POST` | `/api/auth/device/token` | Public | Poll for authorization |
| `GET` | `/api/auth/device/activate` | JWT | Get activation info |
| `POST` | `/api/auth/device/authorize` | JWT | Approve/deny device |
| `GET` | `/api/auth/device/sessions` | JWT | List device sessions |
| `DELETE` | `/api/auth/device/sessions/:id` | JWT | Revoke device session |

#### User Management (Admin)

| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| `GET` | `/api/users` | `users:read` | List users (paginated) |
| `GET` | `/api/users/:id` | `users:read` | Get user details |
| `PATCH` | `/api/users/:id` | `users:write` | Update user |
| `PUT` | `/api/users/:id/roles` | `rbac:manage` | Update user roles |

#### Settings

| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| `GET` | `/api/user-settings` | `user_settings:read` | Get user settings |
| `PUT` | `/api/user-settings` | `user_settings:write` | Replace settings |
| `PATCH` | `/api/user-settings` | `user_settings:write` | Partial update |
| `GET` | `/api/system-settings` | `system_settings:read` | Get system settings |
| `PUT` | `/api/system-settings` | `system_settings:write` | Replace settings |
| `PATCH` | `/api/system-settings` | `system_settings:write` | Partial update |

#### Allowlist (Admin)

| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| `GET` | `/api/allowlist` | `allowlist:read` | List allowlisted emails |
| `POST` | `/api/allowlist` | `allowlist:write` | Add email |
| `DELETE` | `/api/allowlist/:id` | `allowlist:write` | Remove email (if pending) |

#### Storage Objects

Every route below is scoped to the caller's own objects via `storage:read` /
`storage:write` / `storage:delete`, enforced (with ownership checks) inside
`ObjectsService`; the `storage:*_any` permissions (Admin) additionally reach
every user's objects. See §5.4 for the upload flow.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/storage/objects` | List objects (paginated) |
| `GET` | `/api/storage/objects/:id` | Get object metadata |
| `GET` | `/api/storage/objects/:id/download` | Get signed download URL |
| `POST` | `/api/storage/objects` | Simple upload (multipart/form-data) |
| `POST` | `/api/storage/objects/upload/init` | Initialize resumable upload |
| `GET` | `/api/storage/objects/:id/upload/status` | Get upload progress |
| `POST` | `/api/storage/objects/:id/upload/complete` | Complete multipart upload |
| `DELETE` | `/api/storage/objects/:id/upload/abort` | Abort upload |
| `PATCH` | `/api/storage/objects/:id/metadata` | Update metadata |
| `DELETE` | `/api/storage/objects/:id` | Delete object |

#### Personal Access Tokens

All three routes act on the caller's own tokens only — there is no admin
variant that names another user.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/pat` | JWT | Create a token (raw value shown once) |
| `GET` | `/api/pat` | JWT | List own tokens (no raw values) |
| `DELETE` | `/api/pat/:id` | JWT | Revoke a token |

#### Notifications (epic #109)

`GET /api/notifications/stream` cannot be used from Swagger "Try it out" or a
plain `EventSource` (it needs an `Authorization` header); see §5.5.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/notifications/events` | JWT | The event registry, in preferences-UI order |
| `GET` | `/api/notifications/stream` | JWT | SSE stream of the caller's own notifications |
| `GET` | `/api/notifications` | JWT | List caller's notifications (paginated, `unreadOnly`) |
| `GET` | `/api/notifications/unread-count` | JWT | Unread count for the bell badge |
| `POST` | `/api/notifications/:id/read` | JWT | Mark one notification read (idempotent) |
| `POST` | `/api/notifications/read-all` | JWT | Mark all of the caller's notifications read |

#### Email Settings (Admin)

| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| `GET` | `/api/email-settings` | `system_settings:read` | Get config + masked `smtpPasswordStatus` |
| `PUT` | `/api/email-settings` | `system_settings:write` | Replace config (`If-Match` for optimistic concurrency) |
| `POST` | `/api/email-settings/test` | `system_settings:write` | Send a test email with the current/pending config |

#### Health

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/health` | Public | Full health check |
| `GET` | `/api/health/live` | Public | Liveness probe |
| `GET` | `/api/health/ready` | Public | Readiness probe (+ DB) |

### 8.3 Response Format

#### Success Response

```json
{
  "data": {
    // Response payload
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z",
    "total": 100,
    "page": 1,
    "pageSize": 20,
    "totalPages": 5
  }
}
```

#### Error Response

```json
{
  "statusCode": 400,
  "message": "Human readable error message",
  "error": "BadRequest",
  "details": {
    // Additional context
  }
}
```

---

## 9. Frontend Architecture

### 9.1 Page Structure

As of epic #90, the admin console and the per-user settings surface are each
a single registry-driven **hub** with one route per card, rather than a
tab-strip page per area. See
[`docs/specs/settings-ui.md`](specs/settings-ui.md) for the full pattern —
the registry, the shared `SettingsHub` component, and why tabs are reserved
for genuinely parallel content only.

| Page | Route | Auth | Permission | Purpose |
|------|-------|------|------------|---------|
| Login | `/login` | Public | - | OAuth provider selection |
| Auth Callback | `/auth/callback` | Public | - | Token handling |
| Home | `/` | Required | Any | Dashboard |
| User Settings hub | `/settings` | Required | Any (authenticated) | Searchable hub over the user's own settings |
| — Profile | `/settings/profile` | Required | Any (authenticated) | Display name, avatar, email |
| — Appearance | `/settings/appearance` | Required | Any (authenticated) | Personal theme preference |
| — Notifications | `/settings/notifications` | Required | Any (authenticated) | Per-event, per-channel notification preferences |
| — Access Tokens | `/settings/tokens` | Required | Any (authenticated) | Personal access token management |
| Console / Settings hub | `/admin/settings` | Required | `system_settings:read` OR `users:read` | Searchable hub over admin settings |
| — System | `/admin/settings/general` | Required | `system_settings:read` | Core system settings |
| — Appearance | `/admin/settings/appearance` | Required | `system_settings:read` | Default theme for new users |
| — Feature Flags | `/admin/settings/feature-flags` | Required | `system_settings:read` | Toggle optional features |
| — Email | `/admin/settings/email` | Required | `system_settings:read` | SMTP/SES configuration, test send |
| — Advanced (JSON) | `/admin/settings/advanced` | Required | `system_settings:write` | Raw settings document editor |
| — Users & Allowlist | `/admin/settings/users` | Required | `users:read` | User accounts, roles, and allowlist |
| `/admin` (redirect) | `/admin` | Required | — | `<Navigate replace>` to `/admin/settings` |
| `/admin/users` (redirect) | `/admin/users` | Required | — | `<Navigate replace>` to `/admin/settings/users` |
| Device Activation | `/activate` | Required | Any | Device auth approval |
| Test Login | `/testing/login` | Public | - | Test auth bypass (dev only) |

**Note:** The `/testing/login` route is excluded from production builds via `import.meta.env.PROD` check.

**Note:** The two redirect routes are real `<Route>` entries in `App.tsx`, not
catch-all fallout — a bookmarked `/admin/users` resolves via `<Navigate
replace>` rather than falling through to the `*` fallback and landing
silently on `/`.

### 9.2 Context Providers

```tsx
<App>
  <ThemeProvider>        {/* MUI theme + dark mode */}
    <AuthProvider>       {/* Authentication state */}
      <SettingsProvider> {/* User settings */}
        <RouterProvider> {/* React Router */}
          <Layout>
            <Pages />
          </Layout>
        </RouterProvider>
      </SettingsProvider>
    </AuthProvider>
  </ThemeProvider>
</App>
```

### 9.3 Authentication State

```typescript
interface AuthContext {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  accessToken: string | null;
  login: (provider: string) => void;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
}
```

### 9.4 Protected Routes

Route-level **authorization**, not just authentication, is enforced with
`RequirePermission` (`apps/web/src/components/common/RequirePermission.tsx`),
wrapped around the page element inside the `<Route>`. `ProtectedRoute` above
it in the tree only establishes that someone is signed in; `RequirePermission`
is what denies the page itself to a signed-in user who lacks the permission,
rather than letting them land on the page and watch every API call return
`403`.

`RequirePermission` accepts `permission` (single string), `permissions`
(array, OR'd unless `requireAll` is set), `role`, `roles`, and a `fallback`
to render when the check fails. The real pattern, taken directly from
`apps/web/src/App.tsx`'s `/admin/settings/users` route:

```tsx
<Route
  path="/admin/settings/users"
  element={
    <RequirePermission permission="users:read" fallback={<Navigate to="/" replace />}>
      <AdminUsersPage />
    </RequirePermission>
  }
/>
```

The permission named here is the same string the card declares in
`config/adminSections.tsx` and the same string `users.controller.ts`
enforces — so the hub card, the Console rail row, and the route itself
cannot disagree about who may go where. See
[`docs/specs/settings-ui.md`](specs/settings-ui.md) for the full registry
pattern this route belongs to.

---

## 10. Infrastructure Architecture

### 10.1 Docker Services

```yaml
# Core Services (base.compose.yml)
services:
  nginx:        # Reverse proxy (port 3535)
  api:          # NestJS backend (port 3000)
  web:          # React frontend (port 5173)

# PostgreSQL is not bundled in base.compose.yml - it runs as a separate
# instance reached via POSTGRES_HOST/POSTGRES_PORT (see infra/compose/.env.example)

# Observability (otel.compose.yml)
services:
  otel-collector:  # OpenTelemetry Collector
  uptrace:         # Trace/metric visualization (port 14318)
  clickhouse:      # Uptrace storage backend

# Test database only (test.compose.yml) — the one overlay that DOES start a
# Postgres container, ephemeral, for CI/local integration tests.
services:
  db-test:

# VPS overrides (vps.compose.yml) — applied AFTER prod.compose.yml when the
# stack sits behind a shared host-level reverse proxy. See §10.2 and
# docs/specs/vps-deploy.md.
```

### 10.2 Network Topology

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Network                           │
│                                                             │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐                  │
│  │  nginx  │───▶│   api   │    │   web   │                  │
│  │  :3535  │    │  :3000  │    │  :5173  │                  │
│  │         │────┼─────────┼───▶│         │                  │
│  └────┬────┘    └────┬────┘    └─────────┘                  │
│       │              │                                      │
│       │              ▼                                      │
│       │         ┌─────────┐                                 │
│       │         │  otel   │   (only with otel.compose.yml)  │
│       │         │collector│                                 │
│       │         └────┬────┘                                 │
│       │              ▼                                      │
│       │         ┌─────────┐    ┌──────────┐                 │
│       │         │ uptrace │───▶│clickhouse│                 │
│       │         │ :14318  │    │          │                 │
│       │         └─────────┘    └──────────┘                 │
└───────┼─────────────────────────────────────────────────────┘
        │                              │
        ▼                              ▼
   External Access              External PostgreSQL
   http://localhost:3535        (POSTGRES_HOST / POSTGRES_PORT)
```

**PostgreSQL is not part of the Compose stack.** The `api` service connects out
to a database you provide via the `POSTGRES_*` variables; only
`infra/compose/test.compose.yml` starts a Postgres container, for tests.

**Nginx routes the SSE stream separately from the rest of `/api`.** The
notification stream (§5.5, `GET /api/notifications/stream`) needs its own
`location /api/notifications/stream` block in `infra/nginx/nginx.conf` with
`proxy_buffering off`, `proxy_cache off`, and a long `proxy_read_timeout` —
the ordinary `/api` location buffers responses, which would hold every SSE
frame until the connection closed. The API also sets the response header
`X-Accel-Buffering: no`; neither half is relied on alone.

**A VPS deployment adds a fourth topology, applied via `vps.compose.yml`
after `prod.compose.yml`:** nginx's published port is overridden (not merged)
to `127.0.0.1:${APP_BIND_PORT}` only — nothing in the stack is reachable on a
public interface — and a shared, host-level reverse proxy (outside this
Compose project entirely) terminates TLS and forwards to that loopback port.
See §5.7 and [`docs/specs/vps-deploy.md`](specs/vps-deploy.md) for why.

### 10.3 Environment Configuration

Key environment variables (see `infra/compose/.env.example`):

```bash
# Application
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3535
# Loopback port bound when deployed behind a shared host proxy (vps.compose.yml)
APP_BIND_PORT=3535

# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=appdb
POSTGRES_SSL=false

# JWT / Session
JWT_SECRET=<min-32-character-secret>
JWT_ACCESS_TTL_MINUTES=15
JWT_REFRESH_TTL_DAYS=14
COOKIE_SECRET=<min-32-character-secret>

# Credential encryption (§5.6) — optional until a credential is stored, then mandatory
SECRETS_ENCRYPTION_KEY=<base64 32 bytes; openssl rand -base64 32>

# OAuth
GOOGLE_CLIENT_ID=<from-google-console>
GOOGLE_CLIENT_SECRET=<from-google-console>
GOOGLE_CALLBACK_URL=http://localhost:3535/api/auth/google/callback

# Admin Bootstrap
INITIAL_ADMIN_EMAIL=admin@example.com

# Device Authorization Flow (RFC 8628)
DEVICE_CODE_EXPIRY_MINUTES=15
DEVICE_CODE_POLL_INTERVAL=5
DEVICE_TOKEN_EXPIRY_DAYS=7
# PAT lifetime minted for CLI-style device logins (1-999, default 90)
DEVICE_PAT_EXPIRY_DAYS=90

# Observability
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SERVICE_NAME=enterprise-app-api
LOG_LEVEL=info

# Uptrace (otel.compose.yml) / ClickHouse (Uptrace's storage backend)
UPTRACE_DSN=http://project1_secret_token@localhost:14317/1
UPTRACE_PROJECT1_TOKEN=project1_secret_token
UPTRACE_SECRET_KEY=<change-in-production>
UPTRACE_ADMIN_EMAIL=admin@localhost
UPTRACE_ADMIN_PASSWORD=admin
UPTRACE_PGPASSWORD=uptrace
UPTRACE_SITE_URL=http://localhost:14318
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=

# Storage (§5.4)
STORAGE_PROVIDER=s3
S3_BUCKET=<bucket-name>
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
# S3_ENDPOINT=<for MinIO/LocalStack>
MAX_FILE_SIZE=10737418240
ALLOWED_MIME_TYPES=image/*,application/pdf,video/*
SIGNED_URL_EXPIRY=3600
STORAGE_PART_SIZE=10485760
```

See [`infra/compose/.env.example`](../infra/compose/.env.example) for the
authoritative, fully-commented list — including the optional Microsoft OAuth
block and test-auth toggle.

---

## 11. Observability Architecture

### 11.1 Signal Types

| Signal | Collection | Storage | Purpose |
|--------|------------|---------|---------|
| **Traces** | OTEL SDK auto-instrumentation | Uptrace/ClickHouse | Request flow tracking |
| **Metrics** | OTEL SDK | Uptrace/ClickHouse | Performance monitoring |
| **Logs** | Pino structured logs | Uptrace/ClickHouse | Debugging, audit |

### 11.2 Trace Propagation

```
Request → Nginx → API → Database
   │         │       │       │
   └─────────┴───────┴───────┴──▶ trace_id: abc123
                                  spans: [nginx, api, db-query]
```

### 11.3 Log Correlation

```json
{
  "level": "info",
  "time": 1704067200000,
  "msg": "User logged in",
  "requestId": "req-123",
  "traceId": "abc123",
  "spanId": "span456",
  "userId": "user-789"
}
```

### 11.4 Health Checks

| Endpoint | Purpose | Checks |
|----------|---------|--------|
| `/api/health/live` | Kubernetes liveness | Process running |
| `/api/health/ready` | Kubernetes readiness | Process + DB connection |

---

## 12. Testing Architecture

Full detail — test structure, mocking strategy (Prisma via `jest-mock-extended`
for the API, MSW for the web), commands, configuration, and the visual
regression suite — lives in [`docs/TESTING.md`](TESTING.md); this section is
a one-screen orientation, not a second copy.

| App | Frameworks | Layout |
|-----|-----------|--------|
| `apps/api` | Jest + Supertest, mocked `PrismaService` by default | `*.spec.ts` co-located; `test/*.integration.spec.ts` |
| `apps/web` | Vitest + React Testing Library + MSW | `src/__tests__/`, mirroring `src/` |
| `apps/cli` | Vitest | `*.test.ts` co-located with source |
| `tests/e2e` | Playwright, full stack against Docker Compose | `tests/e2e/specs/` |
| `tests/visual` | Playwright, pixel regression, **pinned container only** | `tests/visual/specs/` |

The visual regression suite (issue #107) intentionally does not run against a
locally installed browser: baselines are captured and compared inside a
pinned `mcr.microsoft.com/playwright` container so font rendering and
anti-aliasing stay identical across machines and CI, at `maxDiffPixels: 4`.
See `tests/visual/playwright.config.ts` and
[`packages/shared/README.md`](../packages/shared/README.md) for why
rebranding `APP_NAME` requires regenerating these baselines inside that same
container.

---

## 13. Agent-Based Development Model

### 13.1 Specialized Agents

This project uses specialized AI coding agents for different domains:

| Agent | File | Domain | Responsibilities |
|-------|------|--------|------------------|
| `backend-dev` | `.claude/agents/backend-dev.md` | API Layer | NestJS controllers, services, guards, OAuth, JWT |
| `frontend-dev` | `.claude/agents/frontend-dev.md` | UI Layer | React components, pages, hooks, MUI theming |
| `database-dev` | `.claude/agents/database-dev.md` | Data Layer | Prisma schema, migrations, seeds, queries |
| `testing-dev` | `.claude/agents/testing-dev.md` | Quality | Jest, Supertest, Vitest, RTL, type checking |
| `docs-dev` | `.claude/agents/docs-dev.md` | Documentation | Architecture, API, security docs |

### 13.2 Agent Invocation Rules

**MANDATORY**: All development tasks MUST be delegated to the appropriate agent.

| Task Type | Required Agent | Example |
|-----------|---------------|---------|
| Add API endpoint | `backend-dev` | "Implement user search endpoint" |
| Create component | `frontend-dev` | "Build user avatar component" |
| Schema change | `database-dev` | "Add email verification table" |
| Write tests | `testing-dev` | "Add integration tests for auth" |
| Update docs | `docs-dev` | "Document new endpoint in API.md" |

### 13.3 Multi-Agent Workflow

For features spanning multiple domains, invoke agents sequentially:

```
Feature: "Add user notification preferences"

1. database-dev  → Add preferences to user_settings schema
2. backend-dev   → Implement API endpoints
3. frontend-dev  → Build settings UI
4. testing-dev   → Write tests for all layers
5. docs-dev      → Update documentation
```

### 13.4 Agent Context

Each agent has full context of:
- System specification document
- Technology stack requirements
- Code patterns and conventions
- Security requirements
- Testing standards

### 13.5 Orchestration Responsibilities

The orchestrating agent (Claude) handles:
- Reading files to understand context
- Answering questions about the codebase
- Planning and coordinating between agents
- Running simple commands (git, npm)
- Reviewing agent outputs

**What NOT to do directly:**
- Write NestJS code (use `backend-dev`)
- Create React components (use `frontend-dev`)
- Modify Prisma schema (use `database-dev`)
- Write tests (use `testing-dev`)
- Update documentation (use `docs-dev`)

---

## 14. Development Workflows

### 14.1 Local Development Setup

```bash
# 1. Clone repository
git clone <repository-url>
cd EnterpriseAppBase

# 2. Configure environment
cp infra/compose/.env.example infra/compose/.env
# Edit .env with your Google OAuth credentials

# 3. Start services
cd infra/compose
docker compose -f base.compose.yml -f dev.compose.yml up

# 4. Seed database (first time only)
docker compose exec api sh
cd /app/apps/api && npx tsx prisma/seed.ts
exit

# 5. Access application
# UI: http://localhost:3535
# API: http://localhost:3535/api
# API reference: http://localhost:3535/api/docs
```

### 14.2 Database Changes

```bash
# 1. Modify schema
# Edit apps/api/prisma/schema.prisma

# 2. Create migration
cd apps/api
npm run prisma:migrate:dev -- --name descriptive_name

# 3. Generate client
npm run prisma:generate

# 4. Update seeds if needed
# Edit apps/api/prisma/seed.ts
```

### 14.3 Adding New Features

1. **Plan**: Identify which agents are needed
2. **Database**: Schema changes via `database-dev`
3. **Backend**: API implementation via `backend-dev`
4. **Frontend**: UI implementation via `frontend-dev`
5. **Testing**: Test coverage via `testing-dev`
6. **Documentation**: Updates via `docs-dev`

### 14.4 Testing

See [Section 12: Testing Architecture](#12-testing-architecture) for comprehensive testing documentation.

```bash
# Backend tests (all use mocked database)
cd apps/api
npm test                    # All tests (unit + integration)
npm run test:watch          # Watch mode
npm run test:cov            # With coverage

# Frontend tests
cd apps/web
npm test                    # Watch mode
npm run test:run            # Run once
npm run test:coverage       # With coverage
npm run test:ui             # Visual Vitest UI

# Type checking
cd apps/api && npm run typecheck
cd apps/web && npm run typecheck
```

---

## 15. Appendices

### 15.1 Quick Reference

#### Service URLs (Development)

| Service | URL |
|---------|-----|
| Application | http://localhost:3535 |
| API Reference (Scalar) | http://localhost:3535/api/docs |
| Uptrace | http://localhost:14318 |
| PostgreSQL | localhost:5432 |

#### Key Commands

```bash
# Start dev environment
cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml up

# Start with observability
cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f otel.compose.yml up

# Run migrations
cd apps/api && npm run prisma:migrate:dev -- --name <name>

# Generate Prisma client
cd apps/api && npm run prisma:generate

# Run tests
cd apps/api && npm test
cd apps/web && npm test
```

### 15.2 Related Documents

| Document | Purpose |
|----------|---------|
| [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md) | Detailed security documentation |
| [API.md](API.md) | API endpoint reference |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Development guide |
| [TESTING.md](TESTING.md) | Testing framework guide |
| [DEVICE-AUTH.md](DEVICE-AUTH.md) | Device authorization guide |
| [personal-access-tokens.md](personal-access-tokens.md) | Personal access token guide |
| [deployment/vps.md](deployment/vps.md) | VPS deployment operator runbook |
| [runbooks/rotate-secrets-encryption-key.md](runbooks/rotate-secrets-encryption-key.md) | Rotating `SECRETS_ENCRYPTION_KEY` |
| [../apps/cli/README.md](../apps/cli/README.md) | CLI (`appctl`) usage, install, deploy command reference |
| [../packages/shared/README.md](../packages/shared/README.md) | `@app/shared` rebranding guide |
| [CLAUDE.md](../CLAUDE.md) | AI assistant guidance |

### 15.3 Specification Index

`docs/specs/` holds the living design records for subsystems whose rationale
doesn't fit in this document — five today, each linked from the section above
that owns its topic:

| Spec | Owning section here | Covers |
|------|---------------------|--------|
| [settings-ui.md](specs/settings-ui.md) | §9.1, CLAUDE.md's Settings UI Pattern | The registry-driven hub pattern, `SettingsHub`, the five breakpoint gates |
| [navigation-ia.md](specs/navigation-ia.md) | §9 | Navigation rail / bottom nav information architecture |
| [datatable.md](specs/datatable.md) | §6.2 (`dataTables` namespace) | The shared data table component and its persisted preferences |
| [api-documentation.md](specs/api-documentation.md) | §3.2, §8 | `/api/docs` and `/api/openapi.json`, the Scalar reference page |
| [vps-deploy.md](specs/vps-deploy.md) | §5.7, §10 | `appctl deploy`, the shared host proxy, why there's no `db` service |

The 24 numbered build specs (`01-project-setup.md` … `24-*.md`) that
previously lived here were deliberately deleted once the features they
tracked shipped; there is no `System_Specification_Document.md` in this
repository.

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | January 2026 | AI Assistant | Initial comprehensive architecture document |
| 1.1 | September 2026 | docs-dev (AI Assistant) | Synced §5 repository structure and conventions with the real tree; added Notifications, Email & Credentials, CLI/VPS Deployment, and `@app/shared` subsystem sections; filled in `personal_access_tokens`, `credentials`, `notification_deliveries`, `notifications` in the ERD and corrected the `storage_objects`/`storage_object_chunks` boxes; documented the `dataTables`/`navigation`/`notifications` user-settings namespaces; added Storage, PAT, Notifications, and Email Settings to the API reference; added `/settings/notifications` and `/admin/settings/email` to the page table; documented `test.compose.yml`/`vps.compose.yml` and the full `.env.example` variable set; shortened Testing Architecture to delegate to `docs/TESTING.md`; rebuilt the Appendices to point at the five current `docs/specs/` files and removed references to the deleted System Specification Document and the 24 numbered build specs |
