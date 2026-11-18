---
"@marinoscar/platform-web": minor
---

Add the settings pages to `@marinoscar/platform-web/settings/ui`: `OrgSettingsPage` (the Organization settings card), `UserProfilePage`, `UserAppearancePage`, `UserSettingsSection`, `ProfileSettings`, `ThemeSettings` and `ImageUpload`, moved from the reference app with DOM, copy and permissions unchanged, plus `createProfileImageClient`, `useProfileImageClient` and `useStorageStatus` in `/settings/headless`. The host gains optional `applyTheme` and the transport an optional `postFormData` (`createPlatformApiClient` provides it); the test host answers both. The settings slice now depends on `identity` and `onboarding`.
