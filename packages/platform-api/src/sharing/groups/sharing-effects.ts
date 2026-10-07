// =============================================================================
// SharingEffects: what happens AFTER a group write commits (issue #728)
// =============================================================================
//
// Every mutation of the slice ends the same way, outside its transaction:
//
//   1. invalidate the affected users' cached memberships (here and, through
//      the bus, on every replica);
//   2. emit the in-process event (ids only);
//   3. count the mutation (`app.sharing.group_mutations`, label `op`);
//   4. for an invite, dispatch the `groups.invitation` notification.
//
// None of these may fail the request: the write is already durable. Internal.
// =============================================================================

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { MetricsHostService } from '../../otel-core/index';
import type { SharingEventName } from '../events';
import { SHARING_GROUP_MUTATIONS_METRIC, type SharingMutationOp } from '../metrics';
import { GROUPS_INVITATION_EVENT_KEY, type GroupInvitationNotificationData } from '../notifications/group-invitation.templates';
import { SHARING_EVENT_EMITTER, SHARING_NOTIFIER, type SharingEventEmitter, type SharingNotifier } from '../ports';
import { PrincipalGroupsProvider } from '../principal-groups.provider';

/** One committed mutation's after-effects. */
export interface CommittedChange {
  /** The counter's `op`. */
  op: SharingMutationOp;
  /** Users whose memberships changed. */
  invalidate?: readonly string[];
  /** The event to emit, if any. */
  event?: { name: SharingEventName; payload: object };
  /** Extra events (an accepted invite emits two). */
  events?: ReadonlyArray<{ name: SharingEventName; payload: object }>;
}

@Injectable()
export class SharingEffects {
  private readonly logger = new Logger('SharingEffects');

  constructor(
    private readonly principalGroups: PrincipalGroupsProvider,
    @Optional() @Inject(SHARING_EVENT_EMITTER) private readonly emitter?: SharingEventEmitter,
    @Optional() @Inject(SHARING_NOTIFIER) private readonly notifier?: SharingNotifier,
    @Optional() private readonly metrics?: MetricsHostService,
  ) {}

  /** Applies a committed change's after-effects. Never throws. */
  committed(change: CommittedChange): void {
    if (change.invalidate?.length) this.principalGroups.invalidateUsers(change.invalidate);
    for (const event of [...(change.event ? [change.event] : []), ...(change.events ?? [])]) {
      try {
        this.emitter?.emit(event.name, event.payload);
      } catch (error) {
        this.logger.warn(`A listener of ${event.name} threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    try {
      this.metrics?.add(SHARING_GROUP_MUTATIONS_METRIC, 1, { op: change.op });
    } catch {
      // Metrics never fail a request.
    }
  }

  /**
   * Dispatches the `groups.invitation` notification for an invite whose
   * transaction has COMMITTED: to the account when the address has one, else
   * to the address. Fire-and-forget; a failure is logged with the invite id
   * only.
   */
  notifyInvitation(recipient: { userId: string | null; email: string }, data: GroupInvitationNotificationData, inviteId: string): void {
    if (!this.notifier) return;
    const sent = recipient.userId
      ? this.notifier.notify(GROUPS_INVITATION_EVENT_KEY, recipient.userId, data)
      : this.notifier.notifyAddress(GROUPS_INVITATION_EVENT_KEY, recipient.email, data);
    Promise.resolve(sent).catch((error: unknown) =>
      this.logger.warn(`Group invitation ${inviteId} could not be dispatched: ${error instanceof Error ? error.message : String(error)}`),
    );
  }
}
