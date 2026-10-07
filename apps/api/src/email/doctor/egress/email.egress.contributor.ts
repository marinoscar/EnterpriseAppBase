import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  EgressContributor,
  EgressDependency,
  EgressRegistry,
  egressDependency,
} from '@marinoscar/platform-api/doctor';

import { EmailSettingsService } from '../../email-settings.service';
import { EMAIL_SETTINGS_PATH } from '../email-config.doctor-check';

const DEGRADATION = 'No email is sent: invitations, notifications by email and the weekly digest stop';

/**
 * `email.smtp` and `email.ses` (#773): where outgoing mail goes. Both are
 * listed; the one the settings select is enabled (when email is switched on
 * and the stored row is valid).
 *
 * Reads `EmailSettingsService.describeForAdmin()`, the masked admin view (the
 * SMTP password and the SES secret key are known there only as "set"), and the
 * non-secret `SES_REGION` fallback the SES provider itself uses. The SES host
 * is `email.<region>.amazonaws.com`.
 */
@Injectable()
export class EmailEgressContributor implements EgressContributor, OnModuleInit {
  readonly id = 'email';

  constructor(
    private readonly egress: EgressRegistry,
    private readonly emailSettings: EmailSettingsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.egress.register(this);
  }

  async describe(): Promise<EgressDependency[]> {
    const view = await this.emailSettings.describeForAdmin();
    const on = view.enabled && view.settingsError === null;
    const region = view.sesRegion || this.config.get<string>('email.sesRegionFallback') || '';

    return [
      egressDependency({
        id: 'email.smtp',
        capability: 'Email (SMTP relay)',
        direction: 'server',
        enabled: on && view.provider === 'smtp',
        required: false,
        hosts: [view.smtpHost],
        degradation: DEGRADATION,
        settingsPath: EMAIL_SETTINGS_PATH,
      }),
      egressDependency({
        id: 'email.ses',
        capability: 'Email (Amazon SES)',
        direction: 'server',
        enabled: on && view.provider === 'ses',
        required: false,
        hosts: [region ? `email.${region}.amazonaws.com` : undefined],
        degradation: DEGRADATION,
        settingsPath: EMAIL_SETTINGS_PATH,
      }),
    ];
  }
}
