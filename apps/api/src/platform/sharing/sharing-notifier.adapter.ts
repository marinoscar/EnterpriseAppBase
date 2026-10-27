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
import type { SharingNotifier, SharingNotifyHint } from '@marinoscar/platform-api/sharing';

import { NotificationsService } from '@marinoscar/platform-api/notifications';
import { SettingsResolver } from '@marinoscar/platform-api/settings';

@Injectable()
export class SharingNotifierAdapter implements SharingNotifier {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly settings: SettingsResolver,
  ) {}

  /**
   * The acting user's zone as a render hint: the sharing slice cannot read
   * settings, so the app resolves it. Used only when the recipient has no zone
   * of their own (no account, or on "Automatic"); UTC (labelled) otherwise.
   */
  private async zoneHint(hint?: SharingNotifyHint): Promise<{ timeZone: string } | undefined> {
    if (!hint?.actorUserId) return undefined;
    try {
      const timeZone = await this.settings.resolveUserTimeZone(hint.actorUserId);
      return timeZone ? { timeZone } : undefined;
    } catch {
      return undefined;
    }
  }

  private withSignInUrl(data: unknown): unknown {
    const appUrl = this.config.get<string>('appUrl');
    if (!appUrl || data === null || typeof data !== 'object') return data;
    const base = appUrl.replace(/\/+$/, '');
    const fields = data as Record<string, unknown>;
    // A share notification (#729) links to the record when its type gives a
    // root-relative path, otherwise to the sign-in page.
    const path = typeof fields.path === 'string' && fields.path.startsWith('/') && !fields.path.startsWith('//') ? fields.path : null;
    return { ...fields, signInUrl: `${base}/login`, ...(path ? { openUrl: `${base}${path}` } : {}) };
  }

  async notify(eventKey: string, userId: string, data: unknown, hint?: SharingNotifyHint): Promise<void> {
    return this.notifications.notify(eventKey, userId, this.withSignInUrl(data), await this.zoneHint(hint));
  }

  async notifyAddress(eventKey: string, email: string, data: unknown, hint?: SharingNotifyHint): Promise<void> {
    return this.notifications.notifyAddress(eventKey, email, this.withSignInUrl(data), await this.zoneHint(hint));
  }
}
