---
"@marinoscar/platform-web": minor
---

OAuth clients: a client's Connections (#1203). `OAuthClientsPage` lists, in a client's Details drawer (now up to 480px wide), the users' grants to that client from `GET /api/admin/oauth/grants?clientId=` (`oauth_clients:read`): email, scope chips, resource, organization, connected, last used, and status (active, or revoked with its reason), with an "Include revoked" switch and paging. Revoke on an active connection asks for confirmation, then calls `DELETE /api/admin/oauth/grants/:id` and re-reads the connections and the client list; it is absent without `oauth_clients:write`. `/identity/headless` gains `useOAuthAdminGrants(filter?, api?)` with `OAuthAdminGrantFilter` and `UseOAuthAdminGrantsReturn`, and `OAuthServerApi` gains `listAdminGrants(params?: OAuthAdminGrantListParams)` and `revokeAdminGrant(id)`; `createOAuthServerApi` implements both, and an app with its own `OAuthServerApi` implementation adds them.
