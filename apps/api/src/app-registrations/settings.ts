// =============================================================================
// App-owned settings namespaces and extensions (issue #677)
// =============================================================================
//
// This application's own settings namespaces, and the fields it adds inside
// platform namespaces. Upstream keeps every array empty forever; a fork adds
// its entries here and never edits a platform declaration file or a manifest.
// The manifests (`settings/registry/system-settings.manifest.ts`,
// `settings/registry/user-settings.manifest.ts`) fold the extensions into the
// namespaces they name, then register the platform namespaces, then these, so
// a key that collides with a platform one fails at import time naming the
// app's entry. Recipe: `settings/registry/README.md`.
//
// Pure data: no `register()` calls, no Nest, no Prisma (this file is read by
// `scripts/generate-settings-catalog.ts`, outside any Nest container).
// After changing a system namespace or its defaults, run
// `npm run catalog:settings --workspace=api` and commit the regenerated JSON.
// =============================================================================

import type { SystemSettingsNamespaceExtension, UserSettingsNamespaceExtension } from '@marinoscar/platform-api/settings';
import type { SystemSettingsNamespace } from '@marinoscar/platform-api/settings';
import type { UserSettingsNamespace } from '@marinoscar/platform-api/settings';

/** This app's own system settings namespaces (`system_settings.value`, the 'global' row). */
export const APP_SYSTEM_SETTINGS_NAMESPACES: readonly SystemSettingsNamespace[] = [];

/** This app's own optional user settings namespaces (`user_settings.value`). */
export const APP_USER_SETTINGS_NAMESPACES: readonly UserSettingsNamespace[] = [];

/** Fields this app adds inside registered system settings namespaces. */
export const APP_SYSTEM_SETTINGS_EXTENSIONS: readonly SystemSettingsNamespaceExtension[] = [];

/** Fields this app adds inside registered user settings namespaces (e.g. `ai.training`). */
export const APP_USER_SETTINGS_EXTENSIONS: readonly UserSettingsNamespaceExtension[] = [];

// A fork types its namespaces by module augmentation, next to its entries:
//
// declare module '@marinoscar/platform-api/settings' {
//   interface SystemSettingsNamespaces {
//     coach: CoachSettings;
//   }
// }
// declare module '@marinoscar/platform-api/settings' {
//   interface UserSettingsNamespaces {
//     onboarding: OnboardingSettings;
//   }
// }
