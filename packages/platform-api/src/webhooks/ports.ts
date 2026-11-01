// =============================================================================
// The webhooks slice's host ports (issue #1046)
// =============================================================================
//
// One injection token per capability the slice needs from the application. The
// tenant database is the core port `PLATFORM_PRISMA`, the audit trail
// `AUDIT_SINK`, the queue `JobsService`, the notifications `NotificationsService`
// (global), the encrypted store the credentials slice's services. The one thing
// the slice cannot reach by itself is the BYPASS client, which only the app
// owns: system-scope endpoints have no organization, so their rows are visible
// to the bypass client only.
// =============================================================================

import type { RlsRunnableClient, SystemAccessReason } from '../core/index';
import type { DefaultOrgReader } from '../identity/index';
import type { WebhooksTx } from './data/webhooks-db';

/**
 * Injection token of the {@link WebhooksSystemPrisma} the app binds to its bypass client.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const WEBHOOKS_SYSTEM_PRISMA: unique symbol = Symbol.for('@marinoscar/platform/webhooks/SYSTEM_PRISMA');

/**
 * The bypass client, as the slice sees it (`PrismaSystemService` of the
 * reference app). Reached with a registered reason, always `webhooks` (every
 * system-scope query) or `retention` (the purge).
 *
 * @stability experimental
 */
export interface WebhooksSystemPrisma {
  /** One bypass statement. */
  asSystem(reason: SystemAccessReason): WebhooksTx;
  /** One interactive bypass transaction. */
  runAsSystem<R>(reason: SystemAccessReason, fn: (tx: WebhooksTx) => Promise<R>, options?: { maxWait?: number; timeout?: number }): Promise<R>;
}

/** The tenant client, as the slice sees it: `forOrg` scoped statements and the RLS transaction helper's client. @stability experimental */
export type WebhooksPrisma = RlsRunnableClient & DefaultOrgReader;
