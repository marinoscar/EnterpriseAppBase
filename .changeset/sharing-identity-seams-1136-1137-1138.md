---
"@marinoscar/platform-api": patch
"@marinoscar/platform-contract": patch
---

Three seams for apps adopting the sharing slice:

- **Organization-wide link listing (#1136).** `GET /api/grants/links?scope=org` (`sharing:admin`, else 403 `MISSING_PERMISSION`) lists every link grant of the active organization, newest first, filtered by `status` (`active`, `expired`, `revoked`), `resourceType` and `grantedById`, paginated (`LinkGrantsService.listForOrg`). `LinkGrantsService.listExpiring({ orgId, within, resourceType?, cursor?, limit? })` returns the active links expiring within the window for a warning sweep, in the organization's scope, never with a token or URL. Contract: `linkGrantListQuerySchema` / `LinkGrantListQuery` (the link list query, `scope` defaulting to `resource`), `LINK_GRANT_LIST_SCOPES`, `LINK_GRANT_STATUS_FILTERS`.
- **System listings of groups and members (#1137).** `GroupsService.listForSystem({ reason, orgId?, cursor?, limit? })` and `GroupMembershipService.membersForSystem(groupId, { reason, orgId?, roles? })`, each requiring a registered `SystemAccessReason` (an unregistered one throws `ScopedAccessError`); with `orgId` they run in that organization's scope, without it on the system client under the reason. `SharingDataPort.runAsSystem` now takes `SharingSystemAccessReason` (the slice's reasons or an app-registered one).
- **Idempotent allowlist entry (#1138).** `IDENTITY_ALLOWLIST` (`IdentityAllowlist`), provided globally by `IdentityModule.forRoot()`: `ensureAllowed(email, { addedById?, notes?, notify? })` inserts when absent (with the `allowlist:add` audit row) and is a no-op when present (no 409, no duplicate), sending `allowlist.invitation` only with `notify: true`.
