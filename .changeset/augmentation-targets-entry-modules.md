---
"@marinoscar/platform-api": patch
"@marinoscar/platform-web": minor
---

Every module-augmentation target is declared in the entry module its public subpath resolves to, so an app's `declare module '@marinoscar/platform-*/<subpath>'` merges with the slices' own augmentations in any file order (#865): `EmailTemplateDataMap` (`/email`), `IdentityPermissionIds` and `IdentityRoleIds` (`/identity`), `NotificationChannelIds` (`/notifications`), `AppMetricKeys` (`/otel-core`), `MetricGroupIds` (`/telemetry`), `PlatformConformanceSuiteOptions` (`/testing`) and `SettingsFeatureRegistry` (`@marinoscar/platform-web/settings/headless`). The names and import paths an app uses are unchanged, except that `@marinoscar/platform-web/settings/ui` no longer re-exports `SettingsFeatureRegistry`: import and augment it from `/settings/headless`.
