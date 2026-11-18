---
"@marinoscar/platform-api": minor
"@marinoscar/platform-web": minor
---

User-data slice: `UserDataModule.forRoot` now defaults `USER_DATA_ENVIRONMENT` (the host slice's `DeploymentModeService` and identity's `TenancyService`; override with `environment`), so an app binds only the bypass client `USER_DATA_DB`. Adds `composedSchemaDatamodel(__dirname)` / `findComposedSchemaPath` for the `datamodel` option and the `user-data.registries` Doctor check (the conformance suite's three checks, on a running deployment; they now live in `registry-checks.ts` and are re-exported from `user-data/testing`). The slice now depends on the `doctor` and `host` slices. Web: `PlatformViewer` gains an optional `refresh()`, and the Danger Zone and factory reset pages call it after a successful action, so an app mounts them without a callback.
