# API Reference

## Base URL

- **Development**: http://localhost:3535/api
- **Production**: https://yourdomain.com/api

## Authentication

All endpoints require JWT Bearer token authentication unless explicitly marked as **Public**.

**Authorization Header:**
```
Authorization: Bearer <access_token>
```

Access tokens are short-lived (15 minutes by default). Use the refresh token flow to obtain new access tokens.

## Response Format

### Success Response

```json
{
  "data": <response_data>,
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

### Error Response

Every endpoint but one (see the note below) returns errors through `HttpExceptionFilter`,
which rebuilds the body from a fixed key allowlist — `statusCode`, `code`, `message`,
`details`, `timestamp`, `path` and nothing else. A custom field on a thrown exception's
payload that isn't one of these is silently dropped; endpoint-specific data belongs in
`details`.

```json
{
  "statusCode": 409,
  "code": "CONFLICT",
  "message": "Email already in allowlist",
  "timestamp": "2026-08-17T04:37:58.000Z",
  "path": "/api/allowlist"
}
```

`code` is a stable, machine-readable value **derived from the HTTP status** — the filter
overwrites any `code` a thrown exception supplied, so branch on it rather than on `message`
(prose, may change). It is always one of:

| HTTP Status | `code` |
|-------------|--------|
| 400 | `BAD_REQUEST` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT` |
| 422 | `UNPROCESSABLE_ENTITY` |
| 429 | `TOO_MANY_REQUESTS` |
| 500 | `INTERNAL_ERROR` |
| any other status | `ERROR` |

`details` is optional and endpoint-specific (e.g. `{ "field": "email" }`); it is omitted
when the failure carried none. Validation errors from the global Zod pipe surface their
per-field messages through `message`/`details` in the same envelope, not as a separate
shape.

**The one exception:** `POST /auth/device/token` opts out of this envelope entirely,
because RFC 8628 §3.5 fixes its error body as `{ error, error_description }`. See the
Device Authorization section below.

## Pagination

Endpoints returning lists support pagination with the following query parameters:

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `page` | number | 1 | - | Page number (1-indexed) |
| `pageSize` | number | 20 | 100 | Items per page |

**Paginated Response Format:** `data` is always an **object** carrying `items` alongside
the pagination counts — never the bare array. This API has two slightly different shapes
for those counts, both documented on their own endpoints below:

- **Flat** (`GET /users`, `GET /allowlist`, `GET /notifications`):
  `data: { items, total, page, pageSize, totalPages }`
- **Nested** (`GET /storage/objects`):
  `data: { items, meta: { page, pageSize, totalItems, totalPages } }`

```json
{
  "data": {
    "items": [ ... ],
    "total": 150,
    "page": 1,
    "pageSize": 20,
    "totalPages": 8
  }
}
```

Note the envelope's own `meta` (see Response Format above) carries only the server
timestamp and is a sibling of `data`, not the same object as a nested list's `data.meta`.

---

## Endpoints

### Authentication

#### GET /auth/providers
**Public endpoint** - List enabled OAuth providers.

**Response:**
```json
{
  "data": {
    "providers": [
      {
        "name": "google",
        "enabled": true
      }
    ]
  }
}
```

---

#### GET /auth/google
**Public endpoint** - Initiate Google OAuth flow. Redirects to Google consent screen.

**Response:** HTTP 302 redirect to Google

---

#### GET /auth/google/callback
**Public endpoint** - OAuth callback handler (called by Google).

**Query Parameters:**
- `code` (string) - Authorization code from Google
- `state` (string, optional) - CSRF protection state

**Response:** HTTP 302 redirect to frontend with access token in query parameter
- Sets HttpOnly refresh token cookie
- Redirects to `/auth/callback?accessToken=<token>`

**Error Cases:**
- Email not in allowlist → Redirects to `/auth/error?error=not_authorized`
- OAuth failure → Redirects to `/auth/error?error=oauth_failed`

---

