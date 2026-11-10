---
"@marinoscar/platform-api": minor
---

Package the role and permission registries in `@marinoscar/platform-api/core`: `roleRegistry`, `permissionRegistry`, `registerRoles`, `registerPermissions`, `permissionIds`, `roleIds`, the declaration types (`RoleDeclaration`, `PermissionDeclaration`, `PermissionScope`) and the seed catalog built from them (`buildPermissionCatalog`, the detached `composePermissionCatalog`, `catalogGrants`), so an app no longer copies them.
