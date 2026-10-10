// =============================================================================
// `NotificationsModule.forRoot()` options (issue #738, PP-8.5)
// =============================================================================

import type { DynamicModule, ForwardReference, Type } from '@nestjs/common';

import type { PortBinding } from '../core/index';
import type { PushPayloadHook } from './channels/push-payload';
import type { RecipientHandleSource } from './ports';

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
  /**
   * Where the app keeps its users' destinations on channels it added (a Slack
   * member id, a phone number): bound to {@link NOTIFICATION_RECIPIENT_HANDLES}
   * inside the slice, so the dispatcher and every sender see it
   * (`ResolveRecipientContext.handle()`). `useExisting` names a provider a
   * module in `imports` exports; `useClass` and `useFactory` take their
   * dependencies from `imports` and the global modules. Absent: no handles
   * (`handle()` answers `null`).
   *
   * @example
   * ```ts
   * NotificationsModule.forRoot({ imports, recipientHandles: { useClass: SlackHandles } });
   * ```
   */
  recipientHandles?: PortBinding<RecipientHandleSource>;
  /**
   * Adds allowlisted extras (`actions`, `icon`, `badge`, `urgency`, `tag`) to
   * the Web Push payload of an event. Called once per push delivery; unknown
   * keys are dropped and a throw sends the push without extras. Absent: the
   * five fields every push has always carried.
   *
   * @example
   * ```ts
   * NotificationsModule.forRoot({ imports, pushPayload: (event) => (event.key === 'billing.invoice_ready' ? { tag: 'invoice', urgency: 'high' } : {}) });
   * ```
   */
  pushPayload?: PushPayloadHook;
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
  /** The binding of `NOTIFICATION_RECIPIENT_HANDLES`, or `undefined` for none. */
  readonly recipientHandles: PortBinding<RecipientHandleSource> | undefined;
  /** The push payload hook, or `undefined`. */
  readonly pushPayload: PushPayloadHook | undefined;
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
  const handles = options.recipientHandles;
  if (handles !== undefined) {
    const kinds = handles && typeof handles === 'object' ? ['useExisting', 'useClass', 'useFactory'].filter((key) => key in handles) : [];
    if (kinds.length !== 1) {
      throw new Error('NotificationsModule.forRoot: recipientHandles needs exactly one of useExisting, useClass or useFactory.');
    }
  }
  if (options.pushPayload !== undefined && typeof options.pushPayload !== 'function') {
    throw new Error('NotificationsModule.forRoot: pushPayload must be a function (event, data) => extras.');
  }
  return Object.freeze({
    imports: Object.freeze([...(options.imports ?? [])]),
    recipientHandles: handles,
    pushPayload: options.pushPayload,
  });
}
