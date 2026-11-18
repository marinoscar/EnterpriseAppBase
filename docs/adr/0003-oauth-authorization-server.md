# 0003. OAuth authorization server in the identity slice

- **Status:** Accepted
- **Date:** 2026-11-17
- **Deciders:** platform owner
- **Tracking:** issue #1179 (PP-15.1), epic #1178 (PP-15)
- **Specification:** [OAuth server](../specs/oauth-server.md). The spec holds the contract (endpoints, formats, algorithms). This record holds the reasons.

## Context

A third-party client that a user does not control (a hosted AI assistant, an MCP client, another product's integration) must be able to act for that user without a personal access token. The user signs in on this app, sees what the client asks for, and the client receives a short-lived, scoped, revocable token that works on one part of the API only.

What exists today:

- `JwtAuthGuard` (`packages/platform-api/src/identity/auth/guards/jwt-auth.guard.ts`) recognizes three credentials: the session or device JWT, `Bearer pat_...` and `Bearer nod_...`. The two opaque families are hard-coded branches. An app cannot add a fourth, because apps never edit `@marinoscar/platform-*`.
- A personal access token carries every permission of its user on every route. It has no scope and no audience. That is a documented promise, held in place by `apps/api/test/auth/pat-universality.integration.spec.ts`.
- `registerCredentialKind` makes a kind id known but grants it no privilege ([SECURITY-ARCHITECTURE.md §2](../SECURITY-ARCHITECTURE.md#2-credential-kinds)). The guard decides what each kind may do.
- A `nod_` credential is confined to `/api/nodes` by a route check that runs before any database lookup.
- The app has no OAuth discovery, no authorization endpoint, no token endpoint and no client registration. Hosted AI clients connect only through OAuth, and they start sign-in from a real HTTP `401` with a `WWW-Authenticate` header.

Four packages are involved (API, web, contract, database) plus an nginx fragment, and seven implementation tasks build it. They can run in parallel only against one written contract.

## Decision

The platform becomes an OAuth 2.1 authorization server and resource server inside the identity slice. The numbered rules below are the decision. [The spec](../specs/oauth-server.md) states each as a contract.

1. **Where it lives.** A sub-slice of identity, mounted by `IdentityModule.forRoot({ oauthServer })`. It is off unless the app mounts it and an administrator turns it on at runtime (settings namespace `oauthServer`, `enabled: false`). No environment variable.
2. **Token format.** Opaque tokens, stored as SHA-256 hashes, the same pattern as `PatService`. Prefixes: access token `oat_`, refresh token `ort_`, authorization code `oac_`.
3. **Audience binding.** The guard confines an `oat_` token to the routes of the protected resource its grant names. The decision uses the request path only, before any lookup.
4. **Scope model.** A scope maps to permission ids. The effective permission set of an `oauth` principal is the user's permissions intersected with the permissions of the granted scopes. A scope never grants a permission the user lacks.
5. **In-process sub-requests.** A protected resource that calls the app's own routes with `fastify.inject` uses a signed, in-memory delegation (`ipd_`) that is valid only inside the process and only while the originating request is alive.
6. **Client identity.** Client ID Metadata Documents first, Dynamic Client Registration second, pre-registered clients third, all behind a host allowlist that is closed by default.
7. **Consent.** A page in the signed-in web app, approved by a session credential only. It leads with the client's host, not its self-asserted name.
8. **OpenID Connect.** Not implemented. No ID tokens, no `userinfo`.

## Consequences

- **A fourth audited guard branch.** `JwtAuthGuard` gains an `oat_` branch beside `pat_` and `nod_`. The branch is additive. The guard stays `@stability stable` and existing credentials behave as before.
- **A new credential kind.** `oauth` joins the kinds in [SECURITY-ARCHITECTURE.md §2](../SECURITY-ARCHITECTURE.md#2-credential-kinds). Every built-in rule that says a PAT or device credential may not do something is reviewed for `oauth` (switch organization, create a PAT, approve a consent).
- **A narrowed principal.** Permission narrowing happens where the principal is built, so `PermissionsGuard` and every `principal.can(...)` call see the narrowed set with no change. A route guarded by `@Roles()` alone is refused to an `oauth` credential, because roles say nothing about scopes.
- **Five new tables.** `oauth_clients`, `oauth_authorization_requests`, `oauth_grants`, `oauth_authorization_codes`, `oauth_tokens`. They are user-owned, not `org` tables, so they have no row-level security (the same posture as `personal_access_tokens`). One platform migration adds them.
- **Two new permissions**, `oauth_clients:read` and `oauth_clients:write`, held by the admin role.
- **A raw-SQL partial unique index** (`oauth_grants_active_uniq_idx`) joins the intentional-drift list.
- **Two well-known documents at the origin root.** An nginx fragment proxies them to the API, as it does for `/.well-known/assetlinks.json`. A deployment without that fragment (a CDN or WAF in front) must forward the paths. The Doctor checks it.
- **Form bodies on `/api/oauth`.** The host parses `application/x-www-form-urlencoded` on those routes only.
- **A small in-memory rate limiter** behind an injectable token, because the platform has no HTTP limiter. It is per process. An app that runs several replicas can replace it with a shared store.
- **Forbidden by this decision:** an `oat_` token on a route outside its resource; an `oat_` token that carries more than its user's permissions; a consent approved by anything but a session credential; a client of an unlisted host on a deployment that has not allowed it; an `oauth` principal admitted by role alone.
- **Not in this record:** the exact wire formats, validation order and state tables. They are in the spec.

## Alternatives considered

| Decision | Chosen | Rejected, and why |
|---|---|---|
| Where it lives | Identity slice | **A separate slice.** It shares the principal graph, the guard and the user settings UI, so it would depend on identity internals either way. **App-level code.** An app cannot change `JwtAuthGuard`, so it could not add the credential branch. |
| Token format | Opaque, hashed, `oat_` / `ort_` / `oac_` | **JWT access tokens.** They cannot be revoked at once, and they need a JWKS endpoint and key rotation to operate. Opaque tokens are looked up by hash, so revocation is immediate. |
| Audience binding | Route confinement in the guard, keyed on the resource the grant names | **An `aud` claim checked by each controller.** The rule would live in many places and one forgotten check is a confused-deputy hole. |
| Scope model | Scope to permission ids; effective set is user ∩ scopes | **Scopes as a second, parallel permission system.** Two systems drift apart. Intersection reuses every existing guard and cannot exceed the user. |
| In-process sub-requests | Signed in-memory delegation | **Letting `oat_` reach all of `/api`.** It breaks audience binding. **Re-implementing each REST route inside the resource.** It duplicates validation and authorization. |
| Client identity | CIMD first, DCR second, pre-registered third, behind a host allowlist | **Open registration with no allowlist.** On a deployment whose tokens carry real authority, who may be a client is a deployment decision. Open registration stays available as `allowAnyClientHost`. |
| Consent | Web page in the signed-in app, session credential only | **Server-rendered HTML from the API.** There is no shared theme and no session: the access JWT lives in the SPA's memory. |
| OIDC | Not implemented | **Shipping ID tokens nobody consumes.** More surface to secure for no consumer. A follow-up is filed only when a consumer asks. |
| Pending requests | A database row bound to one user | **Memory or a signed cookie.** The API can run several replicas, and the decision must be bound server-side to one request and one user. |
| PAT scopes | PATs keep full authority | **A `scopes` column on `personal_access_tokens`.** PAT universality is a documented promise and a conformance check. An OAuth token also has a client, a grant and a rotation chain that a PAT lacks. |
| Skipping consent for a returning client | Always show the page | **Auto-approve an identical grant.** For a public client it opens an impersonation path (OAuth 2.1 forbids it). The page may pre-tick and say "already connected". |

## References

- Spec: [docs/specs/oauth-server.md](../specs/oauth-server.md)
- Credential kinds: [SECURITY-ARCHITECTURE.md §2](../SECURITY-ARCHITECTURE.md#2-credential-kinds); OAuth access tokens: [§19](../SECURITY-ARCHITECTURE.md#19-oauth-access-tokens-oat_)
- Open id vocabularies: [EXTENDING.md](../EXTENDING.md#open-an-id-vocabulary)
- The egress guard reused for client metadata fetches: [webhooks spec §2.7](../specs/webhooks.md#27-the-ssrf-guard)
- Standards: RFC 6749 and the OAuth 2.1 draft, 6750, 7009, 7591, 7636, 8252, 8414, 8707, 9207, 9728, and the Client ID Metadata Document draft.
- Tracking: issue #1179 (this record and the spec), epic #1178.
