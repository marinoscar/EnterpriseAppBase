# API Conventions

This page describes the rules every route in the API follows. It does not list
endpoints. The per-endpoint reference (paths, parameters, request and response
schemas, required permissions) is the generated OpenAPI document described
below, which is built from the running code and cannot drift from it.

## Base URL

Nginx serves the web app at `/` and the API at `/api` on one origin
(`http://localhost:3535/api` in development). Every route has the global
prefix `api`. Because the browser only talks to one origin, the API enables no
CORS policy; call it from another origin server-side, with a token.

## OpenAPI Documentation

- **Interactive reference**: `/api/docs` (Scalar, not Swagger UI).
- **OpenAPI 3.1 document**: `GET /api/openapi.json`. If it fails to build at
  startup, both routes answer `503` and the rest of the API keeps working.
- **Offline dump**: `npm run openapi:dump` (repo root) writes `openapi.json`
  without a database or credentials. `npm run openapi:lint` runs Spectral on it
  with `.spectral.yaml`.
- **CI**: the `openapi` job in `.github/workflows/ci.yml` runs
  `openapi:typecheck`, `openapi:dump` and `openapi:lint`.

### How the document is built

Everything that shapes the document lives in `apps/api/src/openapi/`, so a
test, the dump script and the running server all produce the same document.
`document.ts` builds it from the controllers' decorators, then post-processes
it: `rbac-docs.ts` adds the permission line, `data-envelope.ts` wraps 2xx
schemas in `{ data, meta }`, and `tags.ts` declares every tag and sidebar group
(an undeclared tag fails a test). To document a new route, add
`@ApiOperation` / `@ApiResponse` and `@Auth()`; the permission line is
generated for you.

#### One-click session auth

The `/api/docs` page runs a small script before Scalar mounts. It calls
`POST /api/auth/refresh` with your refresh cookie and pre-authorizes the
`JWT-auth` scheme with the returned access token. Reload the page to get a
fresh token after it expires.

## Authentication

Authentication is declared per route. `@Auth()` applies the JWT, role and
permission guards; `@Public()` marks a route that needs no credential (sign-in,
health, the device-code and device-token polls, avatar images).

| Credential | How it is sent | Accepted on | Issued by |
|------------|----------------|-------------|-----------|
| Session access token (JWT, 15 min default) | `Authorization: Bearer <jwt>` | Every authenticated route | OAuth callback, `POST /api/auth/refresh`, `POST /api/auth/switch-org` |
| Refresh token (opaque, 14 days default) | `refresh_token` cookie, `HttpOnly`, `SameSite=Lax`, `Path=/api/auth` | `POST /api/auth/refresh`, `POST /api/auth/switch-org`, `POST /api/auth/logout` | OAuth callback, rotated on every refresh and switch-org |
| Personal access token (`pat_…`) | `Authorization: Bearer pat_…` | Every authenticated route | `POST /api/pat`, or the device flow |
| Node credential (`nod_…`) | `Authorization: Bearer nod_…` | Only `/api/nodes` and `/api/nodes/*`; `403` elsewhere | `POST /api/node-credentials` |

- The access token is read from the `Authorization` header only, never from a
  cookie. `POST /api/auth/refresh` returns a new one and rotates the cookie.
- A `pat_` token carries its owner's full permission set
  ([Personal Access Tokens](personal-access-tokens.md)). A `nod_` credential
  cannot reach `/api/node-credentials`, so a leaked one cannot mint another.
- Browserless clients such as `appctl` use the
  [device authorization grant](DEVICE-AUTH.md). Every sign-in path is gated by
  the email allowlist.

### Active organization and `switch-org`

