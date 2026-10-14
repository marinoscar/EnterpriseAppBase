import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { IDENTITY_EVENTS, type IdentityUserCreatedEvent } from '@marinoscar/platform-api/identity';

// =============================================================================
// Example: reacting to `identity.user.created` (issue #727)
// =============================================================================
//
// The reference app's worked example of identity's event seam (rung 4): an app
// that keeps its own per-user side table (a profile row, a quota row) creates
// it here, instead of editing the identity package. Emitted after the user's
// transaction committed; `EventEmitter2` dispatches synchronously, so a
// listener does small, bounded work or enqueues a job, never long-running work.
//
// This app has no side table, so the example only logs (at debug level: a
// sign-up is not an operational event).
// =============================================================================

/** Logs every user identity creates. The app's example listener. */
@Injectable()
export class IdentityUserCreatedListener {
  private readonly logger = new Logger(IdentityUserCreatedListener.name);

  @OnEvent(IDENTITY_EVENTS.USER_CREATED)
  onUserCreated(event: IdentityUserCreatedEvent): void {
    this.logger.debug(`User ${event.userId} created (${event.source}) in organization ${event.orgId ?? '(none)'}`);
  }
}