#### GET /auth/me
**Requires Authentication** - Get current user profile.

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "displayName": "John Doe",
  "profileImageUrl": "https://...",
  "isActive": true,
  "roles": [
    {
      "id": "uuid",
      "name": "admin",
      "description": "Administrator with full access"
    }
  ],
  "permissions": ["users:read", "users:write", "system_settings:read", ...]
}
```

---

#### POST /auth/refresh
**Public endpoint** - Refresh access token using refresh token cookie.

**Request:** No body required (uses HttpOnly cookie)

**Response:**
```json
{
  "accessToken": "new_jwt_access_token",
  "expiresIn": 900
}
```

Sets new refresh token in HttpOnly cookie (token rotation).

**Error Cases:**
- 401 Unauthorized - Missing or invalid refresh token
- 403 Forbidden - User is disabled

---

#### POST /auth/logout
**Requires Authentication** - Logout and revoke refresh token.

**Request:** No body required

**Response:** HTTP 204 No Content
- Clears refresh token cookie
- Revokes refresh token in database

---

#### POST /auth/logout-all
**Requires Authentication** - Logout from all devices and revoke all refresh tokens.

**Request:** No body required

**Response:** HTTP 204 No Content
- Clears refresh token cookie
- Revokes ALL refresh tokens for the current user across all devices

**Use Case:** Security feature to force re-authentication on all sessions (e.g., after password change or suspected compromise).

---

### Device Authorization (RFC 8628)

The Device Authorization Flow enables input-constrained devices (CLI tools, IoT devices, Smart TVs) to obtain user authorization. See [DEVICE-AUTH.md](DEVICE-AUTH.md) for comprehensive guide and integration examples.

#### POST /auth/device/code
**Public endpoint** - Generate device code pair to initiate device authorization flow.

**Request Body:**
```json
{
  "clientInfo": {
    "deviceName": "oscar-laptop",
    "userAgent": "MyCliTool/1.0.0 (linux)",
    "tokenType": "pat"
  }
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clientInfo` | object | No | Optional metadata about the client device. Arrives from an unauthenticated caller and is persisted verbatim — treat it as untrusted when rendering it back |
| `clientInfo.deviceName` | string | No | Human-readable device/client name, echoed to the approving user on the activation page and, for `tokenType: "pat"`, used to build the token's display name |
| `clientInfo.userAgent` | string | No | Client user agent string |
| `clientInfo.tokenType` | enum | No | `session` (default) or `pat`. Selects which credential the flow mints on approval — see `POST /auth/device/token` below. An unrecognised value is rejected with a 400 rather than falling back to `session` |

**Response:**
```json
{
  "data": {
    "deviceCode": "a4f3b8c9d2e1f5a6b7c8d9e0f1a2b3c4",
    "userCode": "ABCD-1234",
    "verificationUri": "http://localhost:3535/device",
    "verificationUriComplete": "http://localhost:3535/device?code=ABCD-1234",
    "expiresIn": 900,
    "interval": 5
  }
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `deviceCode` | string | Opaque code for device polling (keep secret) |
| `userCode` | string | Human-readable code for user entry (XXXX-XXXX format) |
| `verificationUri` | string | URL where user should authorize |
| `verificationUriComplete` | string | URL with user code pre-filled |
| `expiresIn` | number | Code lifetime in seconds (default: 900) |
| `interval` | number | Minimum polling interval in seconds (default: 5) |

---

#### POST /auth/device/token
**Public endpoint** - Poll for authorization status and obtain tokens when approved.

**Request Body:**
```json
{
  "deviceCode": "a4f3b8c9d2e1f5a6b7c8d9e0f1a2b3c4"
}
```

**Response (200 OK - Authorized):**

The credential kind returned matches what was requested at `POST /auth/device/code` via
`clientInfo.tokenType`. It is minted on THIS poll, not at approval time — a device that is
approved but never polls again is never issued a credential.

Default `session` credential (`clientInfo.tokenType` was absent or `"session"`):
```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "tokenType": "Bearer",
    "expiresIn": 604800
  }
}
```

Personal access token (`clientInfo.tokenType` was `"pat"`):
```json
{
  "data": {
    "accessToken": "pat_a1b2c3d4e5f6...",
    "tokenType": "Bearer",
    "expiresIn": 7776000,
    "credentialType": "pat",
    "expiresAt": "2026-11-28T12:00:00.000Z",
    "tokenId": "123e4567-e89b-12d3-a456-426614174000",
    "tokenName": "Device: oscar-laptop"
  }
}
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `accessToken` | string | Present for both credential kinds. Present as-is in `Authorization: Bearer <token>` |
| `refreshToken` | string | **Session credential only.** Absent for a PAT — re-running the device flow is a PAT's renewal path, not this API's cookie-based refresh flow |
| `tokenType` | string | Always the literal `"Bearer"`, for both credential kinds — it describes how to present the token, not which kind it is |
| `expiresIn` | number | Session: `DEVICE_TOKEN_EXPIRY_DAYS` in seconds (7 days = 604800 by default), not the ordinary 15-minute web access-token TTL. PAT: remaining seconds until `expiresAt` (`DEVICE_PAT_EXPIRY_DAYS`, 90 days by default) — prefer the absolute `expiresAt` for a PAT |
| `credentialType` | `"pat"` | **PAT only.** Absent for a session credential, mirroring the request side. Branch on this field, never on the absence of `refreshToken` |
| `expiresAt` | string | **PAT only.** Absolute ISO-8601 expiry |
| `tokenId` | string | **PAT only.** The token's id — the same value `GET /api/pat` returns — for revoking it via `DELETE /api/pat/{id}` |
| `tokenName` | string | **PAT only.** The display name given to the token, so a client can tell the user which row to look for in the Access Tokens page |

**Error Responses (400 Bad Request):**

While authorization is pending:
```json
{
  "error": "authorization_pending",
  "error_description": "User has not yet authorized this device"
}
```

Device polling too frequently:
```json
{
  "error": "slow_down",
  "error_description": "Polling too frequently. Please slow down."
}
```

Code has expired:
```json
{
  "error": "expired_token",
  "error_description": "The device code has expired"
}
```

User denied authorization:
```json
{
  "error": "access_denied",
  "error_description": "User denied the authorization request"
}
```

An unrecognised internal device code status (defensive; should not occur in practice):
```json
{
  "error": "invalid_request",
  "error_description": "Unknown device code status"
}
```

**Note:** these RFC 8628 bodies are sent verbatim and are NOT the shared error envelope
described under Error Response above — no `statusCode`, `code`, `timestamp` or `path`.
Branch on `error`, never on HTTP status or `error_description` (prose, may change).

**Error Response (401 Unauthorized):**

Invalid device code:
```json
{
  "error": "invalid_grant",
  "error_description": "Invalid device code"
}
```

**Usage:**
1. Device requests code from `/auth/device/code`
2. Device displays `userCode` and `verificationUri` to user
3. Device polls this endpoint every `interval` seconds
4. User visits verification page and approves device
5. Polling returns tokens when approved

---

#### GET /auth/device/activate
**Requires Authentication** - Get activation page information and validate user code.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `code` | string | No | User verification code to validate |

**Request (No Code):**
```http
GET /auth/device/activate
Authorization: Bearer <token>
```

**Response (No Code):**
```json
{
  "data": {
    "verificationUri": "http://localhost:3535/device"
  }
}
```

**Request (With Code):**
```http
GET /auth/device/activate?code=ABCD-1234
Authorization: Bearer <token>
```

**Response (With Valid Code):**
```json
{
  "data": {
    "verificationUri": "http://localhost:3535/device",
    "userCode": "ABCD-1234",
    "clientInfo": {
      "name": "My CLI Tool",
      "version": "1.0.0",
      "platform": "linux"
    },
    "expiresAt": "2024-01-01T12:15:00.000Z"
  }
}
```

**Error Cases:**
- 404 Not Found - Invalid user code
- 400 Bad Request - Code has expired or already been processed

---

#### POST /auth/device/authorize
**Requires Authentication** - Approve or deny device authorization request.

**Request Body:**
```json
{
  "userCode": "ABCD-1234",
  "approve": true
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userCode` | string | Yes | User code from the device |
| `approve` | boolean | Yes | true to approve, false to deny |

**Response:**
```json
{
  "data": {
    "success": true,
    "message": "Device authorized successfully"
  }
}
```

**Error Cases:**
- 404 Not Found - Invalid user code
- 400 Bad Request - Code has expired or already been processed

---

#### GET /auth/device/sessions
**Requires Authentication** - List current user's approved device sessions.

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `page` | number | No | 1 | Page number |
| `limit` | number | No | 10 | Items per page |

**Response:**
```json
{
  "data": {
    "sessions": [
      {
        "id": "uuid-1234",
        "userCode": "ABCD-1234",
        "status": "approved",
        "clientInfo": {
          "name": "My CLI Tool",
          "version": "1.0.0",
          "platform": "linux"
        },
        "createdAt": "2024-01-01T12:00:00.000Z",
        "expiresAt": "2024-01-01T12:15:00.000Z"
      }
    ],
    "total": 5,
    "page": 1,
    "limit": 10
  }
}
```

**Use Case:** View all devices that have been authorized to access the account.

---

#### DELETE /auth/device/sessions/:id
**Requires Authentication** - Revoke a specific device session.

**Parameters:**
- `id` (UUID) - Session ID to revoke

**Response:**
```json
{
  "data": {
    "success": true,
    "message": "Device session revoked successfully"
  }
}
```

**Error Cases:**
- 404 Not Found - Session not found or doesn't belong to current user

**Use Case:** Revoke access for lost or compromised devices. This revokes the device
*authorization request* so it can no longer be redeemed on `POST /auth/device/token` — it
does **not** invalidate a credential the device already collected. To revoke an already-issued
personal access token, use `DELETE /api/pat/{id}`; for an already-issued session credential,
use `POST /auth/logout-all` (which revokes refresh tokens — the issued access token itself
stays valid until its short TTL expires).

---

### Personal Access Tokens

Long-lived, revocable API tokens that authenticate as the user who created them, for
CI/CD, CLI tools and scripts that cannot do interactive OAuth. All endpoints operate
only on the **authenticated caller's own** tokens — there is no admin listing of another
user's tokens and no id parameter that could name one. See
[`docs/personal-access-tokens.md`](personal-access-tokens.md) for the concepts (use
cases, duration options, how a PAT is presented, security considerations); this section
documents only the wire format. A PAT can also be minted directly through the Device
Authorization flow (`clientInfo.tokenType: "pat"` — see above), which is what the CLI uses.

#### POST /pat
**Requires Authentication** - Create a new personal access token for the current user.

**Request Body:**
```json
{
  "name": "CI Pipeline",
  "durationValue": 90,
  "durationUnit": "days"
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Human-readable name, 1-100 characters |
| `durationValue` | number | Yes | Integer, 1-999 |
| `durationUnit` | enum | Yes | `minutes`, `days`, or `months` |

**Response (201 Created):**
```json
{
  "token": "pat_9f8e7d6c5b4a3928170695867503a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8",
  "id": "uuid",
  "name": "CI Pipeline",
  "tokenPrefix": "pat_9f8e",
  "expiresAt": "2026-11-30T12:00:00.000Z",
  "createdAt": "2026-09-01T12:00:00.000Z"
}
```

**The raw `token` is shown exactly once, in this response.** It is never returned again —
not by `GET /pat`, not anywhere else. Store it securely at creation time. Present it as
`Authorization: Bearer pat_...`; `JwtAuthGuard` recognises the `pat_` prefix and routes it
to PAT validation instead of JWT verification.

---

#### GET /pat
**Requires Authentication** - List the current user's personal access tokens, newest
first. The raw token value is never included.

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "CI Pipeline",
    "tokenPrefix": "pat_9f8e",
    "durationValue": 90,
    "durationUnit": "days",
    "expiresAt": "2026-11-30T12:00:00.000Z",
    "lastUsedAt": "2026-09-05T08:12:00.000Z",
    "createdAt": "2026-09-01T12:00:00.000Z",
    "revokedAt": null
  }
]
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `tokenPrefix` | string | Display-only identifying prefix (e.g. `pat_9f8e`) — not a secret, not enough to authenticate with |
| `lastUsedAt` | string \| null | ISO 8601 timestamp of last use, updated fire-and-forget on each successful validation; `null` if never used |
| `revokedAt` | string \| null | ISO 8601 timestamp the token was revoked, `null` if still active |

---

#### DELETE /pat/:id
**Requires Authentication** - Revoke one of the current user's personal access tokens.

**Parameters:**
- `id` (UUID) - Token ID

**Response:** HTTP 204 No Content

**Error Cases:**
- 404 Not Found - Token not found, does not belong to the current user, or already revoked
  (these are indistinguishable on purpose)

---

### Test Authentication (Development/Test Only)

**Security Notice:** These endpoints are completely disabled in production. They exist solely to enable automated E2E testing without requiring real OAuth credentials.

#### POST /auth/test/login
**Development/Test Only** - Authenticate as a test user without OAuth.

**Availability:** Only when `NODE_ENV !== 'production'`

**Request Body:**
```json
{
  "email": "test@test.local",
  "role": "admin",
  "displayName": "Test Admin"
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | Email address for test user |
| `role` | enum | No | Role to assign: `admin`, `contributor`, `viewer` (default: `viewer`) |
| `displayName` | string | No | Display name for the user |

**Response:** HTTP 302 redirect to `/auth/callback?token=<accessToken>&expiresIn=900`
- Sets HttpOnly refresh token cookie (same as OAuth flow)
- Creates user if not exists, assigns specified role

**Error Cases:**
- 403 Forbidden - Endpoint disabled (production environment)
- 400 Bad Request - Invalid email or role

**Use Case:** Playwright E2E tests use this endpoint to authenticate without Google OAuth.

---

### Users

**All user endpoints require Admin role (`users:read` or `users:write` permissions)**

#### GET /users
List all users with pagination and filtering.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `pageSize` | number | 20 | Items per page (max 100) |
| `search` | string | - | Search by email or display name |
| `isActive` | boolean | - | Filter by active status |
| `role` | string | - | Filter by role name |
| `sortBy` | enum | `createdAt` | Sort field: `email`, `createdAt`, `updatedAt` |
| `sortOrder` | enum | `desc` | Sort order: `asc`, `desc` |

**Response:**
```json
{
  "data": {
    "items": [
      {
        "id": "uuid",
        "email": "user@example.com",
        "displayName": "John Doe",
        "profileImageUrl": "https://...",
        "providerDisplayName": "John Doe",
        "providerProfileImageUrl": "https://lh3.googleusercontent.com/...",
        "isActive": true,
        "roles": ["contributor"],
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "total": 50,
    "page": 1,
    "pageSize": 20,
    "totalPages": 3
  }
}
```

**Note:** `providerDisplayName` and `providerProfileImageUrl` may be null if not available
from OAuth provider. `roles` here is a flat array of role names (unlike `GET /users/:id`,
which returns full role objects). This is the "flat" list shape shared with
`GET /allowlist` and `GET /notifications` — `data` is an object with `items` alongside
the pagination counts, not the array itself; see Pagination above.

---

#### GET /users/:id
Get user by ID.

**Parameters:**
- `id` (UUID) - User ID

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "displayName": "John Doe",
  "profileImageUrl": "https://...",
  "providerDisplayName": "John Doe",
  "providerProfileImageUrl": "https://lh3.googleusercontent.com/...",
  "isActive": true,
  "roles": ["contributor"],
  "identities": [
    {
      "provider": "google",
      "providerEmail": "user@example.com",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Note:** `providerDisplayName` and `providerProfileImageUrl` may be null if not available
from OAuth provider. `roles` is a flat array of role names here too — this endpoint does
not return role `id`/`description`; look those up via the RBAC model if needed.

**Error Cases:**
- 404 Not Found - User not found

---

#### PATCH /users/:id
Update user properties (activation status, display name).

**Requires:** `users:read` AND `users:write` permissions (the `@Auth()` guard requires
*all* listed permissions, not any one of them)

**Parameters:**
- `id` (UUID) - User ID

**Request Body:**
```json
{
  "isActive": false,
  "displayName": "New Name"
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `isActive` | boolean | No | Activate or deactivate user |
| `displayName` | string | No | Update user's display name |

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "displayName": "New Name",
  "providerDisplayName": "John Doe",
  "profileImageUrl": "https://...",
  "providerProfileImageUrl": "https://lh3.googleusercontent.com/...",
  "isActive": false,
  "roles": ["viewer"],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T12:00:00.000Z"
}
```

**Error Cases:**
- 404 Not Found - User not found
- 403 Forbidden - Admin attempting to deactivate their own account (`isActive: false` on self)

---

#### PUT /users/:id/roles
Update user roles (replaces all current roles).

**Requires:** `rbac:manage` permission

**Parameters:**
- `id` (UUID) - User ID

**Request Body:**
```json
{
  "roleNames": ["admin", "contributor"]
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `roleNames` | string[] | Yes | Array of role names to assign (min: 1) |

**Response:** Same shape as `GET /users/:id` — the updated user with its new `roles` (flat
array of role names).
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "displayName": "John Doe",
  "isActive": true,
  "roles": ["admin", "contributor"],
  "identities": [
    { "provider": "google", "providerEmail": "user@example.com", "createdAt": "2024-01-01T00:00:00.000Z" }
  ],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T12:00:00.000Z"
}
```

**Validation Rules:**
- Cannot remove own admin role (prevents accidental lockout)
- At least one role must be assigned
- Role names must exist in the system

**Error Cases:**
- 400 Bad Request - Invalid role names, empty array, or attempting to remove own admin role
- 401 Unauthorized - Not authenticated
- 403 Forbidden - Missing `rbac:manage` permission
- 404 Not Found - User not found

**Side effect:** dispatches the `security.role_changed` notification (email + in-app bell)
to the affected user, reporting the delta between their previous and new roles. This is a
`mandatory: true` event — the recipient's notification preferences cannot suppress it, even
when the actor changes their own roles. See the Notifications section below.

---

### Allowlist

**All allowlist endpoints require Admin role (`allowlist:read` or `allowlist:write` permissions)**

The allowlist restricts application access to pre-authorized email addresses. Users must have their email in the allowlist before they can complete OAuth login.

#### GET /allowlist
List allowlisted emails with pagination, filtering, and sorting.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `pageSize` | number | 20 | Items per page (max 100) |
| `search` | string | - | Search by email |
| `status` | enum | `all` | Filter by status: `all`, `pending`, `claimed` |
| `sortBy` | enum | `addedAt` | Sort by: `email`, `addedAt`, `claimedAt` |
| `sortOrder` | enum | `desc` | Sort order: `asc`, `desc` |

**Response:**
```json
{
  "data": {
    "items": [
      {
        "id": "uuid",
        "email": "user@example.com",
        "addedBy": {
          "id": "uuid",
          "email": "admin@example.com"
        },
        "addedAt": "2024-01-01T00:00:00.000Z",
        "claimedBy": {
          "id": "uuid",
          "email": "user@example.com",
          "displayName": "John Doe"
        },
        "claimedAt": "2024-01-02T00:00:00.000Z",
        "notes": "New team member"
      },
      {
        "id": "uuid",
        "email": "pending@example.com",
        "addedBy": {
          "id": "uuid",
          "email": "admin@example.com"
        },
        "addedAt": "2024-01-03T00:00:00.000Z",
        "claimedBy": null,
        "claimedAt": null,
        "notes": null
      }
    ],
    "total": 100,
    "page": 1,
    "pageSize": 20,
    "totalPages": 5
  }
}
```

**Note:** `addedBy` object contains only `id` and `email` (no `displayName`). `claimedBy`
object contains `id`, `email`, and `displayName` when not null. `data` is an object with
`items` alongside the pagination counts (the "flat" list shape) — not the array itself.

**Status Filters:**
- `all` - All allowlist entries
- `pending` - Emails not yet claimed by a user (claimedBy is null)
- `claimed` - Emails claimed by registered users (claimedBy is not null)

---

#### POST /allowlist
Add email to allowlist.

**Requires:** `allowlist:write` permission

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "notes": "Marketing team member - starts next week"
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | Valid email address (case-insensitive) |
| `notes` | string | No | Optional notes about this user |

**Response:**
```json
{
  "id": "uuid",
  "email": "newuser@example.com",
  "addedBy": {
    "id": "uuid",
    "email": "admin@example.com"
  },
  "addedAt": "2024-01-01T00:00:00.000Z",
  "claimedBy": null,
  "claimedAt": null,
  "notes": "Marketing team member - starts next week"
}
```

**Note:** `addedBy` object contains only `id` and `email` (no `displayName`).

**Error Cases:**
- 409 Conflict - Email already exists in allowlist
- 400 Bad Request - Invalid email format

---

#### DELETE /allowlist/:id
Remove email from allowlist.

**Requires:** `allowlist:write` permission

**Parameters:**
- `id` (UUID) - Allowlist entry ID

**Response:** HTTP 204 No Content

**Error Cases:**
- 404 Not Found - Allowlist entry not found
- 400 Bad Request - Cannot remove entry that has been claimed by a user

**Note:** Entries that have been claimed (user has logged in) cannot be removed. This prevents accidentally removing access for existing users.

---

### Settings

User settings have two always-present fields (`theme`, `profile`) plus three **optional
namespaces** — `dataTables`, `navigation`, `notifications` — each of which is emitted only
when the user has actually stored something for it. An absent namespace is a signal, not an
omission: it means "apply the built-in default," computed at read time, rather than a stale
value that was frozen in at some point in the past. None of the three has a server-side
default value stored on creation — this is deliberate (see `PATCH` below).

#### GET /user-settings
**Requires:** `user_settings:read` permission (every user has this)

Get current user's settings.

**Response:**
```json
{
  "theme": "light",
  "profile": {
    "displayName": "John Doe",
    "useProviderImage": true,
    "customImageUrl": null
  },
  "dataTables": {
    "jobs": {
      "visibleColumns": ["name", "status", "createdAt"],
      "density": "compact",
      "pageSize": 50
    }
  },
  "navigation": {
    "railCollapsed": false
  },
  "notifications": {
    "email": { "user.welcome": false },
    "browser": { "security.role_changed": true }
  },
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "version": 1
}
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `theme` | enum | UI theme: `light`, `dark`, `system` |
| `profile.displayName` | string \| null | User's display name override |
| `profile.useProviderImage` | boolean | Whether to use OAuth provider's profile image |
| `profile.customImageUrl` | string \| null | Custom profile image URL |
| `dataTables` | object, optional | Per-table view preferences, keyed by table id (lowercase slug, max 64 chars). Up to 40 table entries. Each entry: `visibleColumns` (string[], max 60), `density` (`compact`\|`standard`\|`comfortable`), `sort` (`{ field, direction }`), `pageSize` (1-500) — every key optional, none defaulted |
| `navigation` | object, optional | `railCollapsed` (boolean, optional) — whether the navigation rail is collapsed |
| `notifications` | object, optional | Per-channel, per-event preference overrides. Keyed `channel -> eventKey -> boolean` where `channel` is `email` or `browser`. **Absence of an event key means "use the registry default"** — see `GET /notifications/events` below. Up to 100 event entries per channel |
| `updatedAt` | string | ISO 8601 timestamp of last update |
| `version` | number | Version number for optimistic concurrency control |

---

#### PUT /user-settings
**Requires:** `user_settings:write` permission

Replace all user settings. A PUT states the settings **in full**: any of the three optional
namespaces that is omitted from the request body is simply not stored (there is no `null`
"delete" meaning on PUT the way there is on PATCH — see below).

**Request Body:**
```json
{
  "theme": "dark",
  "profile": {
    "displayName": "Jane Doe",
    "useProviderImage": false,
    "customImageUrl": "https://example.com/avatar.jpg"
  },
  "dataTables": {
    "jobs": { "density": "compact" }
  },
  "navigation": {
    "railCollapsed": true
  }
}
```

**Response:** Same shape as `GET /user-settings`, reflecting exactly what was submitted
(here `notifications` would be absent, since it was omitted from the request).

**Note:** This replaces the entire settings object. Use PATCH for partial updates.

---

#### PATCH /user-settings
**Requires:** `user_settings:write` permission

Partially update user settings, using **JSON Merge Patch** semantics — but the deletion
rules differ by namespace, so read this section before writing a client against it.

**Request Headers (Optional):**
```
If-Match: 1
```

**`theme` / `profile`:** a shallow merge. Omitted fields keep their stored value.

**`dataTables` — per-table id, whole-entry replacement:**
| Patch | Effect |
|-------|--------|
| `dataTables` absent | namespace untouched |
| `dataTables: null` | clear the whole namespace |
| `dataTables: { "jobs": null }` | delete the `jobs` entry only |
| `dataTables: { "jobs": { "pageSize": 100 } }` | **replace** the `jobs` entry wholesale (not deep-merged) — any previously stored `density`/`visibleColumns`/`sort` for `jobs` is discarded, because a table's view state is one coherent object, not independent fields |

**`navigation` — field-wise:**
| Patch | Effect |
|-------|--------|
| `navigation` absent | namespace untouched |
| `navigation: null` | clear the whole namespace |
| `navigation: { "railCollapsed": null }` | delete that one field, falling back to the built-in default |
| `navigation: { "railCollapsed": true }` | set that one field |

**`notifications` — deletes at THREE levels, and deep-merges per event key:**
| Patch | Effect |
|-------|--------|
| `notifications` absent | namespace untouched |
| `notifications: null` | clear the **whole namespace** |
| `notifications: { "email": null }` | clear the **`email` channel only**, leaving `browser` (and any other channel) untouched |
| `notifications: { "email": { "user.welcome": null } }` | delete **one event key**, restoring the absent (= registry default) state for that event/channel pair |
| `notifications: { "email": { "user.welcome": false } }` | set that one event key, touching nothing else on the channel |

Unlike `dataTables`, a non-null channel object is **deep-merged per event key**, not
replaced wholesale — a channel is a row of independent per-event toggles, and the
preferences UI PATCHes exactly the one key a user just flipped. Replacing the channel
wholesale would silently re-enable every other notification on that channel with each
toggle, which is the worst possible failure mode for a notifications feature.

**Why deleting a key (not writing the default value) matters:** `notifications: { "email":
{ "user.welcome": null } }` is what the preferences page sends when a control is returned
to its default — and it is *not* the same operation as sending `{ "user.welcome": true }`
even if `true` happens to be today's registry default for that event. Writing the literal
default value would **pin that user to today's default forever**: if the event's
`defaultEnabled` is later changed in the registry, a user who explicitly stored `true`
keeps receiving it (or not) while everyone else's behavior moves — silently diverging from
what "no opinion" is supposed to mean. Deleting the key keeps the user on "use whatever the
registry currently says," which is the sparse-absent-key contract this whole namespace
depends on.

An emptied namespace or channel — the last key of a channel deleted, or the last channel of
`notifications` deleted — collapses back to **absent** rather than being stored as `{}`.
Absent and `{}` would otherwise be two different spellings of "no opinion" for the read
path and the UI to disagree about.

**Request Body (example — delete one event preference):**
```json
{
  "notifications": {
    "email": {
      "user.welcome": null
    }
  }
}
```

**Response:** Same shape as `GET /user-settings`, reflecting the merged result.

**Optimistic Concurrency Control:**
- Include `If-Match: <version>` header to ensure settings haven't been modified by another request
- Returns **409 Conflict** if version mismatch detected
- Prevents lost updates in concurrent scenarios

**Error Cases:**
- 400 Bad Request - Validation error, or a per-user limit exceeded:
  `Too many data table preferences: N exceeds the maximum of 40. Remove entries for tables
  you no longer use (send them as null) before adding new ones.` (checked against the
  **merged** result, not just the request body — the caps exist because both namespaces
  are open, user-controlled maps and are a storage-exhaustion control, not a product limit)
  or the equivalent `Too many notification preferences for channel "<channel>": N exceeds
  the maximum of 100...` message
- 409 Conflict - `If-Match` version mismatch

---

#### GET /system-settings
**Requires:** `system_settings:read` permission (Admin only)

Get system-wide settings.

**Response:**
```json
{
  "ui": {
    "allowUserThemeOverride": true
  },
  "security": {
    "jwtAccessTtlMinutes": 15,
    "refreshTtlDays": 14
  },
  "features": {},
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "updatedBy": {
    "id": "uuid",
    "email": "admin@example.com"
  },
  "version": 1
}
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `ui.allowUserThemeOverride` | boolean | Allow users to override system theme |
| `security.jwtAccessTtlMinutes` | number | **Read-only.** JWT access token TTL in minutes, read from the `JWT_ACCESS_TTL_MINUTES` deploy-time environment variable — not stored settings, and not writable through this API |
| `security.refreshTtlDays` | number | **Read-only.** Refresh token TTL in days, read from the `JWT_REFRESH_TTL_DAYS` deploy-time environment variable — not stored settings, and not writable through this API |
| `features` | object | Feature flags (extensible) |
| `updatedAt` | string | ISO 8601 timestamp of last update |
| `updatedBy` | object | User who last updated settings |
| `version` | number | Version number for optimistic concurrency control |

**Unknown stored keys are preserved, never destroyed, by PUT or PATCH.** The request body
is still strictly validated and unknown-key-stripping on the way *in* — neither PUT nor
PATCH lets a caller smuggle an arbitrary key into `system_settings`. But if the stored row
already contains a key this version of the code does not model (written by a newer build,
a manual migration, or a future downstream extension), both PUT and PATCH carry it forward
untouched rather than silently dropping it on the next save. This key is not surfaced by
`GET /api/system-settings` — preserved is not the same as supported — but a save can never
destroy configuration a different, unrelated save was never meant to touch. A malformed
stored value (e.g. `null`, or `{ "ui": 42 }`) degrades field-by-field to the defaults
instead of making the row unsavable, so an admin can always repair it through PUT/PATCH
rather than needing a manual JSONB edit.

---

#### PUT /system-settings
**Requires:** `system_settings:write` permission (Admin only)

Replace all system settings.

**Request Body:**
```json
{
  "ui": {
    "allowUserThemeOverride": true
  },
  "features": {}
}
```

`security` is not part of the request body — it is a read-only, server-derived
block (see the GET fields table above). Sending it is not an error; the global
`ZodValidationPipe` silently strips unknown keys, so it has no effect.

**Response:**
```json
{
  "ui": {
    "allowUserThemeOverride": true
  },
  "security": {
    "jwtAccessTtlMinutes": 15,
    "refreshTtlDays": 14
  },
  "features": {},
  "updatedAt": "2024-01-01T12:00:00.000Z",
  "updatedBy": {
    "id": "uuid",
    "email": "admin@example.com"
  },
  "version": 2
}
```

---

#### PATCH /system-settings
**Requires:** `system_settings:write` permission (Admin only)

Partially update system settings.

**Request Body:**
```json
{
  "ui": {
    "allowUserThemeOverride": false
  }
}
```

**Request Headers (Optional):**
```
If-Match: 1
```

**Response:**
```json
{
  "ui": {
    "allowUserThemeOverride": false
  },
  "security": {
    "jwtAccessTtlMinutes": 15,
    "refreshTtlDays": 14
  },
  "features": {},
  "updatedAt": "2024-01-01T12:00:00.000Z",
  "updatedBy": {
    "id": "uuid",
    "email": "admin@example.com"
  },
  "version": 2
}
```

**Optimistic Concurrency Control:**
- Include `If-Match: <version>` header to ensure settings haven't been modified by another request
- Returns **409 Conflict** if version mismatch detected
- Prevents lost updates when multiple admins modify settings concurrently

---

### Email Settings

The admin-configurable outbound mail transport (SES or SMTP), plus the write-only SMTP
password. Deliberately a **separate controller and a separate `system_settings` row**
(`key = 'email'`) from `system-settings.controller.ts`, so the two surfaces cannot clobber
each other and SMTP host/username stay out of `GET /api/system-settings`'s response.

**The SMTP password is never readable through this or any other endpoint.** It is stored
encrypted in the `credentials` table (via `CredentialsService`, `purpose: 'smtp'`,
`name: 'default'`) — not in the settings JSONB blob, not in plaintext, not as a masked copy
of the real characters. `GET` and the response to `PUT` return `smtpPasswordStatus`
instead: whether a password is stored, the store's own mask (`hint`, e.g. `••••x9fQ`), and
when/by whom it was last written.

#### GET /email-settings
**Requires:** `system_settings:read` permission (Admin only)

Get email settings (Admin only).

**Response:**
```json
{
  "provider": "smtp",
  "enabled": true,
  "smtpHost": "smtp.example.com",
  "smtpPort": 587,
  "smtpUseTls": true,
  "smtpUsername": "no-reply@example.com",
  "fromAddress": "no-reply@example.com",
  "fromName": "Acme",
  "smtpPasswordStatus": {
    "configured": true,
    "hint": "••••x9fQ",
    "updatedAt": "2024-01-01T00:00:00.000Z",
    "updatedByUserId": "uuid"
  },
  "settingsError": null,
  "version": 1,
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "updatedBy": {
    "id": "uuid",
    "email": "admin@example.com"
  }
}
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `provider` | `"ses"` \| `"smtp"` \| `null` | `null` means no transport has been chosen yet (a fresh install) |
| `enabled` | boolean | Master switch. Nothing is sent while `false`, even with a provider configured |
| `sesRegion` | string, optional | SES region override; absent means "use `S3_REGION` from the environment" |
| `smtpHost`, `smtpPort`, `smtpUseTls`, `smtpUsername` | — | SMTP transport configuration. All optional (`smtpUseTls` absent is treated as `true`) |
| `fromAddress`, `fromName` | string, optional | Envelope/header sender |
| `smtpPasswordStatus.configured` | boolean | Is a password stored? |
| `smtpPasswordStatus.hint` | string \| null | The store's non-secret mask; `null` if nothing is stored |
| `smtpPasswordStatus.updatedAt` / `updatedByUserId` | — | Provenance of the stored password; `null` if nothing is stored |
| `settingsError` | string \| null | Set (instead of a 500) when the stored row exists but fails validation, so the page that repairs it can still render. Contains only field paths, never stored values |
| `version` | number | Optimistic-concurrency token for `If-Match` on `PUT` |

---

#### PUT /email-settings
**Requires:** `system_settings:write` permission (Admin only)

Replace email settings (Admin only).

**Request Body:**
```json
{
  "provider": "smtp",
  "enabled": true,
  "smtpHost": "smtp.example.com",
  "smtpPort": 587,
  "smtpUseTls": true,
  "smtpUsername": "no-reply@example.com",
  "smtpPassword": "the-new-password",
  "fromAddress": "no-reply@example.com",
  "fromName": "Acme"
}
```

**`smtpPassword` is write-only, and blank preserves the stored value.** Send it to set or
rotate the password. **Omit it, send `null`, or send `""` to keep whatever is currently
stored** — an admin editing the from-address does not have to retype a secret they cannot
see. There is no way to *erase* a stored password through this endpoint (a distinct,
separate control does that). The password is **never trimmed** — a passphrase whose
surrounding whitespace is significant is a real password, and silently altering it would
break authentication with no visible cause.

Every other optional field also accepts `""` or `null` as "leave this field empty" (an
HTML form has no way to submit "absent") — except `provider`, where `null` is a real,
persisted state ("no transport chosen") rather than an empty box.

**Request Headers (Optional):**
```
If-Match: 1
```
Use `If-Match: 0` to assert that nothing is stored yet.

**Response:** Same shape as `GET /email-settings` (never includes the password).

**Error Cases:**
- 400 Bad Request - Validation error
- 409 Conflict - `If-Match` version mismatch

---

#### POST /email-settings/test
**Requires:** `system_settings:write` permission (Admin only) — gated on *write*, not
*read*, because it is a side-effecting operation that originates real mail.

Send a test email to yourself (Admin only). The recipient is **always the authenticated
caller's own address** — there is no recipient parameter; a free-text recipient would turn
an admin settings form into a send-arbitrary-mail endpoint.

**Request:** No body.

**Response (200 OK, even on failure — see below):**
```json
{
  "success": false,
  "sentTo": "admin@example.com",
  "providerKind": "smtp",
  "messageId": null,
  "error": "535 Authentication failed",
  "attemptedAt": "2024-01-01T12:00:00.000Z"
}
```

**This endpoint answers HTTP 200 even when the send failed.** Diagnosing a mail
misconfiguration is its entire purpose, and a refused send is a *successful diagnosis* —
read the `success` field. On failure, `error` carries the mail provider's actual message
(`MessageRejected: Email address is not verified`, `535 Authentication failed`, `connection
timeout`), redacted of any credential and length-capped, never a generic "failed to send."
A client that treats HTTP 200 as "email works" will report success for every
misconfiguration there is.

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Did the provider accept the message? Never inferred — copied verbatim from the provider result |
| `sentTo` | string | The caller's own address (read-back, not request input) |
| `providerKind` | `"ses"` \| `"smtp"` \| `null` | `null` only when no provider was configured, i.e. nothing was attempted |
| `messageId` | string \| null | The transport's message id on success; `null` on failure |
| `error` | string \| null | The provider's verbatim (redacted) error message; `null` on success |
| `attemptedAt` | string | ISO 8601 timestamp of the attempt |

---

### Notifications

The read surface behind the notification bell and the `/settings/notifications`
preferences matrix. Every endpoint here is scoped to the **authenticated caller only** —
there is no `userId` parameter anywhere in this controller, on any endpoint, in either
direction. The recipient is always the bearer of the token; see `PATCH /user-settings`
above for how a user's own per-event preferences are written.

#### GET /notifications/events
**Requires Authentication** - List the registry of events this application can raise, in
the order the preferences UI should render them. Any authenticated user may read it —
everyone renders their own preferences page against the same registry.

**Response:**
```json
{
  "data": [
    {
      "key": "security.role_changed",
      "label": "Your roles changed",
      "description": "Sent when an administrator changes your roles.",
      "channels": ["email", "browser"],
      "defaultEnabled": true,
      "mandatory": true
    },
    {
      "key": "user.welcome",
      "label": "Welcome email",
      "description": "Sent once, when you first sign in.",
      "channels": ["email"],
      "defaultEnabled": true,
      "mandatory": false
    }
  ]
}
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `key` | string | Stable dotted identifier (`security.role_changed`) — what a client stores its preference against |
| `channels` | string[] | Channels this event **can** be delivered over (`email`, `browser`) — a capability of the event, not which the user has chosen. Render a preference cell only for a channel listed here |
| `defaultEnabled` | boolean | What an account with no stored preference receives |
| `mandatory` | boolean | The user may not opt out, on any channel, for this event. This is a UI hint — render the control disabled with the reason — not the enforcement point: the actual gate is server-side, in preference resolution, so a crafted request that never touches the UI still cannot silence a mandatory event |

This describes what events *exist*, not what the caller has chosen. See `GET
/user-settings` above for the caller's own preferences (the `notifications` namespace),
which is sparse: no preference row exists until a user deliberately changes something, so
an account with no stored preferences receives *every* event, enabled.

---

#### GET /notifications/stream
**Requires Authentication** - Server-Sent Events (`text/event-stream`) carrying only the
authenticated caller's notifications, live.

**Frames:**
- `event: notification` with a JSON `data` payload matching one notification (same shape
  as `GET /notifications` items, minus `readAt` — it is unread by definition at the instant
  it is streamed)
- `: heartbeat` comment lines roughly every 25 seconds, so proxies do not reap an idle
  connection. `EventSource` swallows comment lines without surfacing them.

```
: connected

event: notification
data: {"id":"…","eventKey":"security.role_changed","title":"Your roles changed","body":"…","link":"/settings","createdAt":"…"}

: heartbeat

```

**This is NOT a delivery guarantee.** There is no buffer, no `Last-Event-ID` support and no
replay — anything published while the connection is down is simply gone. `EventSource`
reconnects on its own, but reconnecting alone does not recover a gap: **the client must
refetch `GET /notifications/unread-count` and `GET /notifications` on every (re)connect**.
This is not a shortcoming to fix later; it is the design — the `notifications` table is the
source of truth, and one indexed query after a reconnect is strictly more reliable than any
replay mechanism built on top of a stream. The same refetch also covers the multi-replica
case (a connection on replica A does not see a notification published while the user was
connected to replica B).

**Client requirement — a fetch-based SSE client, not the native `EventSource`.** This route
requires the ordinary `Authorization: Bearer <token>` header like every other endpoint, and
the native `EventSource` constructor cannot send custom headers. The web client must
therefore connect with a fetch-based SSE client (e.g. `@microsoft/fetch-event-source`) that
supports headers and reconnection. **A `?token=` query parameter is deliberately not
supported and should stay that way** — a bearer credential in a URL is written to the nginx
access log, kept in browser history, and forwarded in `Referer`, turning a short-lived
token into something replayable from a log file retained for months.

---

#### GET /notifications
**Requires Authentication** - List the caller's own notifications, newest first. This is
the durable surface of the browser channel: correct regardless of whether the user ever
granted browser-notification permission, and regardless of whether the SSE stream was
connected when the notification was raised.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `pageSize` | number | 20 | Items per page (max 100) |
| `unreadOnly` | enum `"true"` \| `"false"` | `"false"` | Return only unread notifications |

**Response:**
```json
{
  "data": {
    "items": [
      {
        "id": "uuid",
        "eventKey": "security.role_changed",
        "title": "Your roles changed",
        "body": "An administrator changed your roles to: Admin, Contributor.",
        "link": "/settings",
        "readAt": null,
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "total": 12,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  }
}
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `eventKey` | string | The registry key that produced this. Not what the client renders — `title`/`body` were rendered server-side at write time, so editing a template later never rewrites what a user was already told |
| `link` | string \| null | Root-relative path to open, or `null`. Guaranteed internal — validated before the row was written, so it is always a single leading `/` with no scheme |
| `readAt` | string \| null | When the user marked it read, `null` while unread |

This is the "flat" list shape (`data.items` alongside `total`/`page`/`pageSize`/
`totalPages`) — see Pagination above.

---

#### GET /notifications/unread-count
**Requires Authentication** - The number behind the bell badge, for the caller only.

A dedicated endpoint rather than something derived from a page of `GET /notifications`,
because a count taken from one page silently caps at `pageSize` and under-reports. Call
this on load and again on every SSE (re)connect — that is how a gap in the stream is
recovered from.

**Response:**
```json
{
  "data": {
    "unreadCount": 3
  }
}
```

---

#### POST /notifications/:id/read
**Requires Authentication** - Mark one notification read. Returns the caller's resulting
unread count, so a click costs one round trip rather than two.

`POST`, not `PATCH`, and `/read` rather than a body flag: marking read is an action with
one possible outcome, not a client-chosen partial replacement of `readAt`.

**Parameters:**
- `id` (UUID) - Notification ID

**Response:**
```json
{
  "data": {
    "unreadCount": 2
  }
}
```

**Idempotent** — marking an already-read notification succeeds and leaves the original
`readAt` untouched.

**Error Cases:**
- 404 Not Found - No such notification for this user. An id belonging to another user
  returns the identical 404 (rather than 403), deliberately indistinguishable from an id
  that does not exist at all, so this endpoint cannot be used to probe for valid ids

---

#### POST /notifications/read-all
**Requires Authentication** - Mark all of the caller's notifications read in one call.

**Response (200, not 204 — the count is the reason to call this rather than marking rows
one at a time):**
```json
{
  "data": {
    "unreadCount": 0
  }
}
```

Affects only the caller's own rows. Notifications already read keep their original
`readAt`. The returned count is not assumed to be `0` — a notification arriving between the
update and the count is reported honestly rather than hidden behind a hardcoded zero.

---

### Storage Objects

The storage system provides file upload and management capabilities with support for large files (GB scale) through resumable multipart uploads.

#### Initialize Resumable Upload

`POST /api/storage/objects/upload/init`

**Requires Authentication** - Initialize a multipart upload for large files. Returns presigned URLs for direct-to-S3 uploads.

**Request Body:**
```json
{
  "name": "document.pdf",
  "size": 104857600,
  "mimeType": "application/pdf"
}
```

**Response:**
```json
{
  "data": {
    "objectId": "uuid",
    "uploadId": "s3-upload-id",
    "partSize": 10485760,
    "totalParts": 10,
    "presignedUrls": [
      { "partNumber": 1, "url": "https://..." },
      { "partNumber": 2, "url": "https://..." }
    ]
  }
}
```

---

#### Get Upload Status

`GET /api/storage/objects/:id/upload/status`

**Requires Authentication** - Check progress of an in-progress upload.

**Response:**
```json
{
  "data": {
    "status": "uploading",
    "uploadedParts": 5,
    "totalParts": 10,
    "progress": 50
  }
}
```

---

#### Complete Upload

`POST /api/storage/objects/:id/upload/complete`

**Requires Authentication** - Finalize multipart upload after all parts are uploaded.

**Request Body:**
```json
{
  "parts": [
    { "partNumber": 1, "eTag": "\"etag1\"" },
    { "partNumber": 2, "eTag": "\"etag2\"" }
  ]
}
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "document.pdf",
    "size": 104857600,
    "mimeType": "application/pdf",
    "status": "processing"
  }
}
```

---

#### Abort Upload

`DELETE /api/storage/objects/:id/upload/abort`

**Requires Authentication** - Cancel an in-progress upload and clean up resources.

**Response:** HTTP 204 No Content

---

#### Simple Upload

`POST /api/storage/objects`

**Requires Authentication** - Direct upload for small files (< 100MB) using multipart/form-data.

**Request:**
- Content-Type: `multipart/form-data`
- Body: File attached as form data with key `file`

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "document.pdf",
    "size": 1048576,
    "mimeType": "application/pdf",
    "status": "uploading"
  }
}
```

---

#### List Objects

`GET /api/storage/objects`

**Requires Authentication** - List storage objects with pagination and filtering.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `pageSize` | number | 20 | Items per page (max 100) |
| `status` | enum | - | Filter by status: `pending`, `uploading`, `processing`, `ready`, `failed` |
| `sortBy` | enum | `createdAt` | Sort field: `createdAt`, `name`, `size` |
| `sortOrder` | enum | `desc` | Sort order: `asc`, `desc` |

**Response:**
```json
{
  "data": {
    "items": [
      {
        "id": "uuid",
        "name": "document.pdf",
        "size": 104857600,
        "mimeType": "application/pdf",
        "status": "ready",
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "meta": {
      "page": 1,
      "pageSize": 20,
      "totalItems": 50,
      "totalPages": 3
    }
  }
}
```

**Note:** this is the "nested" list shape — `data.items` plus a `data.meta` object whose
total is named `totalItems`. It differs from the "flat" shape used by `GET /users`,
`GET /allowlist` and `GET /notifications` (`data.items` plus `total`/`page`/`pageSize`/
`totalPages` directly on `data`, no nested `meta`). Two shapes for the same concept across
this API is a known inconsistency, not a design choice — described here rather than
smoothed over, because a client written against this document has to handle what the
server actually sends.

---

#### Get Object

`GET /api/storage/objects/:id`

**Requires Authentication** - Get storage object metadata.

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "document.pdf",
    "size": 104857600,
    "mimeType": "application/pdf",
    "status": "ready",
    "metadata": {
      "customField": "value"
    },
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

#### Get Download URL

`GET /api/storage/objects/:id/download`

**Requires Authentication** - Get a signed download URL for the object.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `expiresIn` | number | 3600 | URL expiration in seconds |

**Response:**
```json
{
  "data": {
    "url": "https://s3.amazonaws.com/...",
    "expiresAt": "2024-01-01T01:00:00.000Z"
  }
}
```

---

#### Delete Object

`DELETE /api/storage/objects/:id`

**Requires Authentication** - Delete a storage object and its associated file.

**Response:** HTTP 204 No Content

**Error Cases:**
- 404 Not Found - Object not found
- 403 Forbidden - User does not own object (non-admin)

---

#### Update Metadata

`PATCH /api/storage/objects/:id/metadata`

**Requires Authentication** - Update custom metadata for an object.

**Request Body:**
```json
{
  "metadata": {
    "customField": "value",
    "tags": ["document", "important"]
  }
}
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "document.pdf",
    "metadata": {
      "customField": "value",
      "tags": ["document", "important"]
    },
    "updatedAt": "2024-01-01T12:00:00.000Z"
  }
}
```

---

### Health

**Public endpoints** - Used for Kubernetes liveness/readiness probes.

#### GET /health
Full health check - includes database connectivity test (currently the only indicator
registered; equivalent to `GET /health/ready` today). Built on `@nestjs/terminus`, so the
response body is Terminus's own shape, not a custom `{ status, checks }` summary.

**Response:**
```json
{
  "data": {
    "status": "ok",
    "info": {
      "database": { "status": "up", "responseTime": "3ms" }
    },
    "error": {},
    "details": {
      "database": { "status": "up", "responseTime": "3ms" }
    },
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

**Error Cases:** on failure the whole request throws and is rendered through the shared
error envelope (see Error Response above), **not** through the shape above — Terminus's
`error`/`details` keys never reach the client on a failing check:
- 503 Service Unavailable — `{ "statusCode": 503, "code": "ERROR", "message": "...",
  "timestamp": "...", "path": "/api/health" }`, with `message` naming the failed indicator

---

#### GET /health/live
Liveness check - always returns 200 if service is running. Does no I/O (no database
query), so it stays cheap even when the database is down — that is what distinguishes it
from `/health/ready`.

**Response:**
```json
{
  "data": {
    "status": "ok",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

---

#### GET /health/ready
Readiness check - includes database connectivity test. Same Terminus response shape as
`GET /health`.

**Response:**
```json
{
  "data": {
    "status": "ok",
    "info": {
      "database": { "status": "up", "responseTime": "3ms" }
    },
    "error": {},
    "details": {
      "database": { "status": "up", "responseTime": "3ms" }
    },
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

**Error Cases:**
- 503 Service Unavailable — same error-envelope shape as `GET /health` above

---

## HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | OK - Request successful |
| 201 | Created - Resource created successfully |
| 204 | No Content - Request successful, no response body |
| 400 | Bad Request - Invalid request format or validation error |
| 401 | Unauthorized - Missing or invalid authentication token |
| 403 | Forbidden - Insufficient permissions or user disabled |
| 404 | Not Found - Resource not found |
| 409 | Conflict - Resource already exists or version mismatch (optimistic concurrency) |
| 500 | Internal Server Error - Server error occurred |
| 503 | Service Unavailable - Service temporarily unavailable |

---

## Error Codes

`code` in the shared error envelope (see Error Response above) is derived **entirely from
the HTTP status** by `HttpExceptionFilter` — it is a closed, nine-value enum, and any
`code` a thrown exception supplied is overwritten rather than honored:

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `BAD_REQUEST` | 400 | Invalid request format or validation error |
| `UNAUTHORIZED` | 401 | Missing, invalid, or expired authentication token |
| `FORBIDDEN` | 403 | Insufficient permissions, or another authorization failure (e.g. email not in allowlist, disabled user) |
| `NOT_FOUND` | 404 | Requested resource not found |
| `CONFLICT` | 409 | Resource already exists, or an optimistic-concurrency (`If-Match`) version mismatch |
| `UNPROCESSABLE_ENTITY` | 422 | — |
| `TOO_MANY_REQUESTS` | 429 | — |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
| `ERROR` | any other status | Fallback for a status not in this table |

**The one exception:** `POST /auth/device/token` does not use this envelope at all — its
error body is `{ error, error_description }` per RFC 8628 §3.5, with values like
`authorization_pending`, `slow_down`, `expired_token`, `access_denied`, `invalid_grant`,
`invalid_request`. See the Device Authorization section above.

---

## Rate Limits

> **Note:** Rate limiting is recommended for production deployments but is not currently implemented in the application. Consider adding `@nestjs/throttler` or Nginx rate limiting before production deployment.

**Recommended limits:**

| Endpoint Pattern | Recommended Limit | Window |
|------------------|-------------------|--------|
| `/api/auth/*` | 10 requests | 1 minute |
| `/api/allowlist` (POST) | 30 requests | 1 minute |
| `/api/system-settings` (PUT/PATCH) | 30 requests | 1 minute |
| All other endpoints | 100 requests | 1 minute |

---

## OpenAPI Documentation

Interactive API documentation with request/response examples is available at:

**Development:** http://localhost:3535/api/docs

This serves a [Scalar](https://scalar.com) reference page (not Swagger UI) generated from the
OpenAPI 3.1 document at `/api/openapi.json`. It allows you to:
- Explore all endpoints, grouped into sections via `x-tagGroups`
- View request/response schemas, including the generated **Requires:** RBAC line per operation
- Test API calls directly from the browser
- Authenticate with one click via "Authorize with my session" (exchanges your existing browser
  session for an access token), a personal access token, or a device authorization grant

See [`docs/specs/api-documentation.md`](specs/api-documentation.md) for how the document is built.

---

## CORS Policy

The API uses a **same-origin architecture**. Both the frontend and API are served from the same host (via Nginx reverse proxy):

- Frontend: `http://localhost:3535/`
- API: `http://localhost:3535/api`

This eliminates CORS complexity and improves security. No cross-origin requests are required.

---

## Security Headers

Set by Nginx (`infra/nginx/nginx.conf`) on every response — API and frontend alike, since
both are served from the same host — not by the API process itself:

```
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
```

Notes:
- `X-Frame-Options` is `SAMEORIGIN`, not `DENY` — the application is allowed to frame
  itself.
- `Strict-Transport-Security` is inert over plain HTTP (browsers ignore it), so it has no
  effect on local development and only takes effect once the app is served over TLS.
- `style-src` allows `'unsafe-inline'` because MUI/emotion injects styles at runtime.
- `img-src` allows `https:` because avatars come from Google
  (`lh3.googleusercontent.com`) and uploaded images are served from a configurable S3
  endpoint (AWS or MinIO).

---

## Versioning

The API currently does not use versioning (v1, v2, etc.). Breaking changes will be avoided when possible. When breaking changes are necessary, they will be:

1. Announced in advance
2. Documented in migration guides
3. Implemented with a transition period when feasible

For future versions, the API may adopt URL-based versioning: `/api/v2/...`
