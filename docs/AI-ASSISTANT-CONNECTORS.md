# Let ChatGPT, Claude and other AI assistants use your app

> **Audience:** app developers, operators, administrators and end users · **Spec:** [specs/oauth-server.md](specs/oauth-server.md) · **Runbook:** [runbooks/oauth-server.md](runbooks/oauth-server.md) · **Admin UI:** `/admin/settings/oauth-clients`, `/settings/connected-apps`

The platform includes an OAuth 2.1 authorization and resource server in the identity slice. With it, a hosted AI assistant (ChatGPT, Claude on the web, desktop and mobile, Claude Code, any MCP client) connects to your app as a custom connector. The user signs in to your app, approves a list of scopes on a consent page, and the assistant receives a short-lived token that can do no more than the user can and no more than they approved.

This guide has two parts. [Part A](#part-a-enable-it) is for the team that builds the app and the operator who deploys it. [Part B](#part-b-use-it) is for the people who connect an assistant and the administrators who watch over the connections. The design, every endpoint and the threat model live in the [spec](specs/oauth-server.md).

## What you get

| Piece | What it does |
|---|---|
| Discovery | A `401` from your connector endpoint tells the assistant where to sign in; two JSON documents under `/.well-known/` describe the server |
| Client identity | Assistants identify themselves with a metadata document (CIMD), dynamic registration (DCR) or an id an administrator pre-registered |
| Host allowlist | Only client hosts an administrator allowed may connect; the platform ships no default list |
| Consent | The user sees the client's host, the organization (multi-org mode) and the scopes grouped by risk; risky scopes start unticked |
| Tokens | `oat_` access tokens (60 minutes) and `ort_` refresh tokens (30 days, rotated, reuse revokes the grant), limited to one resource and the approved scopes |
| Step-up | A call that needs a wider scope answers `403 insufficient_scope`; the assistant sends the user back to the consent page |
| Connected apps | Every user lists and disconnects their own connections |
| Admin control | Allow or refuse hosts, pre-register or disable clients, and (API only) list and revoke any user's grant |

## Part A: Enable it

### A1. Prerequisites

- **A public `https` origin.** Hosted assistants call your app from the vendor's cloud. Set `APP_URL` to the public address with no path (`https://app.example.test`). The Doctor warns (`oauth.public_url`) when it is `http:`, loopback or private. `APP_URL` is in [`infra/compose/.env.example`](../infra/compose/.env.example).
- **A proxy that passes the discovery paths.** The platform's nginx snippet `platform/oauth-server.conf` (from `packages/platform-infra/nginx/platform/`, written by `npm run platform:infra:sync`) proxies `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource[/<path>]` to the API. The app opts in with one line in `infra/nginx/app.d/locations/oauth-server.conf`:

  ```nginx
  include /etc/nginx/platform/oauth-server.conf;
  ```

  A CDN or WAF in front must not block `/.well-known/oauth-*` or `/api/oauth/*`.
- **CORS for the public endpoints.** The token, register and revoke endpoints and the metadata documents answer browsers without credentials. When `CORS_ORIGIN` lists an allowlist, pass the open paths in `main.ts`:

  ```ts
  buildCorsOptions(process.env.CORS_ORIGIN, { openPaths: OAUTH_PUBLIC_CORS_PATHS })
  ```

  Both come from `@marinoscar/platform-api/identity` and `@marinoscar/platform-api/host`.
- **No environment variable and no secret.** The server is configured at runtime in the admin UI.

A starter app ships a deletable example, `starter/apps/api/src/platform/oauth-example.ts`; this repository's reference flow is `apps/api/test/identity/oauth/oauth-e2e.db.spec.ts`.

### A2. Mount the server and register what a client may touch

Mount the sub-slice. Until you do, an `oat_` header is `401` and no OAuth route exists.

```ts
IdentityModule.forRoot({
  imports: [/* host modules */],
  oauthServer: {},   // or { defaultAllowedClientHosts: ['client.example.test'] }
});
```

Register the metrics once, next to the app's other `app.*` instruments:

```ts
import { registerPlatformHostAppMetrics } from '@marinoscar/platform-api/host';
import { OAUTH_APP_METRICS } from '@marinoscar/platform-api/identity';

registerPlatformHostAppMetrics(OAUTH_APP_METRICS);
```

Register scopes. A scope is a named bundle of permission ids that the consent page shows. Every permission must be registered or the app does not boot. A scope narrows and never widens: a token's permissions are the user's own, intersected with the approved scopes.

```ts
registerOAuthScope({
  id: 'notes:read', title: 'Read your notes', description: 'See the notes you can see.',
  permissions: ['notes:read'], risk: 'low', default: true,
});
registerOAuthScope({
  id: 'notes:write', title: 'Change your notes', description: 'Create and edit notes.',
  permissions: ['notes:write'], risk: 'elevated',
});
```

Register a protected resource: the endpoint the assistant is told to connect to (for example an MCP endpoint).

```ts
registerOAuthProtectedResource({
  id: 'notes', path: '/api/notes-agent', routePrefixes: ['/api/notes-agent'],
  scopes: ['notes:read', 'notes:write'], name: 'Notes agent',
});
```

- The URL the user types into the assistant is `APP_URL` plus `path`: `https://app.example.test/api/notes-agent`.
- A token for the resource works only under its `routePrefixes`. Elsewhere it is refused.
- A resource needs at least one `default: true` scope. Two resources never share or nest prefixes. `/api/oauth`, `/api/auth` and `/api/nodes` are never a prefix.

### A3. Protect the resource routes

Declare `@Auth()` on every route under the prefix. A call without a token then answers `401` with a `WWW-Authenticate: Bearer resource_metadata="..."` challenge, which is how the assistant finds the sign-in. Hosted clients start sign-in only from a real HTTP `401`; never answer `200` with an error body.

**Call the app's other routes from the resource in process.** An MCP endpoint reaches the rest of the API through `InProcessDelegation`. Never forward the `oat_` header: the other routes are outside the resource's prefix.

```ts
@Post()
@Auth()
async call(@Req() request: FastifyRequest) {
  const res = await this.delegation.inject(request, { method: 'GET', url: '/api/notes' });
  return res.json();
}
```

**Tell step-up from forbidden.** Where the resource gates an operation itself (an MCP tool call), the answer depends on who lacks what:

| Situation | Answer |
|---|---|
| The token has the scope | Proceed |
| The user holds the permission, a registered scope of the resource grants it and the token lacks it | `403` `insufficient_scope`: re-consent fixes it |
| The user lacks the permission | Plain `403` |

```ts
import { oauthAccessDecision, userPermissionsOf } from '@marinoscar/platform-api/identity';

switch (oauthAccessDecision(request, 'notes:write')) {
  case 'granted': break;
  case 'step_up': throw new InsufficientScopeException({ resourceId: 'notes', requiredScopes: ['notes:write'] });
  case 'forbidden': throw new ForbiddenException();
}
userPermissionsOf(request).has('notes:write'); // the user's own set, before scope narrowing
```

`assertOAuthScopes(principal, 'notes', ['notes:write'])` is the shorter form for a fixed scope. A route that declares a permission and is denied to an `oauth` principal becomes `insufficient_scope` on its own when the rule above applies. For a response the app writes itself, `buildBearerChallenge({ resourceId, error, scope })` builds the `WWW-Authenticate` value.

**Optional.** Notify the user on connect with `@OnEvent(IDENTITY_EVENTS.OAUTH_GRANT_CREATED)` (call `notify()` after commit; the platform sends nothing itself). With several API replicas, bind a shared store to the `OAUTH_RATE_LIMITER` injection token, because the default limiter is in memory per process. Behind nginx, set `trustProxy` on the `FastifyAdapter` (never `true` on an exposed listener) or the per-address limits share one bucket ([spec §3](specs/oauth-server.md#3-configuration-and-permissions)).

### A4. Add the UI

The identity web package ships the pages; the app mounts them and spreads two opt-in registry keys. Details: [platform-web identity README](../packages/platform-web/src/identity/README.md).

| Route | Component | Registry entry |
|---|---|---|
| `/oauth/consent` (full screen, signed in) | `OAuthConsentPage` | none |
| `/oauth/error` (public) | `OAuthErrorPage` | none |
| `/settings/connected-apps` | `ConnectedAppsPage` | `identityUserSettingsSections.connectedApps` |
| `/admin/settings/oauth-clients` | `OAuthClientsPage` | `identityAdminSections.oauthClients` |

Also mount `OAuthServerStatusProvider` around the shell, call `registerSettingsFeature('oauthServer', useOAuthServerFeature)`, and hand `oauthApi: createOAuthServerApi(transport)` to the identity web adapters (the consent page renders outside the shell).

### A5. Turn it on (operator)

Full procedure: [runbooks/oauth-server.md](runbooks/oauth-server.md).

1. Deploy with `APP_URL` set to the public address.
2. Open `/admin/settings/oauth-clients` (permission `oauth_clients:write`; the `admin` role) and switch on "Let other apps connect with OAuth".
3. Under "Who may connect", add each client host you trust, exact and lower case, no `https://`: for example `claude.ai` and `chatgpt.com`. Claude Code connects from loopback addresses, allowed by "Allow apps that run on the person's own computer" (on by default). Leave "Allow apps from any host" off; the Doctor warns when it is on.
4. Run the Doctor (`/admin/settings/doctor`, category Auth) and check the five `oauth.*` checks pass.
5. Verify from outside the deployment (replace the path with your resource's):

   ```bash
   curl -i -X POST https://app.example.test/api/notes-agent
   curl -s https://app.example.test/.well-known/oauth-protected-resource/api/notes-agent
   curl -s https://app.example.test/.well-known/oauth-authorization-server
   ```

   You should see a `401` with `WWW-Authenticate: Bearer resource_metadata="..."`, then two JSON documents whose `resource` is `https://app.example.test/api/notes-agent` and whose `issuer` is `https://app.example.test`.

### A6. Prove it in tests

Run the `oauth-server` conformance suite in the app's conformance spec ([spec §4.7](specs/oauth-server.md)). It checks scope and resource registration, route confinement, session-only routes, the `401` challenge, metadata shape and that no secret leaks. The test kit (`mintOAuthTestToken`, `createOAuthTestClient`, `runOAuthAuthorizationCodeFlow` of `@marinoscar/platform-api/identity/testing`) builds tokens and flows for your own tests.

## Part B: Use it

### B1. Connect an assistant (end user)

You need the connector address from whoever runs the app. It is the app's public address plus the resource path, for example `https://app.example.test/api/notes-agent`.

| Assistant | Where to add it |
|---|---|
| ChatGPT | Add a custom connector (an MCP server) in its settings and paste the address |
| Claude (web, desktop, mobile) | Add a custom connector in its settings and paste the address |
| Claude Code | `claude mcp add --transport http <name> <address>`, then sign in from `/mcp` |
| Other MCP clients | Add the address as a remote (streamable HTTP) MCP server |

The menus change; use the vendor's current instructions for custom connectors. The steps after that are the same everywhere:

1. The assistant opens a browser window on your app. Sign in if you are not already.
2. The consent page shows the assistant's host first, then what it asks for, grouped by risk. In multi-organization mode, choose the organization it acts in.
3. Untick anything you do not want to give. Risky scopes start unticked. Press Allow (it is enabled after a moment) or Deny.
4. Back in the assistant, the connector is ready. It can do only what you ticked and only what you can do yourself.
5. Later, if a task needs more, the assistant sends you through the consent page again with the wider scope list. Consent is always shown; the assistant cannot widen itself.

If the host is not allowed, the error page says `client_not_allowed` and names it. Ask an administrator to allow it.

### B2. See and disconnect your connections (end user)

Open `/settings/connected-apps` (Settings, Security, Connected apps). It appears once an administrator has turned the feature on. Each row shows the app's host, what it may do and when it was last used. Disconnect revokes it at once: its tokens stop working and the assistant must ask you again.

### B3. Look after connections (administrator)

| Task | Where | Permission |
|---|---|---|
| Switch the feature on or off, set token lifetimes | `/admin/settings/oauth-clients`, Status | `oauth_clients:write` and `system_settings:write` |
| Allow or remove a client host, add one from "Refused attempts" | Same page, "Who may connect" | same |
| Pre-register a client, rotate its secret (shown once) | Same page, Clients | `oauth_clients:write` |
| Disable a client (revokes all its grants) or delete it | Same page, Clients | `oauth_clients:write` |
| Cut a user off at once | Deactivate the user at `/admin/settings/users`; every `oat_` token re-checks the user on each call | `users:write` |
| Switch everything off | Turn off "Let other apps connect with OAuth"; tokens are `401`, grants are kept | `oauth_clients:write` |
| List every user's grants, revoke one | API only: `GET /api/admin/oauth/grants`, `DELETE /api/admin/oauth/grants/:id` | `oauth_clients:read`, `oauth_clients:write` |

**Per-user grants are API only.** The packaged web UI has no page for the admin grants routes; Connected apps shows the signed-in user's own grants only. Use the generated reference at `/api/docs` or `appctl api`:

```bash
appctl api GET '/api/admin/oauth/grants?userId=<user id>'
appctl api DELETE /api/admin/oauth/grants/<grant id>
```

`GET` returns each grant's user, client, resource, scopes, organization and last use, never a token. `DELETE` revokes the grant and its tokens (`revoked_reason: admin`), audits `oauth:grant.revoke` with you as the actor, and is a no-op `204` when it is already revoked. An app revokes in process with `OAuthGrantService.revokeGrantAsAdmin(grantId, adminUserId)`. These routes are system-scoped: an organization administrator does not reach them.

Watch the audit log for `oauth:token.reuse_detected` (a refresh token used twice; the grant is already revoked) and `oauth:client.refused` (a host turned away). Procedure: [runbook, sections 5 and 6](runbooks/oauth-server.md#5-respond-to-oauthtokenreuse_detected).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| The assistant says it could not connect, before any consent page | Discovery paths answered by the SPA, a CDN or a WAF; `APP_URL` is `http:`; the app is not on the public internet | Run the three `curl` calls from outside; include the nginx snippet; set `APP_URL`; see Doctor `oauth.well_known` |
| Discovery returns `404` JSON | The server is off, or the path is not a registered resource | Switch it on; use the path-suffixed document of your resource |
| Error page `client_not_allowed` | The client's host is not on the list | Add the host in "Who may connect" |
| `invalid_target`, or the consent page names the wrong resource | The address the user typed differs from `APP_URL` plus the resource path | Make `APP_URL` equal the public address; give the exact address |
| The assistant keeps asking to sign in | Refresh token revoked, expired or reused | Reconnect; check for `oauth:token.reuse_detected` |
| The consent page shows a scope disabled | The user lacks the permission behind it | Grant the user the role; a scope never grants more |
| `403 insufficient_scope` in the assistant | The token lacks a scope the call needs | Approve the wider scope when the assistant asks |
| `429 temporarily_unavailable` | Rate limit, often every caller sharing the proxy's address | Set `trustProxy` or bind a shared `OAUTH_RATE_LIMITER` |
| No Connected apps card | The feature is off, or `OAuthServerStatusProvider` or `registerSettingsFeature('oauthServer', ...)` is missing | Enable the server; check the wiring in A4 |

More rows: [runbook, troubleshooting](runbooks/oauth-server.md#7-troubleshooting).

## See also

- [specs/oauth-server.md](specs/oauth-server.md): design, endpoints, hosted-client facts (§2.24), recipes (§4)
- [runbooks/oauth-server.md](runbooks/oauth-server.md): enable, allow a host, verify, reuse detection, revoke
- [adr/0003-oauth-authorization-server.md](adr/0003-oauth-authorization-server.md): why the platform runs its own server
- [Identity API README](../packages/platform-api/src/identity/README.md#oauth-server) and [identity web README](../packages/platform-web/src/identity/README.md)
- [ADMIN-GUIDE.md](ADMIN-GUIDE.md#let-another-app-connect), [SECURITY-ARCHITECTURE.md §19](SECURITY-ARCHITECTURE.md#19-oauth-access-tokens-oat_)
