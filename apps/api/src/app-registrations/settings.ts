// =============================================================================
// App-owned settings namespaces (issue #677)
// =============================================================================
//
// This application's own system settings namespaces. Upstream keeps the array
// empty forever; a fork adds its entries here and never edits a platform
// declaration file or the manifest. Registered by
// `settings/registry/system-settings.manifest.ts`, after every platform
// namespace, so a key that collides with a platform one fails at import time
// naming the app's entry. Recipe: `settings/registry/README.md`.
//
// Pure data: no `register()` calls, no Nest, no Prisma (this file is read by
// `scripts/generate-settings-catalog.ts`, outside any Nest container).
// =============================================================================

import type { SystemSettingsNamespace } from '../settings/registry/system-settings-namespace';

/** This app's own system settings namespaces, registered after the platform's. */
export const APP_SYSTEM_SETTINGS_NAMESPACES: readonly SystemSettingsNamespace[] = [];

// A fork types its namespace by module augmentation, next to its entry:
//
// declare module '../settings/registry/system-settings-namespace' {
//   interface SystemSettingsNamespaces {
//     coach: CoachSettings;
//   }
// }
