import type { AuditEventInput, AuditSink } from '../../core/index';

/**
 * An {@link AuditSink} that keeps events in memory, for package tests.
 *
 * @example
 * ```ts
 * const audit = new InMemoryAuditSink();
 * PlatformHostModule.forRoot({ audit: { useFactory: () => audit } });
 * // ...
 * expect(audit.events).toEqual([expect.objectContaining({ action: 'settings.updated' })]);
 * ```
 *
 * @stability experimental
 */
export class InMemoryAuditSink implements AuditSink {
  /** Every recorded event, oldest first (copies, so later edits never leak in). */
  readonly events: AuditEventInput[] = [];

  /** Records one event. */
  async record(event: AuditEventInput): Promise<void> {
    this.events.push({ ...event, ...(event.meta ? { meta: { ...event.meta } } : {}) });
  }

  /** Forgets every recorded event. */
  clear(): void {
    this.events.length = 0;
  }
}