Every user credential acts in exactly **one organization**, and no request
input chooses it: the API never reads an org id from a header or a query
parameter. The org comes from the credential (#724):

- a session access token carries it as the signed `org` claim (single mode:
  the default organization; multi mode: the membership used most recently
  at sign-in);
- a personal access token and a device session are bound to one org when
  they are created or approved, for life.

`GET /api/auth/me` reports it as `activeOrg` (`{ id, name, slug }`) with the
roles and permissions computed for it, plus `memberships` (every org the user
is an active member of, with the org role). A browser changes org with

```http
POST /api/auth/switch-org
Authorization: Bearer <session access token>
Cookie: refresh_token=…
Content-Type: application/json

{ "orgId": "0b6f1c2e-7a53-4a8e-9d0c-2f6a1e9b7c11" }
```

which answers like `POST /api/auth/refresh` (`{ accessToken, expiresIn }` and a
rotated `refresh_token` cookie), with the new access token bound to `orgId`.
`404` means `orgId` is not an organization the caller is an active member of
(in single mode, anything but the default org); `403` means the caller used a
PAT or a device credential, which cannot switch; `401` means the refresh
cookie is missing or spent. The client discards its old access token and uses
the new one: there is no way to act in two organizations with one token. A
credential whose membership is removed or suspended is refused with `401`.

### Organization routes act on the active organization

`/api/org/members` and `/api/org/invites` (#726) administer **the caller's
active organization**, the one the credential is bound to. No route takes an
org id in the path, the query or the body (a body with an `orgId` key is a
`400`, the DTOs are strict), so an administrator of org A cannot name org B:
a member or an invitation of another organization is a `404`, exactly like
one that does not exist. Administer another organization by switching to it
(`POST /api/auth/switch-org`) as a member of it. They need ORG permissions
(`org_members:*`, `org_invites:*`, held through the `org_admin` membership
role), and work in both tenancy modes; the web UI shows them only in
multi-org mode.

`/api/admin/organizations` is the deployment operator's list of
organizations (SYSTEM permissions `organizations:read` / `organizations:write`).
Creating one is refused in single-org mode with `409` and
`details.reason: "TENANCY_SINGLE_ORG"`; a taken slug is `409`
(`SLUG_TAKEN`). The slug is immutable after creation, and which organization
is the default cannot be changed.

Member writes that would leave the organization without an active
`org_admin` answer `409` with `details.reason: "LAST_ORG_ADMIN"`; changing
your own role, suspending or removing yourself is `403`. Re-inviting an
address that is already a member is `409` (`ALREADY_MEMBER`, or
`INVITE_ACCEPTED` when its invitation was accepted).

### Google sign-in redirects

The two Google routes answer with redirects, not the JSON envelope.

| Route | Redirects to |
|---|---|
| `GET /api/auth/google` | Google's consent screen. `?select_account=1` forwards `prompt=select_account` so Google shows its account chooser; any other value is ignored |
| `GET /api/auth/google/callback` | On success `<APP_URL>/auth/callback?token=<jwt>&expiresIn=<seconds>`. On any failure `<APP_URL>/auth/callback?error=<code>` |

`<code>` is one of a closed set (`not_allowlisted`, `account_disabled`,
`access_denied`, `authentication_failed`, `server_misconfigured`), never an
exception message. Failures raised before the callback handler runs, such as
cancelled consent or a replayed code, redirect the same way instead of returning
a JSON error. The meaning of each code, the reason free text is excluded and the
steps to add a code are in
[SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md#sign-in-failure-contract).

### How required permissions appear in the OpenAPI document

`@Auth({ roles, permissions })` stamps an `x-rbac` extension on the operation,
and the builder appends a line such as
``**Requires:** authentication, plus permission `jobs:read`.`` to its
description. A caller needs **any** listed role and **all** listed
permissions. Every authenticated operation lists both the `JWT-auth` and
`PAT-auth` security schemes. The permission matrix (which role holds which
permission) lives in [ARCHITECTURE.md](ARCHITECTURE.md).

## Response Envelope

A global interceptor wraps every successful JSON body:

```json
{ "data": { "id": "…", "email": "…" }, "meta": { "timestamp": "2026-09-26T12:00:00.000Z" } }
```

A body that already has a top-level `data` key passes through unchanged. SSE
streams and `204 No Content` responses are not enveloped.

## Errors

Every error goes through one global exception filter
(`HttpExceptionFilter` from `@marinoscar/platform-api/core`,
`packages/platform-api/src/core/errors/http-exception.filter.ts`, registered as
the app's `APP_FILTER`), which builds this body:

```json
{ "statusCode": 409, "code": "CONFLICT", "message": "Settings version mismatch. Expected 3, found 4",
  "details": {}, "timestamp": "2026-09-26T12:00:00.000Z", "path": "/api/system-settings" }
```

- `code` is always derived from the status: `BAD_REQUEST` (400),
  `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409),
  `PRECONDITION_FAILED` (412), `PAYLOAD_TOO_LARGE` (413),
  `UNPROCESSABLE_ENTITY` (422), `TOO_MANY_REQUESTS` (429), `INTERNAL_ERROR`
  (500), and `ERROR` for anything else (for example 503). A `code` on a thrown
  exception is ignored. The base's own `If-Match` routes answer a version
  mismatch with `409 CONFLICT` (see [Optimistic Concurrency](#optimistic-concurrency-if-match)); `412` is mapped for
  routes that choose the HTTP precondition status.
- `details` is optional and endpoint-specific. It is the only place a custom
  field survives. Branch on `details.reason` where an endpoint documents one
  (for example `AI_DISABLED`, `AI_KEY_REQUIRED`, `MAINTENANCE_MODE`), never on
  `message`.
- A body or query that fails the global Zod validation pipe answers `400
  BAD_REQUEST` with `details.issues`, one `{ "path": "items.0.name",
  "message": "…" }` per failing field (`path` is the dotted Zod path, `""` for
  the object itself, such as an unknown key on a strict schema). Only the path
  and the message are published, never the submitted value. An exception that
  already carries `details` keeps its own.
- Outside production, an unexpected non-HTTP error puts its stack in `details`.
- A `429` whose `details.retryAfterMs` is set also carries a `Retry-After`
  header, in whole seconds rounded up.
- One route opts out of the envelope: `POST /api/auth/device/token` returns
  the RFC 8628 body `{ "error": "…", "error_description": "…" }` verbatim.

## Pagination

Lists are offset-paginated with `page` (default 1) and `pageSize` (default 20,
max 100). Two body shapes exist. Most lists (users, allowlist, jobs, database backup
runs, broadcasts, notifications, the AI model catalog) use the **flat** shape:

```json
{ "data": { "items": [], "total": 42, "page": 1, "pageSize": 20, "totalPages": 3 } }
```

`GET /api/storage/objects` uses the **nested** shape, with counts in an inner
`meta` and the total named `totalItems`:

```json
{ "data": { "items": [], "meta": { "page": 1, "pageSize": 20, "totalItems": 42, "totalPages": 3 } } }
```

`GET /api/auth/device/sessions` is older and differs: it takes `page` and
`limit` (default 10) and returns `{ sessions, total, page, limit }`. Each
operation's schema in `/api/docs` says which shape it returns.

## Optimistic Concurrency (`If-Match`)

Settings-style resources return an integer `version`. Send it back in
`If-Match` to make a write conditional:

```http
PATCH /api/system-settings
If-Match: 4
```

If the stored version differs, the write is refused with `409 CONFLICT` and
nothing is changed. Reload, re-apply, and retry. Omit the header to overwrite
unconditionally. An unparseable value is treated as absent.

Routes that read it: `PATCH /api/system-settings`, `PATCH /api/user-settings`,
and `PUT` on `/api/email-settings`, `/api/admin/storage-config`,
`/api/admin/push-config` and `/api/admin/ai/config`. The admin configuration
routes share the version of the single system-settings row, so a concurrent
save of an unrelated setting can also cause a `409`.

## Server-Sent Events

Three routes stream `text/event-stream`:

| Route | Frames | Keep-alive |
|-------|--------|-----------|
| `POST /api/ai/responses/stream` | `event: <type>` with JSON `data:`; starts with `response.created`, ends with exactly one `response.completed` or `error` | `: ping` every 15 s |
| `GET /api/notifications/stream` | `event: notification` with JSON `data:` | `: heartbeat` about every 25 s |
| `POST /api/admin/telemetry/assistant/stream` | `event: step\|answer\|error\|done` with JSON `data:`; always ends with `done` | `: ping` every 15 s |

- **AI stream**: send `Accept: text/event-stream` and the same body as
  `POST /api/ai/responses` (there is no `stream` flag). A refusal **before** the
  first frame is an ordinary JSON error with `details.reason`. A failure
  **after** it is an `error` frame (`{ "type": "error", "code": "AI_…",
  "message": "…" }`), then the stream closes. Close the connection to cancel;
  the provider call is aborted.
- **Notification stream**: no replay. After a reconnect, refetch
  `GET /api/notifications`.
- **Telemetry assistant stream**: requires `telemetry:query` and `ai:use`.
  A refusal before the first frame is an ordinary JSON error with
  `details.reason` (`AI_DISABLED`, or a `TELEMETRY_*` reason — see
  [telemetry.md](specs/telemetry.md#5-explorer)). Closing the connection
  cancels the AI call and any in-flight query.
- **All three**: the native `EventSource` cannot send `Authorization`, and
  tokens in the query string are not accepted, so use a fetch-based SSE
  client. Nginx serves each stream from a dedicated unbuffered location.

## Rate Limiting

There is no global HTTP rate limiter in the API or in Nginx. Add one (for
example `@nestjs/throttler`, or `limit_req` in Nginx) if you need it. Three
targeted limits exist:

- **AI**: administrators set per-user, org-key and per-model limits in the `ai`
  settings namespace. A request over a limit gets `429` with
  `details.reason: "AI_RATE_LIMITED"`, `details.limit`, `details.retryAfterMs`
  and a `Retry-After` header. See [AI Platform](specs/ai-platform.md).
- **Device token polling**: polling faster than the issued `interval` returns
  the RFC 8628 `slow_down` error.
- **Group member lookup by email** (`POST /api/groups/:id/members` with
  `email`): ten failed lookups per account in ten minutes, then `429` with
  `details.reason: "LOOKUP_THROTTLED"`, `details.retryAfterMs` and a
  `Retry-After` header. It blunts probing which addresses have accounts. The
  counts live in each API process, so with several replicas the limit is
  approximate (up to the limit per replica), as it is for the AI limits.

## Maintenance Mode

While a maintenance window is open, routes answer `503` with
`Retry-After: 30` and the standard error body, where `details` is
`{ "reason": "MAINTENANCE_MODE", "retryAfterSeconds": 30, "allowAdmins": … }`.

Routes marked `@AllowDuringMaintenance()` stay reachable: `/api/auth/*`,
`GET /api/auth/device/activate`, `POST /api/auth/device/authorize`,
`/api/admin/maintenance` (so an admin can close the window), `/api/health/*`,
`/api/admin/about` and the development-only `/api/auth/test/*`.

When the window allows admins, a request with an Admin session JWT passes. A
`pat_` or `nod_` token never does. `/api/docs` and `/api/openapi.json` are
outside the Nest router and stay readable. See
[Maintenance Mode](specs/maintenance-mode.md).

## Security Headers

Nginx (`infra/nginx/nginx.conf`) adds these to every response:

```text
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(self), geolocation=(), payment=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: <per path, from infra/nginx/csp.conf>
```

HSTS is ignored over plain HTTP. Development uses `csp.dev.conf`. Nginx also
forwards `X-Request-ID` to the API for log correlation.

## Versioning

The API is not URL-versioned (there is no `/api/v1`). `info.version` in the
OpenAPI document is the application version, so the document describes the
build you are talking to. For a breaking change that external clients depend
on, add a new route rather than changing an existing contract in place.

## Route Groups

Every group below is under `/api`. Exact routes are in `/api/docs`.

| Prefix | What it is | Permission family | Design doc |
|--------|------------|-------------------|------------|
| `auth` | Google OAuth sign-in, refresh, logout, current user | public / authenticated | [SECURITY-ARCHITECTURE](SECURITY-ARCHITECTURE.md) |
| `auth/device` | RFC 8628 device authorization | public / authenticated | [DEVICE-AUTH](DEVICE-AUTH.md) |
| `auth/test` | Test login (not registered in production) | public | [TESTING](TESTING.md) |
| `users` | User management and role assignment | `users:*`, `rbac:manage` | [SECURITY-ARCHITECTURE](SECURITY-ARCHITECTURE.md) |
| `users/:userId/avatar` | Public stream of an uploaded avatar | public | [storage-providers](specs/storage-providers.md) |
| `allowlist` | Email allowlist | `allowlist:*` | [SECURITY-ARCHITECTURE](SECURITY-ARCHITECTURE.md) |
| `org/members`, `org/invites` | The active organization's members and invitations (never another org's) | `org_members:*`, `org_invites:*` (org) | [platform-packages](specs/platform-packages.md#tenancy-and-access-model) |
| `admin/organizations` | The deployment's organizations: list, create with a first-admin invitation, rename | `organizations:*` (system) | [platform-packages](specs/platform-packages.md#tenancy-and-access-model) |
| `groups` | Groups of the active organization, their members and invitations; `groups/invites/mine` and its accept and decline for the invitee. A group the caller may not see is `404`, never `403` | `groups:read`, `groups:write`, `groups:admin` (org) | [sharing README](../packages/platform-api/src/sharing/README.md) |
| `user-settings` | Current user's settings | `user_settings:*` | [settings-ui](specs/settings-ui.md) |
| `user-settings/profile-image` | Upload, preview, remove profile picture | `user_settings:*` | [storage-providers](specs/storage-providers.md) |
| `system-settings` | Global settings (JSONB namespaces) | `system_settings:*` | [settings-ui](specs/settings-ui.md) |
| `email-settings` | Outbound email transport configuration | `system_settings:*` | [browser-notifications](specs/browser-notifications.md) |
| `pat` | Personal access tokens | authenticated (own) | [personal-access-tokens](personal-access-tokens.md) |
| `storage/objects` | File uploads (simple and resumable) and downloads | authenticated (owner) | [storage-providers](specs/storage-providers.md) |
| `admin/storage-config` | Object-storage provider, bucket, credential | `storage_config:*` | [storage-providers](specs/storage-providers.md) |
| `notifications` | In-app notifications, event registry, push subscriptions, SSE stream | authenticated (own) | [browser-notifications](specs/browser-notifications.md) |
| `admin/push-config` | Web Push (VAPID) keys | `push:*` | [browser-notifications](specs/browser-notifications.md) |
| `admin/broadcasts` | Admin broadcasts to every user | `broadcasts:*` | [notification-broadcasts](specs/notification-broadcasts.md) |
| `admin/jobs` | Background job queue: list, stats, insights, retry | `jobs:*` | [job-queue](specs/job-queue.md) |
| `nodes` | Worker-node control and data plane | `nodes:*` or `nod_` credential | [worker-nodes](specs/worker-nodes.md) |
| `node-credentials` | Mint and revoke `nod_` credentials | `nodes:*` | [worker-nodes](specs/worker-nodes.md) |
| `admin/nodes` | The whole worker fleet, every owner | `nodes:*` | [worker-nodes](specs/worker-nodes.md) |
| `admin/maintenance` | Open or close the maintenance window | `system_settings:*` | [maintenance-mode](specs/maintenance-mode.md) |
| `admin/db-backup` | Database backup, restore and rollback | `db_backup:read/write/restore` | [database-backup](specs/database-backup.md) |
| `admin/about` | Deployed version and deploy history | `system_settings:read` | [vps-deploy](specs/vps-deploy.md) |
| `admin/doctor` | Read-only configuration and health checks for every capability; `support-bundle` downloads them with the versions and a telemetry summary as one redacted JSON file | `system_settings:read` | [doctor](specs/doctor.md) |
| `ai` | AI config, BYOK keys, models, responses, streaming, embeddings | `ai:use` (`GET /api/ai/config`: any user) | [ai-platform](specs/ai-platform.md) |
| `ai/images`, `ai/audio`, `ai/realtime` | Queued image/audio work, realtime sessions | `ai:use` | [ai-platform](specs/ai-platform.md) |
| `ai/runs`, `ai/usage` | Background run status, caller's own usage | `ai:use` | [ai-platform](specs/ai-platform.md) |
| `admin/ai` | AI kill switch, key policy, providers, model catalog, usage | `ai_config:*` | [ai-platform](specs/ai-platform.md) |
| `telemetry` | Public telemetry feature flag | authenticated (any user) | [telemetry](specs/telemetry.md) |
| `admin/telemetry` | Telemetry policy, status, SQL explorer, export, AI assistant stream | `telemetry:read/write/query` (assistant also needs `ai:use`) | [telemetry](specs/telemetry.md) |
| `health` | Liveness and readiness probes | public | [ARCHITECTURE](ARCHITECTURE.md) |

Every `/api/ai/*` route except `GET /api/ai/config` returns `403` with
`details.reason: "AI_DISABLED"` while AI is switched off. `/api/admin/ai/*` is
never blocked by that switch.
