---
"@marinoscar/platform-web": minor
"@marinoscar/platform-api": minor
"@marinoscar/platform-contract": minor
---

The packaged-page slot contract (PP-14.23) is applied to the AI, storage, email, Android, host, profile, appearance, organization settings, user-data and notification pages (PP-14.24, #942). Every page takes an optional `slots` prop typed to `PageSlotsBase`; a page given none renders the markup it always did (each page group has a DOM snapshot recorded from the old components).

- **Web, `@marinoscar/platform-web/core`**: `PageSlotsFrame` lays a page body out in slot order (no wrapper element), for the packaged pages and for an app's own page.
- **AI**: `AiConfigPage` (`ProviderCardExtra`, drawn under each provider's card), `AiModelsPage` and `AiUsagePage` (the table slots), `UserAiKeysPage`, `OrgAiKeysPage` and `AiPlaygroundPage` (the playground `Header` receives its "New conversation" button as `actions`). `AiUsageTable` takes `slots` too.
- **Storage, email**: `StorageConfigPage` and `EmailSettingsPage` take the base slots (the driver and transport panels stay registries).
- **Android**: `AndroidAppPage` takes the base slots; `TrustedAppsSection`, `ReleasesSection` and `NotificationsSection` are exported from `android-app/ui`.
- **Host**: `AboutPage` and `MaintenancePage` take the base slots. `MaintenanceScreen` gains `logo`, `actions` and `children`; `InstallPrompt` `icon` and `copy`; `MaintenanceBanner` `copy` and `actions`.
- **Settings**: `UserProfilePage`, `UserAppearancePage` and `OrgSettingsPage` take the base slots.
- **Notifications**: `BroadcastsPage`, `PushConfigPage`, `NotificationSettingsPage` and `UserNotificationsPage` take the base slots.
- **User data**: `FactoryResetPage` and `UserDangerZonePage` take `slots` and `copy`, and print the kept and deleted lines of the summary responses instead of constants (the constants stay as the fallback, word for word).
- **API and contract (user-data)**: `GET /api/user-data/summary` returns `kept: string[]`, `GET /api/admin/factory-reset/summary` returns `deleted: string[]` and `kept: string[]`. The platform's lines are exactly the text the web bundle held; `UserDataModelHint.summary` (a kept model) and `FactoryResetStepDef.summary` (a step) add one line each. `userDataSummarySchema` and `factoryResetSummarySchema` gain the required arrays: deploy the API before the web, and add the arrays to any hand-built summary in a test.
- The telemetry pages, the identity and sharing pages and the exports and onboarding pages stay on `test/page-slots.exempt.json`.
