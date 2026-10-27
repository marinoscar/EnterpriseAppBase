---
"@marinoscar/platform-api": minor
---

Add grants to `@marinoscar/platform-api/sharing` (#729): `registerResourceType()` (the resource-type registry, validated at registration), `AccessPolicy` (`can`, `decide`, `require`, `roleFor`, `decideMany`: owner, group owner, active unexpired grants and the org default, batched and memoised per request), the "resources I can see" helpers `accessibleWhere`, `accessibleSql` and `sharedResourceIds`, the `/api/grants` routes with the `sharing:read`, `sharing:write` and `sharing:admin` org permissions, `GrantsService.deleteForResources()`, the `sharing.shared_with_you` notification, the `sharing.grant.*` events, the `app.sharing.access_decisions` counter, the optional `SHARING_JOBS` port and the server-only `sharing.grants.prune` job with its enqueue-only daily cron (`grants.retentionDays`, default 90).
