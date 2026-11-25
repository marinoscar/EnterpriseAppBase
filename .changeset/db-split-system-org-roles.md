---
"@marinoscar/platform-db": minor
---

Split RBAC into system roles and org roles (#723), as platform migration `0024_split_system_org_roles`. The identity fragment gains the `RoleScope` enum (`system`, `org`), `Role.scope` and `Permission.scope` (default `system`), `Membership.roleId` (required, `onDelete: Restrict`) and `Invite.roleId` (nullable: NULL means the default org role). The migration creates the `org_admin` role, scopes `contributor`, `viewer` and the org permissions to `org`, moves the `admin` role's org-permission grants to `org_admin`, sets every membership's role from the user's global roles (`admin` to `org_admin`, else the highest of `contributor` and `viewer`, else `viewer`) and deletes the `user_roles` rows of org-scoped roles.

`seedPlatform` writes and refreshes the `scope` of a role or permission entry that declares one; `SeedNamedEntry` gains an optional `scope` and the package exports `SeedScope`.
