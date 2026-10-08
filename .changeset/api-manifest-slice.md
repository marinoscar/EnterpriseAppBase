---
"@marinoscar/platform-api": minor
---

Add `@marinoscar/platform-api/manifest`: the platform roles and every slice's permission sets in seed order (`PLATFORM_ROLES`, `PLATFORM_PERMISSION_SETS`, `PLATFORM_PERMISSIONS`), `registerPlatformPermissions()` and the pure `platformPermissionCatalog()` (with the app's own roles and permissions and an optional `slices` filter) for `seedPlatform`, and the inventory of platform models with a foreign key to `User` (`PLATFORM_USER_OWNED_MODELS`, `registerPlatformUserOwnedModels()`), so the `userOwnedData` suite covers platform and app models in any app.
