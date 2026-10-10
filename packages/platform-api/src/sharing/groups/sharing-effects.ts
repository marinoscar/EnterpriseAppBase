// =============================================================================
// SharingEffects: what happens AFTER a group or grant write commits (#728, #729)
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
import { SHARED_WITH_YOU_EVENT_KEY, type SharedWithYouNotificationData } from '../notifications/shared-with-you.templates';
import { SHARING_EVENT_EMITTER, SHARING_NOTIFIER, type SharingEventEmitter, type SharingNotifier } from '../ports';
import { PrincipalGroupsProvider } from '../principal-groups.provider';

/**
 * One committed mutation's after-effects.
 *
 * @stability experimental
 */
export interface CommittedChange {
  /** The counter's `op`. */
  op: SharingMutationOp;
  /** Users whose memberships changed. */
  invalidate?: readonly string[];
  /** The event to emit, if any. */
  event?: SharingEmittedEvent;
  /** Extra events (an accepted invite emits two). */
  events?: readonly SharingEmittedEvent[];
}

/**
 * One event to emit after a commit.
 *
 * @stability experimental
 */
export interface SharingEmittedEvent {
  /** The event name. */
  name: SharingEventName;
  /** Its payload: ids and roles only. */
  payload: object;
}

/**
 * The after-commit effects of every group mutation: cache invalidation,
 * events, the mutation counter and the invitation notification. Never throws.
 *
 * @stability experimental
 */
@Injectable()
export class SharingEffects {
  private readonly logger = new Logger('SharingEffects');

  constructor(
    private readonly principalGroups: PrincipalGroupsProvider,
    @Optional() @Inject(SHARING_EVENT_EMITTER) private readonly emitter?: SharingEventEmitter,
    @Optional() @Inject(SHARING_NOTIFIER) private readonly notifier?: SharingNotifier,
    @Optional() private readonly metrics?: MetricsHostService,
  ) {}

  /**
   * Applies a committed change's after-effects. Never throws.
   *
   * @param change - what changed.
   */
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
   * Emits the events of a committed grant change (#729). Never throws; a
   * grant change invalidates no cache (decisions are per request).
   *
   * @param events - the events, ids only.
   */
  grantCommitted(events: readonly SharingEmittedEvent[]): void {
    for (const event of events) {
      try {
        this.emitter?.emit(event.name, event.payload);
      } catch (error) {
        this.logger.warn(`A listener of ${event.name} threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Dispatches `sharing.shared_with_you` to `userId` for a user grant whose
   * transaction has COMMITTED. Fire-and-forget; a failure is logged with the
   * grant id only.
   *
   * @param userId - the grantee.
   * @param data - the template data.
   * @param grantId - the grant, for the log line.
   */
  notifySharedWithYou(userId: string, data: SharedWithYouNotificationData, grantId: string): void {
    if (!this.notifier) return;
    const failed = (error: unknown) =>
      this.logger.warn(`Share notification for grant ${grantId} could not be dispatched: ${error instanceof Error ? error.message : String(error)}`);
    try {
      Promise.resolve(this.notifier.notify(SHARED_WITH_YOU_EVENT_KEY, userId, data)).catch(failed);
    } catch (error) {
      failed(error);
    }
  }

  /**
   * Dispatches the `groups.invitation` notification for an invite whose
   * transaction has COMMITTED: to the account when the address has one, else
   * to the address. Fire-and-forget; a failure is logged with the invite id
   * only.
   *
   * @param recipient - the account (when the address has one) and the address.
   * @param data - the template data.
   * @param inviteId - the invite, for the log line.
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
