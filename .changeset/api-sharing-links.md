---
"@marinoscar/platform-api": minor
---

Link shares in `@marinoscar/platform-api/sharing` (#730): `LinkGrantsService` and `/api/grants/links` (mint `lnk_` tokens returned once and stored as a SHA-256 hash plus a ciphertext bound to the grant id; `reuseActive`; 503 without `SECRETS_ENCRYPTION_KEY`), link management through `PATCH`/`DELETE /api/grants/:id` (label, capped expiry, `grant:link:*` audit), the deliberately public `GET /api/public/links/current` (header `X-Link-Token`, one 404 for every failure, a per-address miss throttle with 429), the public-route pattern `LinkGrantGuard`, `@LinkGrantResource`, `@CurrentLinkGrant`, `LinkGrantsService.withLinkScope` and `PublicLinkInterceptor`, `importLegacyToken` for data migrations, the `links` options of `forRoot` and the `app.sharing.link_resolutions` counter.
