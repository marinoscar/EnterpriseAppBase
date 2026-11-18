// The app's namespace manifests FIRST: `SettingsModule.forRoot()` composes the
// request bodies of `/api/system-settings` and `/api/user-settings` from the
// registries they fill.
import '../../settings/registry';

import { SettingsModule as PlatformSettingsModule } from '@marinoscar/platform-api/settings';

import { SettingsHostModule } from './settings-host.module';

// =============================================================================
// The reference app's settings slice (issue #733)
// =============================================================================
//
// One `SettingsModule.forRoot()`: `/api/user-settings`, `/api/system-settings`
// and `/api/org-settings`, `SystemSettingsService`, `UserSettingsService`,
// `OrgSettingsService`, `SettingsResolver` and `SystemSettingsRowStore`, from
// `@marinoscar/platform-api/settings`. The defaults are this app's:
// `systemRowKey: 'global'` (never change it on an existing database) and
// `orgLayer: 'auto'`.
//
// NAMED LIKE THE MODULE CLASS IT REPLACED, on purpose. Every feature module
// that read settings kept its `imports: [SettingsModule]` line; only the
// import path changed. The same dynamic-module object everywhere is one module
// to Nest, discovered where the old class was (the first importer), so the
// generated OpenAPI document keeps its path order.
// =============================================================================

export const SettingsModule = PlatformSettingsModule.forRoot({
  imports: [SettingsHostModule],
});
