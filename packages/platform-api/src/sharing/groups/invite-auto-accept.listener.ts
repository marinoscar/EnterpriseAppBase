// =============================================================================
// InviteAutoAcceptListener: claim pending group invites at sign-up / sign-in
// =============================================================================
//
// Registered by `SharingModule.forRoot` only when `groups.autoAcceptInvitesOnSignup`
// or `groups.autoAcceptInvitesOnSignIn` is on. It reacts to identity's events,
// which are emitted AFTER the sign-in's writes committed and outside any
// transaction:
//
//   identity.user.created     -> when `autoAcceptInvitesOnSignup`
//   identity.login.succeeded  -> when `autoAcceptInvitesOnSignIn` (every sign-in)
//
// and calls `GroupInvitesService.claimPendingForEmail` / `claimPendingForUser`,
// which does the work: one transaction per invite, each in its invite's
// organization, so a bad invite never blocks the others.
//
// A SIGN-IN NEVER FAILS BECAUSE OF A CLAIM. `EventEmitter2` does not await an
// async listener, so this one is `async` and catches everything: a failure is
// logged (user id and message, never an address) and counted on the span. The
// work is bounded (one indexed lookup plus at most 200 small transactions), so
// it is not a queue job; an invite that did not apply stays pending and the
// invitee can still accept it from `GET /api/groups/invites/mine`.
//
// The identity slice is not imported (the sharing slice depends on `core`,
// `doctor` and `otel-core` only); the two event names are the contract, pinned
// to identity's `IDENTITY_EVENTS` by a unit test.
// =============================================================================

import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { SHARING_OPTIONS, type ResolvedSharingModuleOptions } from '../sharing.options';
import { GroupInvitesService } from './group-invites.service';

/** `IDENTITY_EVENTS.USER_CREATED`, spelled here so the slice imports no identity internals. */
export const IDENTITY_USER_CREATED_EVENT = 'identity.user.created';
/** `IDENTITY_EVENTS.LOGIN_SUCCEEDED`. */
export const IDENTITY_LOGIN_SUCCEEDED_EVENT = 'identity.login.succeeded';

/**
 * Claims a user's pending group invites when identity reports a sign-up or a
 * sign-in. Never throws.
 *
 * @stability experimental
 */
@Injectable()
export class InviteAutoAcceptListener {
  private readonly logger = new Logger('InviteAutoAcceptListener');

  constructor(
    private readonly invites: GroupInvitesService,
    @Inject(SHARING_OPTIONS) private readonly options: ResolvedSharingModuleOptions,
  ) {}

  /**
   * `identity.user.created`.
   *
   * @param event - the new user's id and e-mail address (verified by the provider).
   */
  @OnEvent(IDENTITY_USER_CREATED_EVENT)
  async onUserCreated(event: { userId: string; email: string }): Promise<void> {
    if (!this.options.groups.autoAcceptInvitesOnSignup) return;
    await this.run(event.userId, event.email);
  }

  /**
   * `identity.login.succeeded`.
   *
   * @param event - the signed-in user's id (the event carries no address).
   */
  @OnEvent(IDENTITY_LOGIN_SUCCEEDED_EVENT)
  async onLoginSucceeded(event: { userId: string }): Promise<void> {
    if (!this.options.groups.autoAcceptInvitesOnSignIn) return;
    await this.run(event.userId, null);
  }

  private async run(userId: string, email: string | null): Promise<void> {
    try {
      const result = email === null ? await this.invites.claimPendingForUser(userId) : await this.invites.claimPendingForEmail(userId, email);
      if (result.joined.length + result.upgraded.length > 0) {
        this.logger.log(`User ${userId} auto-accepted group invites: joined ${result.joined.length}, upgraded ${result.upgraded.length}`);
      }
    } catch (error) {
      this.logger.warn(`Auto-accepting group invites for user ${userId} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
