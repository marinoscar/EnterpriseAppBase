---
"@marinoscar/platform-api": minor
---

Add the `./settings` and `./settings/testing` subpaths (#733): `SettingsModule.forRoot({ systemRowKey, orgLayer, imports })` with `/api/system-settings` and `/api/user-settings` (moved unchanged, the same OpenAPI document) and the new `/api/org-settings` (`org_settings:read|write`, `If-Match`, per-namespace permission filtering); the system and user namespace registries with an optional org layer (`override` or a restricting merge) and `forbiddenKeys`, refusing secret-named fields (now including `privateKey`); `SystemSettingsService`, `UserSettingsService`, `OrgSettingsService`, `SettingsResolver` (system, then org, then user) and `SystemSettingsRowStore`; the host ports `SETTINGS_DATA` and `SETTINGS_PROFILE_IMAGES`; the permission, model-ownership and user-owned declarations; and the `settings` conformance suite.
