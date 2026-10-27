---
"@marinoscar/platform-api": minor
---

Add the `./sharing` subpath (#728): `SharingModule.forRoot({ host, imports, groups })` with the `/api/groups` routes (groups, members, invites, the invitee's own invites), 404 non-disclosure, the last-admin rule, read-time invite expiry, a per-account throttle on failed member lookups by e-mail, audit rows with `org_id`, the `sharing.groups.orphaned` Doctor check and the `app.sharing.group_mutations` counter. Also the ownership contract (`ResourceOwner`, `registerGroupOwnedResource`, `ownedByMeOrMyGroups`), `PrincipalGroupsProvider` (lazy, cached, bus-invalidated `Scope.groupIds`), the host ports `SHARING_DATA`, `SHARING_EVENT_BUS`, `SHARING_EVENT_EMITTER`, `SHARING_NOTIFIER` and `SHARING_TENANCY`, the `SHARING_EVENTS`, the `groups.invitation` notification and its renderers, the org-scope `groups:*` permission declarations, the user-owned and model-ownership declarations and `GroupMembershipPurge`.
