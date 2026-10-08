import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';

import {
  EgressContributor,
  EgressDependency,
  EgressRegistry,
  egressDependency,
} from '../../../doctor/index';

import { EMAIL_OPTIONS, UNCONFIGURED_EMAIL_OPTIONS, type ResolvedEmailModuleOptions } from '../../email.options';
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
 * non-secret SES region fallback the SES provider itself uses
 * (`EmailModule.forRoot({ sesRegionFallback })`). The SES host
 * is `email.<region>.amazonaws.com`.
 */
@Injectable()
export class EmailEgressContributor implements EgressContributor, OnModuleInit {
  readonly id = 'email';

  constructor(
    private readonly egress: EgressRegistry,
    private readonly emailSettings: EmailSettingsService,
    @Optional() @Inject(EMAIL_OPTIONS) private readonly options?: Pick<ResolvedEmailModuleOptions, 'sesRegionFallback'>,
  ) {}

  onModuleInit(): void {
    this.egress.register(this);
  }

  async describe(): Promise<EgressDependency[]> {
    const view = await this.emailSettings.describeForAdmin();
    const on = view.enabled && view.settingsError === null;
    const region = view.sesRegion || (this.options ?? UNCONFIGURED_EMAIL_OPTIONS).sesRegionFallback() || '';

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
