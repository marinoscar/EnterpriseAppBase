import { Injectable, OnModuleInit } from '@nestjs/common';

import { DoctorCheck, DoctorCheckOutcome } from '../../../doctor/index';
import { DoctorCheckRegistry } from '../../../doctor/index';
import { AuthService } from '../auth.service';
import { authProviderRegistry } from '../providers/auth-provider.registry';

/** What an operator is told when no registered provider offers a remedy of its own. */
const GENERIC_REMEDY =
  'Configure at least one sign-in provider (for Google: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_CALLBACK_URL, ' +
  'see infra/compose/.env.example) and restart the API.';

/**
 * `auth` / `auth.providers` — at least one sign-in provider is configured, and
 * every registered provider's state (PP-14.9).
 *
 * Asks `AuthService.getEnabledProviders()`, the same list the sign-in page
 * renders, so the doctor cannot disagree with what a user actually sees. Every
 * registered provider is listed in `data` (`provider.<id>`: `enabled` or
 * `not enabled`, and `remedy.<id>` with its `doctorRemedy` while it is off); a
 * provider being off does not lower the status (an optional provider is not a
 * fault). With nothing enabled the check fails and the remedy carries each
 * registered provider's own instruction.
 */
@Injectable()
export class AuthProvidersDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'auth.providers';
  readonly category = 'auth';
  readonly label = 'Sign-in providers';

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly auth: AuthService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    const providers = (await this.auth.getEnabledProviders()).filter((p) => p.enabled);
    const enabledIds = new Set(providers.map((p) => p.name));
    const registered = authProviderRegistry.list();
    const notEnabled = registered.filter((provider) => !enabledIds.has(provider.id));

    const data: Record<string, string | number> = { providers: providers.length };
    for (const provider of registered) {
      data[`provider.${provider.id}`] = enabledIds.has(provider.id) ? 'enabled' : 'not enabled';
      if (!enabledIds.has(provider.id) && provider.doctorRemedy) data[`remedy.${provider.id}`] = provider.doctorRemedy;
    }

    if (providers.length === 0) {
      const remedies = notEnabled.flatMap((p) => (p.doctorRemedy ? [`${p.label ?? p.id}: ${p.doctorRemedy}`] : []));
      return {
        status: 'fail',
        detail: 'No sign-in provider is configured; nobody can sign in',
        remedy: remedies.length > 0 ? remedies.join(' ') : GENERIC_REMEDY,
        data,
      };
    }

    return {
      status: 'pass',
      detail: `Enabled: ${providers.map((p) => p.name).join(', ')}`,
      data,
    };
  }
}
