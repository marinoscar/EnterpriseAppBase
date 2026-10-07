// =============================================================================
// SHARING_NOTIFIER adapter: group invitations through the app's notifications
// (issue #728)
// =============================================================================
//
// A thin pass-through to `NotificationsService` that adds the absolute sign-in
// URL (`APP_URL`) the e-mail's button points at, exactly as the organization
// invitation does. Called by the slice after the invite's transaction
// committed, outside it.
// =============================================================================

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SharingNotifier } from '@marinoscar/platform-api/sharing';

import { NotificationsService } from '../../notifications/notifications.service';

@Injectable()
export class SharingNotifierAdapter implements SharingNotifier {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  private withSignInUrl(data: unknown): unknown {
    const appUrl = this.config.get<string>('appUrl');
    if (!appUrl || data === null || typeof data !== 'object') return data;
    return { ...(data as Record<string, unknown>), signInUrl: `${appUrl.replace(/\/+$/, '')}/login` };
  }

  notify(eventKey: string, userId: string, data: unknown): Promise<void> {
    return this.notifications.notify(eventKey, userId, this.withSignInUrl(data));
  }

  notifyAddress(eventKey: string, email: string, data: unknown): Promise<void> {
    return this.notifications.notifyAddress(eventKey, email, this.withSignInUrl(data));
  }
}
