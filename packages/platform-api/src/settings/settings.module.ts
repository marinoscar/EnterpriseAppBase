// =============================================================================
// SettingsModule: the settings slice's one composition entry point (issue #733)
// =============================================================================
//
// `SettingsModule.forRoot(options)` mounts `/api/user-settings`,
// `/api/system-settings` and `/api/org-settings` and provides the services
// every slice reads its configuration through. GLOBAL: a feature module
// injects `SystemSettingsService` (or `SettingsResolver`) without importing
// anything.
//
// CALL IT ONCE, AFTER THE APP REGISTERED ITS NAMESPACES. The request bodies of
// the system and user routes are composed from the namespace registries when
// `forRoot` runs (the DTO classes `createZodDto` builds, and the OpenAPI
// document generated from them, need them before any Nest hook), so the app
// imports its namespace manifests first. The reference app does both in
// `apps/api/src/platform/settings/settings.config.ts` and imports the one
// resulting module everywhere.
// =============================================================================

import { DynamicModule, Module } from '@nestjs/common';

import { REQUEST_TIME_ZONE_RESOLVER } from '../core/index';
import { IDENTITY_OAUTH_SETTINGS, PrincipalCacheModule, isOAuthServerMounted } from '../identity/index';
import { OAUTH_SERVER_SYSTEM_SETTINGS } from './oauth-server.system-settings';
import { ensureSystemSettingsNamespaces, type SystemSettingsNamespace } from './registry/system-settings-namespace';
import { OrgSettingsController } from './org-settings/org-settings.controller';
import { OrgSettingsService } from './org-settings/org-settings.service';
import { SystemSettingsRowStore } from './row-store';
import { SettingsResolver } from './settings-resolver';
import { SETTINGS_OPTIONS, resolveSettingsModuleOptions, type SettingsModuleOptions } from './settings.options';
import { createSystemSettingsController } from './system-settings/system-settings.controller';
import { SystemSettingsService } from './system-settings/system-settings.service';
import { createUserSettingsController } from './user-settings/user-settings.controller';
import { UserSettingsService } from './user-settings/user-settings.service';

const EXPORTED = [
  SystemSettingsService,
  UserSettingsService,
  OrgSettingsService,
  SettingsResolver,
  SystemSettingsRowStore,
] as const;

/**
 * The settings slice: the deployment-wide settings document
 * (`/api/system-settings`), each user's own settings (`/api/user-settings`),
 * each organization's overrides (`/api/org-settings`), the namespace
 * registries they are composed from, the system then org then user
 * `SettingsResolver` and the `SystemSettingsRowStore` for slices that own a
 * row of their own.
 *
 * @stability experimental
 */
@Module({})
export class SettingsModule {
  /**
   * The slice for one app. Call once, after the app's namespace manifests
   * ran.
   *
   * @param options - see {@link SettingsModuleOptions}.
   * @returns the dynamic module (global). It provides and exports
   *   `SystemSettingsService`, `UserSettingsService`, `OrgSettingsService`,
   *   `SettingsResolver`, `SystemSettingsRowStore` and `SETTINGS_OPTIONS`.
   * @throws Error when an option is invalid.
   *
   * @example
   * ```ts
   * import './settings/registry'; // the app's manifests: registers every namespace
   * export const settingsModule = SettingsModule.forRoot({ imports: [SettingsHostModule] });
   * ```
   *
   * @extensionPoint option
   * @stability experimental
   */
  static forRoot(options: SettingsModuleOptions = {}): DynamicModule {
    const resolved = resolveSettingsModuleOptions(options);

    // The `oauthServer` namespace (PP-15.3) belongs to a deployment that
    // mounted the OAuth server (`IdentityModule.forRoot({ oauthServer })`, called
    // first): registered here unless the app's manifest already did, before the
    // request bodies are composed below. Without it the server reads as off.
    if (isOAuthServerMounted()) {
      ensureSystemSettingsNamespaces([OAUTH_SERVER_SYSTEM_SETTINGS as SystemSettingsNamespace], 'SettingsModule.forRoot()');
    }

    // Controller order is the generated OpenAPI document's path order: the
    // app's old order (user settings, then system settings), then the org
    // layer's route, which is not mounted at all when the layer is off.
    const controllers = [
      createUserSettingsController(),
      createSystemSettingsController(),
      ...(resolved.orgLayer === false ? [] : [OrgSettingsController]),
    ];

    return {
      module: SettingsModule,
      global: true,
      // `UserSettingsService` invalidates cached principals (PP-1.12, #683).
      imports: [PrincipalCacheModule, ...resolved.imports],
      controllers,
      providers: [
        { provide: SETTINGS_OPTIONS, useValue: resolved },
        { provide: REQUEST_TIME_ZONE_RESOLVER, useExisting: SettingsResolver },
        // The OAuth server's switch and policy, read by identity's guard through its port (PP-15.3).
        {
          provide: IDENTITY_OAUTH_SETTINGS,
          useFactory: (system: SystemSettingsService) => ({ read: () => system.getNamespace('oauthServer') }),
          inject: [SystemSettingsService],
        },
        ...EXPORTED,
      ],
      exports: [SETTINGS_OPTIONS, REQUEST_TIME_ZONE_RESOLVER, IDENTITY_OAUTH_SETTINGS, ...EXPORTED],
    };
  }
}
