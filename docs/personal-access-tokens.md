# Personal Access Tokens

This guide covers Personal Access Tokens (PATs) in the Enterprise Application Foundation.

## Table of Contents

- [Overview](#overview)
- [Use Cases](#use-cases)
- [Creating a Token](#creating-a-token)
- [Using a Token](#using-a-token)
- [Managing Tokens](#managing-tokens)
- [Duration Options](#duration-options)
- [Tokens Minted by the Device Authorization Flow](#tokens-minted-by-the-device-authorization-flow)
- [API Reference](#api-reference)
- [Security Considerations](#security-considerations)

---

## Overview

Personal Access Tokens are long-lived API tokens that allow programmatic access to the application on behalf of a specific user. Unlike OAuth flows, PATs do not require browser interaction and are suited for automated or non-interactive clients.

A PAT authenticates as the user who created it, inheriting that user's roles and permissions at the time of each request. If the user's roles change, all of their PATs reflect the updated permissions immediately.

---

## Use Cases

- **CI/CD pipelines** - Authenticate automated build and deployment scripts
- **CLI tools** - Provide persistent credentials for command-line applications. `appctl`, the
  first-party CLI (`apps/cli`, epic #110; see [`apps/cli/README.md`](../apps/cli/README.md)), is
  the primary consumer of PATs issued this way — see
  [Tokens Minted by the Device Authorization Flow](#tokens-minted-by-the-device-authorization-flow)
  below for how it obtains one without ever handling raw credentials interactively
- **Scripts and automation** - Run scheduled jobs or batch processes under a specific user identity
- **Third-party integrations** - Connect external services that call the API on behalf of a user

---

## Creating a Token

1. Navigate to **Settings → Security → Access Tokens** (`/settings/tokens`)
2. Click **Create Token**
3. Enter a descriptive name that identifies where the token will be used (for example, `CI Pipeline` or `CLI Tool`)
4. Set the token duration by entering an integer between 1 and 999, then choosing a unit: minutes, days, or months
5. Click **Create**

The token is displayed once immediately after creation. Copy it and store it securely — the full token value cannot be retrieved again after this step.

Tokens use the format `pat_<hex-string>`.

---

## Using a Token

Include the token in the `Authorization` header of every API request as a Bearer token:

```
Authorization: Bearer pat_xxxxxxxxxxxx...
```

**Example with curl:**

```bash
curl -H "Authorization: Bearer pat_abc123..." https://your-app.com/api/auth/me
```

**Example with JavaScript (fetch):**

```javascript
const response = await fetch('https://your-app.com/api/users', {
  headers: {
    'Authorization': `Bearer ${process.env.PAT_TOKEN}`,
  },
});
```

**Example with Python (requests):**

```python
import requests
import os

response = requests.get(
    'https://your-app.com/api/users',
    headers={'Authorization': f'Bearer {os.environ["PAT_TOKEN"]}'},
)
```

PATs work on all authenticated API endpoints. The request is authorized using the roles and permissions of the user who created the token.

---

## Managing Tokens

All tokens for the current user are visible at **Settings → Security → Access Tokens**
(`/settings/tokens`) — this includes tokens minted through the device authorization flow (see
below); there is no separate list for those.

Each token entry shows:

| Field | Description |
|-------|-------------|
| Name | The descriptive label entered at creation |
| Prefix | A short prefix of the token for identification (e.g., `pat_ab12...`) |
| Created | Date the token was created |
| Expires | Date and time the token expires |
| Last used | Date of the most recent successful request using this token |

To revoke a token, click **Revoke** next to the token entry. Revoked tokens are invalidated immediately. Revocation is permanent — the token cannot be re-activated. Create a new token if continued access is needed.

---

## Duration Options

Choose the duration that matches how long the token needs to remain valid. Prefer shorter durations to limit exposure if a token is compromised.

| Unit | Range | Typical use |
|------|-------|-------------|
| Minutes | 1-999 | Short-lived automation tasks, one-off scripts |
| Days | 1-999 | CI/CD pipelines, active development workflows |
| Months | 1-999 | Long-lived integrations, infrequently rotated credentials |

---

## Tokens Minted by the Device Authorization Flow

A token does not have to be created through the **Create Token** form to show up on this page.
`appctl login` (and any other client implementing the RFC 8628 device authorization flow —
`POST /api/auth/device/code`, `POST /api/auth/device/token`) can request a PAT instead of the
default short-lived session by sending `clientInfo.tokenType: "pat"` when it requests a device
code. The API mints the token exactly the same way `POST /api/pat` does — same format
(`pat_<hex>`), same SHA-256-hashed storage, same revocation model — so it appears in this page's
token list indistinguishably from one you created by hand, aside from its name (derived from the
requesting device's declared name).

Its duration is not chosen by the user: it is set from the `DEVICE_PAT_EXPIRY_DAYS` environment
variable (default 90 days), clamped server-side to 1–999 days — the same range the **Duration
Options** table above enforces for a manually-created token.

Revoking a device-issued token here has the same effect as revoking any other PAT: immediate and
permanent invalidation. There is no separate "device sessions" list to remember to check.

For the full mechanics — why a device gets a revocable PAT rather than a refreshable session, the
claim-then-mint concurrency handling, and why the device-flow endpoints return RFC 8628-shaped
`{ error, error_description }` bodies instead of this API's usual error envelope — see
[SECURITY-ARCHITECTURE.md's "Device-Flow-Minted Personal Access
Tokens"](SECURITY-ARCHITECTURE.md#device-flow-minted-personal-access-tokens). For the CLI side of
this flow (the `login` command, credential storage, CI usage), see
[`apps/cli/README.md`](../apps/cli/README.md).

---

## API Reference

All PAT endpoints require a valid JWT Bearer token or a PAT token.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/pat` | Create a new personal access token |
| GET | `/api/pat` | List all tokens for the current user |
| DELETE | `/api/pat/:id` | Revoke a token by ID |

### POST /api/pat

Create a new personal access token.

**Request:**
```json
{
  "name": "CI Pipeline",
  "duration": 90,
  "durationUnit": "days"
}
```

**Request Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Descriptive label for the token |
| `duration` | integer | Yes | Length of validity (1-999) |
| `durationUnit` | string | Yes | Unit of duration: `minutes`, `days`, or `months` |

**Response (201 Created):**
```json
{
  "data": {
    "id": "uuid-1234",
    "name": "CI Pipeline",
    "token": "pat_a1b2c3d4e5f6...",
    "prefix": "pat_a1b2",
    "expiresAt": "2026-06-27T00:00:00.000Z",
    "createdAt": "2026-03-29T00:00:00.000Z"
  }
}
```

The `token` field is only present in this response. It is not returned by any other endpoint.

---

### GET /api/pat

List all personal access tokens belonging to the current user.

**Request:**
```http
GET /api/pat
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "data": [
    {
      "id": "uuid-1234",
      "name": "CI Pipeline",
      "prefix": "pat_a1b2",
      "createdAt": "2026-03-29T00:00:00.000Z",
      "expiresAt": "2026-06-27T00:00:00.000Z",
      "lastUsedAt": "2026-03-29T12:00:00.000Z"
    }
  ]
}
```

Expired and revoked tokens are not included in the list.

---

### DELETE /api/pat/:id

Revoke a personal access token by its ID.

**Request:**
```http
DELETE /api/pat/uuid-1234
Authorization: Bearer <token>
```

**Response:** `204 No Content` (empty body)

**Error Responses:**
- **404 Not Found** - Token not found, already revoked, or does not belong to the current user

---

## Security Considerations

**Token storage:**
- Tokens are hashed with SHA-256 before being stored in the database. The raw token value cannot be recovered from the database.
- Only a short prefix is stored alongside the hash for identification in the management UI.

**Token handling:**
- Treat PATs like passwords. Do not commit them to version control, include them in logs, or share them in plain text.
- Store tokens in environment variables or secrets management systems (for example, GitHub Actions secrets, HashiCorp Vault, or a CI/CD platform's credential store).

**Rotation and expiration:**
- Use the shortest token duration that meets your needs.
- Rotate tokens on a schedule, especially for long-lived integrations.
- Revoke tokens immediately when they are no longer needed or if they may have been exposed.

**Cleanup:**
- An automated daily job (3:00 AM) deletes expired tokens immediately and revoked tokens 30 days
  after revocation. Immediately after clicking **Revoke**, a token is invalidated (it can no
  longer authenticate) but its row is not necessarily deleted right away.

**Scope:**
- PATs carry the full permissions of the user who created them. A token created by an Admin user can perform Admin-level operations. Prefer using Contributor or Viewer accounts for automated access when full Admin permissions are not required.
