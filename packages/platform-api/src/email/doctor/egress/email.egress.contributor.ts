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
import { parsedTransportSettings } from '../../email-settings-compat';
import { emailTransportDefinitions } from '../../transports/email-transport';
// The built-in transports register on import: they are listed like any other.
import '../../transports/builtin-email-transports';

const DEGRADATION = 'No email is sent: invitations, notifications by email and the weekly digest stop';

/**
 * `email.<transport id>` (#773): where outgoing mail goes. Every REGISTERED
 * transport is listed (`email.smtp`, `email.ses`, and the ones an app added);
 * the one the settings select is enabled (when email is switched on and the
 * stored row is valid). A transport names its capability
 * (`egressCapability`, default `Email (<label>)`) and its hosts
 * (`egressHosts`; none for a local transport).
 *
 * Reads `EmailSettingsService.describeForAdmin()`, the masked admin view (no
 * secret is known there but as "set"), and the non-secret SES region fallback
 * the SES transport itself uses (`EmailModule.forRoot({ sesRegionFallback })`).
 *
 * @stability experimental
 */
@Injectable()
export class EmailEgressContributor implements EgressContributor, OnModuleInit {
  readonly id = 'email';

  constructor(
    private readonly egress: EgressRegistry,
    private readonly emailSettings: EmailSettingsService,
    @Optional() @Inject(EMAIL_OPTIONS) private readonly options?: Pick<ResolvedEmailModuleOptions, 'sesRegionFallback'>,
  ) {}

  /** Registers this contributor with the doctor's registry. */
  onModuleInit(): void {
    this.egress.register(this);
  }

  async describe(): Promise<EgressDependency[]> {
    const view = await this.emailSettings.describeForAdmin();
    const on = view.enabled && view.settingsError === null;

    const options = this.options ?? UNCONFIGURED_EMAIL_OPTIONS;

    return emailTransportDefinitions().map((transport) =>
      egressDependency({
        id: `email.${transport.id}`,
        capability: transport.egressCapability ?? `Email (${transport.label})`,
        direction: 'server',
        enabled: on && view.provider === transport.id,
        required: false,
        hosts: [...(transport.egressHosts?.(parsedTransportSettings(view, transport.id), { sesRegionFallback: options.sesRegionFallback }) ?? [])],
        degradation: DEGRADATION,
        settingsPath: EMAIL_SETTINGS_PATH,
      }),
    );
  }
}
