// =============================================================================
// `SettingsModule.forRoot()` options (issue #733, PP-8.1)
// =============================================================================

import type { DynamicModule, ForwardReference, Type } from '@nestjs/common';

/**
 * Injection token of the {@link ResolvedSettingsModuleOptions}, provided by
 * `SettingsModule.forRoot()`. Optional to every consumer: a graph built
 * without `forRoot` (a unit test) gets {@link DEFAULT_SETTINGS_OPTIONS}.
 *
 * @stability experimental
 */
export const SETTINGS_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/settings/OPTIONS');

/**
 * What an app passes to `SettingsModule.forRoot()`. No option is an
 * environment variable: settings are runtime configuration and live in the
 * database.
 *
 * @stability experimental
 */
export interface SettingsModuleOptions {
  /**
   * The key of the main `system_settings` row, the one holding every
   * registered namespace. Default `'global'`. DO NOT CHANGE IT on an existing
   * database: the row under the old key is orphaned and every namespace reads
   * as its defaults.
   */
  systemRowKey?: string;
  /**
   * The org layer of `SettingsResolver.resolveSystem` and `/api/org-settings`.
   * `true`: on. `false`: off (the resolver returns the system value, the org
   * routes answer 404). `'auto'` (the default): on in `TENANCY_MODE=multi`; in
   * single-org mode an organization's row is applied only when it exists,
   * which in practice means the default organization was given overrides, so
   * a single-org deployment that never wrote one behaves exactly as before.
   */
  orgLayer?: boolean | 'auto';
  /**
   * The modules that bind the slice's host ports (`SETTINGS_DATA`,
   * `SETTINGS_PROFILE_IMAGES`). Each must be `@Global()` or export the tokens.
   */
  imports?: ReadonlyArray<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

/**
 * The options after defaults, as `SETTINGS_OPTIONS` provides them.
 *
 * @stability experimental
 */
export interface ResolvedSettingsModuleOptions {
  /** The main system row's key. */
  readonly systemRowKey: string;
  /** The org layer switch. */
  readonly orgLayer: boolean | 'auto';
  /** The host-port modules. */
  readonly imports: ReadonlyArray<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

/**
 * The options a graph without `forRoot` behaves as.
 *
 * @stability experimental
 */
export const DEFAULT_SETTINGS_OPTIONS: ResolvedSettingsModuleOptions = Object.freeze({
  systemRowKey: 'global',
  orgLayer: 'auto',
  imports: Object.freeze([]),
});

const ROW_KEY = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * Applies defaults and validates the options.
 *
 * @param options - the app's options.
 * @returns the resolved, frozen options.
 * @throws Error naming the field when an option is invalid.
 *
 * @stability experimental
 */
export function resolveSettingsModuleOptions(options: SettingsModuleOptions = {}): ResolvedSettingsModuleOptions {
  const systemRowKey = options.systemRowKey ?? DEFAULT_SETTINGS_OPTIONS.systemRowKey;
  if (!ROW_KEY.test(systemRowKey)) {
    throw new Error(
      `SettingsModule.forRoot: systemRowKey ${JSON.stringify(systemRowKey)} is not a row key (lower-case letters, digits and _).`,
    );
  }
  const orgLayer = options.orgLayer ?? DEFAULT_SETTINGS_OPTIONS.orgLayer;
  if (orgLayer !== true && orgLayer !== false && orgLayer !== 'auto') {
    throw new Error(`SettingsModule.forRoot: orgLayer must be true, false or 'auto', got ${JSON.stringify(orgLayer)}.`);
  }
  return Object.freeze({
    systemRowKey,
    orgLayer,
    imports: Object.freeze([...(options.imports ?? [])]),
  });
}
