// =============================================================================
// Example: listening to sharing events (issue #732)
// =============================================================================
//
// Extension point: `SHARING_EVENTS` (rung 4: events).
//
// The slice emits through `SHARING_EVENT_EMITTER` (the reference app binds
// `EventEmitter2`), AFTER the change committed, with ids and roles only (never
// an address or a name). A listener stays small: it records, counts or
// enqueues. Real work (a network call, a file) is a queued job (CLAUDE.md,
// "Every Long-Running Activity Is a Queue Job"; `test/jobs/on-event-no-io.spec.ts`
// forbids storage I/O in an `@OnEvent` body).
//
// This one keeps the last grant changes in memory, for a "recent sharing
// activity" panel. Proven by ./grant-events.example.spec.ts (wiring) and
// ./user-owned-resource.example.db.spec.ts (the slice emitting it for real).
// =============================================================================

import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SHARING_EVENTS, type GrantEventPayload } from '@marinoscar/platform-api/sharing';

/** One recorded change. */
export interface SharingActivity {
  event: 'shared' | 'changed' | 'revoked';
  resource: string;
  granteeKind: GrantEventPayload['granteeKind'];
  role: string;
  previousRole: string | null;
}

@Injectable()
export class SharingActivityListener {
  /** Newest last, at most `MAX` entries: a bounded in-memory record, no I/O. */
  static readonly MAX = 100;
  readonly recent: SharingActivity[] = [];

  @OnEvent(SHARING_EVENTS.GRANT_CREATED)
  onCreated(payload: GrantEventPayload): void {
    this.record('shared', payload);
  }

  @OnEvent(SHARING_EVENTS.GRANT_UPDATED)
  onUpdated(payload: GrantEventPayload): void {
    this.record('changed', payload);
  }

  @OnEvent(SHARING_EVENTS.GRANT_REVOKED)
  onRevoked(payload: GrantEventPayload): void {
    this.record('revoked', payload);
  }

  private record(event: SharingActivity['event'], payload: GrantEventPayload): void {
    this.recent.push({
      event,
      resource: `${payload.resourceType}:${payload.resourceId}`,
      granteeKind: payload.granteeKind,
      role: payload.role,
      previousRole: payload.previousRole,
    });
    if (this.recent.length > SharingActivityListener.MAX) this.recent.shift();
  }
}
