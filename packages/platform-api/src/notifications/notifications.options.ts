// =============================================================================
// `NotificationsModule.forRoot()` options (issue #738, PP-8.5)
// =============================================================================

import type { DynamicModule, ForwardReference, Type } from '@nestjs/common';

/**
 * A module `NotificationsModule.forRoot({ imports })` accepts.
 *
 * @stability experimental
 */
export type NotificationsImport = Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference;

/**
 * What an app passes to `NotificationsModule.forRoot()`.
 *
 * Deliberately small. Web Push (VAPID) is configured at RUNTIME
 * (`/api/admin/push-config`, the private key in the credential store) and
 * never by an option or an environment variable; the email transport is the
 * email slice's; channels, events and templates are registries the app fills
 * in its manifest.
 *
 * @stability experimental
 */
export interface NotificationsModuleOptions {
  /**
   * The modules the slice needs from the app: the app's email module
   * (`EmailModule.forRoot(...)`, which is not global) and the module binding
   * the host ports (`NOTIFICATIONS_METRICS`, `NOTIFICATIONS_EVENT_BUS`). Each
   * port module must be `@Global()` or export the tokens.
   */
  imports?: readonly NotificationsImport[];
}

/**
 * Injection token of the {@link ResolvedNotificationsModuleOptions}.
 *
 * @stability experimental
 */
export const NOTIFICATIONS_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/notifications/OPTIONS');

/**
 * The options after validation, as `NOTIFICATIONS_OPTIONS` provides them.
 *
 * @stability experimental
 */
export interface ResolvedNotificationsModuleOptions {
  /** The app's modules. */
  readonly imports: readonly NotificationsImport[];
}

/**
 * Validates the options.
 *
 * @param options - the app's options.
 * @returns the resolved, frozen options.
 * @throws Error naming the field when an option is invalid.
 *
 * @stability experimental
 */
export function resolveNotificationsModuleOptions(options: NotificationsModuleOptions = {}): ResolvedNotificationsModuleOptions {
  if (options.imports !== undefined && !Array.isArray(options.imports)) {
    throw new Error('NotificationsModule.forRoot: imports must be an array of modules.');
  }
  return Object.freeze({ imports: Object.freeze([...(options.imports ?? [])]) });
}
