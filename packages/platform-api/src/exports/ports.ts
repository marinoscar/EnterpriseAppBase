// =============================================================================
// The exports slice's host ports (issue #744)
// =============================================================================
//
// Every capability the slice needs from the application, one injection token
// per capability; the reference app binds them in
// `apps/api/src/platform/exports/exports-host.module.ts`. The tenant database
// is the core port `PLATFORM_PRISMA`, the audit trail `AUDIT_SINK`, object
// storage `STORAGE_PROVIDER`, the queue `JobsService`.
// =============================================================================

import type { SystemAccessReason } from '../core/index';
import type { ExportDb } from './export.types';

/**
 * Injection token of the app's {@link ExportsSystemData}: the bypass client.
 * The reference app binds its `PrismaSystemService`; the binding file is on
 * the reviewed allowlist of `test/tenancy/system-injection-boundary.spec.ts`.
 *
 * @example
 * ```ts
 * { provide: EXPORTS_SYSTEM_DATA, useExisting: PrismaSystemService }
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const EXPORTS_SYSTEM_DATA: unique symbol = Symbol.for('@marinoscar/platform/exports/SYSTEM_DATA');

/**
 * The app's bypass client, as the exports slice uses it. Reasons: `export`
 * (a source's reads, the status and download routes), `purge` (the expiry).
 *
 * @stability experimental
 */
export interface ExportsSystemData {
  /**
   * A client whose every operation lifts row-level security for its own
   * transaction; the slice filters every query on the owner or organization.
   *
   * @param reason - why; recorded on the active span.
   * @returns the client.
   */
  asSystem(reason: SystemAccessReason): ExportDb;
}

/**
 * Injection token of the app's {@link ExportsNotifier}.
 *
 * @example
 * ```ts
 * { provide: EXPORTS_NOTIFIER, useExisting: ExportsNotifierAdapter }
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const EXPORTS_NOTIFIER: unique symbol = Symbol.for('@marinoscar/platform/exports/NOTIFIER');

/**
 * Sends `export.ready` and `export.failed` through the app's notification
 * registry. Called after the triggering write committed, outside any
 * transaction; a rejection is logged, never rethrown.
 *
 * @stability experimental
 */
export interface ExportsNotifier {
  /**
   * Notifies one user.
   *
   * @param eventKey - `export.ready` or `export.failed`.
   * @param userId - who asked for the export.
   * @param data - the notification data ({@link ExportNotificationData}).
   */
  notify(eventKey: string, userId: string, data: ExportNotificationData): Promise<void> | void;
}

/**
 * What an export notification carries: ids and labels, never a URL or a value.
 *
 * @stability experimental
 */
export interface ExportNotificationData {
  /** The export (job) id. */
  exportId: string;
  /** The source id. */
  source: string;
  /** The source's label. */
  sourceLabel: string;
  /** The format id. */
  format: string;
}
