import { Injectable } from '@nestjs/common';
import type {
  AllowlistInvitationNotice,
  IdentityNotifier,
  OrgInvitationNotice,
  RoleChangedNotice,
  UserWelcomeNotice,
} from '@marinoscar/platform-api/identity';

import type {
  AllowlistInvitationEmailData,
  RoleChangedEmailData,
  UserWelcomeEmailData,
} from '@marinoscar/platform-api/email';

import type { OrgInvitationEmailData } from '../email/templates';
import { NotificationsService } from '../../notifications/notifications.service';

// =============================================================================
// IDENTITY_NOTIFIER -> the app's notification dispatcher (issue #727)
// =============================================================================
//
// Identity raises its four notifications through this port, so the identity
// package never imports the notifications slice (identity sits under every
// other slice). Each method is one `notify` / `notifyAddress` call with the
// event key and the payload identity always sent; the events themselves are
// declared in `src/identity-extensions/notifications/` and registered by the
// notification manifest, exactly as before the move.
//
// Called after the triggering write committed and outside any transaction;
// `notify` never rejects (delivery failures are recorded by the dispatcher).
// =============================================================================

/** Compile-time proof that each notice IS the email template's data, unchanged. */
type AssertAssignable<_From extends _To, _To> = true;
export type IdentityNoticesAreEmailData = [
  AssertAssignable<RoleChangedNotice, RoleChangedEmailData>,
  AssertAssignable<UserWelcomeNotice, UserWelcomeEmailData>,
  AssertAssignable<AllowlistInvitationNotice, AllowlistInvitationEmailData>,
  AssertAssignable<OrgInvitationNotice, OrgInvitationEmailData>,
];

/** The reference app's {@link IdentityNotifier}: the notification dispatcher. */
@Injectable()
export class NotificationsIdentityNotifier implements IdentityNotifier {
  constructor(private readonly notifications: NotificationsService) {}

  async roleChanged(userId: string, notice: RoleChangedNotice): Promise<void> {
    await this.notifications.notify('security.role_changed', userId, notice);
  }

  async userWelcomed(userId: string, notice: UserWelcomeNotice): Promise<void> {
    await this.notifications.notify('user.welcome', userId, notice);
  }

  async allowlistInvitation(email: string, notice: AllowlistInvitationNotice): Promise<void> {
    await this.notifications.notifyAddress('allowlist.invitation', email, notice);
  }

  async orgInvitation(email: string, notice: OrgInvitationNotice): Promise<void> {
    await this.notifications.notifyAddress('org.invitation', email, notice);
  }
}
