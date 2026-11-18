# Runbook: Let third-party clients connect with OAuth

> **Audience:** operators · **Spec:** [specs/oauth-server.md](../specs/oauth-server.md) · **Admin UI:** `/admin/settings/oauth-clients` · **Permission:** `oauth_clients:read` to look, `oauth_clients:write` to change

Use this runbook to switch the OAuth server on, decide which client hosts may connect, check that a hosted client can reach it, and react when something goes wrong: a refresh token was replayed, a client must be cut off, a user must lose every connection, or a client says it cannot connect. It changes the `oauthServer` system settings and the grants and clients stored in the database. It assumes the app mounts the server (`IdentityModule.forRoot({ oauthServer })`) and registers at least one protected resource; the examples use the placeholder host `app.example.test`.

## 1. Before you start

- **The deployment must be public.** Hosted clients (an AI assistant in a vendor's cloud) call `https://app.example.test` from the internet. `APP_URL` must be that public `https` address, with no path.
- **The proxy must pass the discovery paths.** The app's nginx includes `platform/oauth-server.conf` (`include /etc/nginx/platform/oauth-server.conf;` in `infra/nginx/app.d/locations/oauth-server.conf`). A CDN or WAF in front must not block `/.well-known/oauth-*` or `/api/oauth/*`.
- **Know the resource URL.** It is `APP_URL` plus the registered resource path (for example `https://app.example.test/api/mcp`). The person connecting types it into the client.
- **Permissions.** `oauth_clients:write` (the `admin` role) to change settings; `system_settings:read` to open the page.
- **Back up** nothing special: the OAuth tables are in the normal database backup.

## 2. Enable the server

1. Open `/admin/settings/oauth-clients`.
2. Under Status switch on "Let other apps connect with OAuth". The Issuer URL shown equals `APP_URL`.
3. Review "Who may connect" ([section 3](#3-allow-a-client-host)). The defaults are closed: no hosted client may connect until you add its host.
4. Review the token lifetimes (access token 60 minutes, refresh token 30 days, capped at 180 days) and the switches for metadata-document clients and self-registration (both on by default).
5. Open `/admin/settings/doctor` and run it ([section 4](#4-verify)).

You should see: the discovery documents answer (section 4) and `GET /api/oauth/.well-known/authorization-server` returns `200`. While the server is off it returns `404`.

## 3. Allow a client host

A client is admitted only when its host is allowed (or an administrator pre-registered it).

1. In "Who may connect", type the exact lower-case host, for example `client.example.test` (no `https://`, no wildcard) and press Add.
2. Or wait for an attempt: a refused host appears under "Refused attempts" for 30 days, with an Allow button.
3. Native apps that use `http://127.0.0.1:<port>/...` redirects connect while "Allow apps that run on the person's own computer" is on.
4. Avoid "Allow apps from any host": it admits every host and the Doctor warns (`oauth.client_policy`).

You should see the host in the list, and a client from it reaching the consent page. A client from any other host gets the error page `client_not_allowed` naming its host. Removing a host also stops that client's refresh tokens at the next `/token` call.

To pre-register a client instead (a partner that cannot use metadata documents), use Clients, add a name, redirect URIs and an authentication method; a confidential client's secret is shown once.

## 4. Verify

The Doctor (`/admin/settings/doctor`, category Auth) runs five read-only checks:

| Check | Pass means |
|---|---|
| `oauth.public_url` | `APP_URL` is a public `https` address |
| `oauth.well_known` | Both discovery documents answer JSON at the public URL, with the expected `issuer` and `resource` |
| `oauth.client_policy` | `allowAnyClientHost` is off; the allowed hosts are listed |
| `oauth.resources` | At least one protected resource is registered |
| `oauth.token_cleanup` | No token expired more than 7 days ago is still stored |

Then verify from outside the deployment with three calls (replace the resource path with your own):

```bash
curl -i -X POST https://app.example.test/api/mcp
```

You should see `HTTP/1.1 401` and `WWW-Authenticate: Bearer resource_metadata="https://app.example.test/.well-known/oauth-protected-resource/api/mcp"`.

```bash
curl -s https://app.example.test/.well-known/oauth-protected-resource/api/mcp
```

You should see JSON whose `resource` is `https://app.example.test/api/mcp` and whose `authorization_servers` is `["https://app.example.test"]`.

```bash
curl -s https://app.example.test/.well-known/oauth-authorization-server
```

You should see JSON with `"issuer": "https://app.example.test"`, `token_endpoint` `https://app.example.test/api/oauth/token` and `"code_challenge_methods_supported": ["S256"]`. If any call returns HTML, a redirect or a different status, go to [troubleshooting](#7-troubleshooting).

## 5. Respond to `oauth:token.reuse_detected`

The audit log (`audit_events`) holds a row with action `oauth:token.reuse_detected` when a refresh token that had already been rotated (outside the 10-second grace window) or an authorization code was used again. Two parties held the secret, so the server revoked the whole grant and every token of it.

1. Find the row: action `oauth:token.reuse_detected`; the target id is the grant (never a token, code or secret).
2. Check whether it is a client bug (a client that stores tokens in two places and refreshes twice) or theft: many rows for one client suggest a bug; one row for a client that normally behaves suggests a leak.
3. Tell the user. Their connection is already revoked (`invalid_grant`); they reconnect from the client and see the consent page again.
4. If you suspect the client itself, disable it ([section 6](#6-revoke-everything-for-a-user-or-a-client)).

You should see the grant gone from the user's Connected apps and `401` for every token of it.

## 6. Revoke everything for a user or a client

**One client** (a compromised or unwanted app): in Clients, choose Disable on the client. Every active grant of it is revoked at once (`client_disabled`) and its token calls fail. Delete removes the client and cascades its grants and tokens. Rotate secret replaces a confidential client's secret (shown once).

**One user:** the user disconnects each app in `/settings/connected-apps`. To cut a user off at once, deactivate the user (`/admin/settings/users`): every `oat_` token re-checks the user on every request and is refused. Leaving an organization is also enforced: a token whose grant is for an organization the user no longer belongs to is refused. Offboarding an organization revokes its grants (`offboarding`).

**Everything:** switch the server off ("Let other apps connect with OAuth"). Every `oat_` token is `401` and every OAuth route is `404` at once; grants and clients are kept, so switching it on again restores them (tokens that expired meanwhile need a refresh).

You should see the connections vanish from Connected apps (disable and delete) and the next call with an old token answer `401`.

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The client says it could not reach the server, or "Couldn't connect" before any consent page | `/.well-known/oauth-*` is answered by the SPA, a CDN or a WAF; or `APP_URL` is `http:`; or the app is off the public internet | Run the three `curl` calls of section 4 from outside. Make the proxy include `platform/oauth-server.conf`; allow the paths in the WAF and CDN; set `APP_URL` to the public `https` address and restart the API. `oauth.well_known` and `oauth.public_url` name the failure |
| The discovery call returns `404` JSON | The server is off, or no resource is registered (the bare protected-resource path is `404` unless exactly one resource exists) | Enable the server; request the path-suffixed document of your resource |
| Authorization failed, error page `client_not_allowed&host=...` | The client's host is not allowed | Add the host ([section 3](#3-allow-a-client-host)). The Refused attempts list shows it |
| Error page `invalid_redirect_uri` | The client's redirect URI does not match a registered one exactly (loopback ports excepted) | Fix the client's registration; an administrator can edit a pre-registered client's redirect URIs |
| Error page `client_metadata_unavailable` | The client's metadata document URL could not be fetched (it must be public `https`, JSON, at most 64 KiB) | Ask the client's owner to fix the document; the egress guard refuses private addresses |
| Error `invalid_target` back at the client, or the consent page names the wrong resource | The `resource` the client sent is not the `APP_URL` + resource path exactly; `APP_URL` differs from the URL the user typed | Make `APP_URL` equal the public address; give the client the exact resource URL |
| Token calls fail with `invalid_grant` | The refresh token was reused, revoked, expired or its client disabled | The user reconnects. Check section 5 |
| `400 unauthorized_client` at the token endpoint | The client's host was removed from the allowlist | Allow the host again or disconnect the client |
| `429 temporarily_unavailable` | The rate limit: `/authorize` 30 per minute per address, `/register` 10 per hour per address, `/token` and `/revoke` 60 per minute per client | Wait for `Retry-After`. Behind nginx every caller shares the proxy's address because the API does not set `trustProxy`: set `trustProxy` on the `FastifyAdapter` to the proxy's address (never `true` on an exposed listener) or replace `OAUTH_RATE_LIMITER` with a shared limiter |
| A browser client is blocked by CORS | The app's `main.ts` does not pass `OAUTH_PUBLIC_CORS_PATHS` to `buildCorsOptions` while `CORS_ORIGIN` lists an allowlist | Pass `{ openPaths: OAUTH_PUBLIC_CORS_PATHS }` |
| The consent page offers fewer scopes than the client asked | The user lacks the permission behind a scope (it is shown disabled) | Grant the user the role or permission; a scope never grants more than the user holds |
| `oauth.token_cleanup` warns | The `oauth.token.cleanup` job is not running (hourly) | Check the job worker and `/admin/settings/jobs` |

## 8. Summary checklist

- [ ] `APP_URL` is the public `https` address; nginx includes `platform/oauth-server.conf`.
- [ ] The server is enabled at `/admin/settings/oauth-clients`.
- [ ] Each trusted client host is on the list; "any host" is off.
- [ ] The five `oauth.*` Doctor checks pass.
- [ ] The three `curl` calls answer as described.
- [ ] A test connection from the client reaches the consent page and completes.
- [ ] You know where `oauth:token.reuse_detected` rows are and how to disable a client.

## See also

- [specs/oauth-server.md](../specs/oauth-server.md) and [SECURITY-ARCHITECTURE.md §19](../SECURITY-ARCHITECTURE.md#19-oauth-access-tokens-oat_)
- [runbooks/doctor.md](doctor.md)
- [ADMIN-GUIDE.md](../ADMIN-GUIDE.md#let-another-app-connect)
