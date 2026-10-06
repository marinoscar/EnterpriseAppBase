// =============================================================================
// The DI-time host ports (issue #696, PP-2.7)
// =============================================================================
//
// App-owned capabilities a packaged slice may need at runtime, reached through
// injection tokens the app binds once with `PlatformHostModule.forRoot(...)`
// (`apps/api/src/platform/platform-host.module.ts`). A slice injects a port by
// token and never imports the app's services.
//
// The tokens are `Symbol.for(...)` keys, so two copies of this file (two
// bundles, a test that loads the source next to the built package) still agree
// on identity.
//
// No port for logging (packaged code uses `new Logger(Context)` from
// `@nestjs/common`, which already routes to the app's logger through
// `app.useLogger`) and none for metrics or spans (packaged code uses
// `@opentelemetry/api`, a peer). See README.md next to this folder.
// =============================================================================

import type { Type } from '@nestjs/common';

/**
 * Injection token of the app's {@link AuditSink}.
 *
 * @example
 * ```ts
 * constructor(@Inject(AUDIT_SINK) private readonly audit: AuditSink) {}
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const AUDIT_SINK: unique symbol = Symbol.for('@marinoscar/platform/AUDIT_SINK');

/**
 * One audit event, as a packaged slice reports it. Never carries secret
 * material: `meta` holds scalars only.
 *
 * @stability experimental
 */
export interface AuditEventInput {
  /** What happened, `<resource>.<verb>` (`settings.updated`). */
  action: string;
  /** Who did it; `null` for the system itself. */
  actorUserId: string | null;
  /** The kind of thing it happened to (`system_settings`). */
  targetType: string;
  /** Which one. */
  targetId: string;
  /** Small scalar facts about the event. Never secret material. */
  meta?: Record<string, string | number | boolean | null>;
}

/**
 * Where a packaged slice records audit events. The app persists them in its
 * own audit table.
 *
 * @stability experimental
 */
export interface AuditSink {
  /**
   * Persists one audit event. Called after the triggering write commits.
   * Never receives secret material.
   */
  record(event: AuditEventInput): Promise<void>;
}

/**
 * Injection token of the app's {@link SystemSettingsStore}.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const SYSTEM_SETTINGS_STORE: unique symbol = Symbol.for('@marinoscar/platform/SYSTEM_SETTINGS_STORE');

/**
 * One settings namespace and the version of the row it was read from.
 *
 * @stability experimental
 */
export interface SystemSettingsSnapshot {
  /** The namespace's current value, as the app's namespace registry validated it. */
  value: unknown;
  /** The row version, for `If-Match` optimistic concurrency. */
  version: number;
}

/**
 * The app's deployment-wide settings, one namespace at a time. Validation,
 * `If-Match` and the settings audit trail stay in the app.
 *
 * @stability experimental
 */
export interface SystemSettingsStore {
  /**
   * The current value of one settings namespace (validated by the app's
   * namespace registry), plus the row version for If-Match.
   */
  read(namespace: string): Promise<SystemSettingsSnapshot>;
  /**
   * Patches one namespace with optimistic concurrency; audits through the
   * app's own settings path. Rejects on a version mismatch (the app's 409).
   */
  patch(
    namespace: string,
    patch: Record<string, unknown>,
    ctx: { actorUserId: string; ifMatchVersion?: number },
  ): Promise<SystemSettingsSnapshot>;
}

/**
 * Injection token of the app's Prisma client, seen as a {@link PrismaClientLike}.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const PLATFORM_PRISMA: unique symbol = Symbol.for('@marinoscar/platform/PLATFORM_PRISMA');

/**
 * Schema-independent view of the app's generated client. Slices that own
 * models narrow it with their own structural delegate types.
 *
 * @stability experimental
 */
export interface PrismaClientLike {
  /** A tagged-template raw query. */
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  /** A tagged-template raw statement; resolves to the affected row count. */
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  /** An interactive transaction. */
  $transaction<T>(fn: (tx: unknown) => Promise<T>, options?: { timeout?: number }): Promise<T>;
  /** A client extension. */
  $extends(extension: unknown): unknown;
}

/**
 * How the app binds one port: an existing provider, a class, or a factory
 * (Nest's own provider shapes, minus `provide`).
 *
 * @typeParam T - the port's interface.
 *
 * @stability experimental
 */
export type PortBinding<T> =
  | { useExisting: Type<T> | string | symbol }
  | { useClass: Type<T> }
  // Nest's own factory signature: dependencies arrive untyped, in `inject` order.
  | { useFactory: (...deps: any[]) => T | Promise<T>; inject?: any[] };
