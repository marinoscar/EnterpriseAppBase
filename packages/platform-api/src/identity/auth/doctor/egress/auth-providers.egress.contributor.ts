import { Injectable, OnModuleInit } from '@nestjs/common';

import {
  EgressContributor,
  EgressDependency,
  EgressRegistry,
  egressDependency,
} from '../../../../doctor/index';

import { AuthService } from '../../auth.service';
import { authProviderRegistry } from '../../providers/auth-provider.registry';

/** Where the browser signs in, and where the API exchanges the code and reads the profile. */
export const GOOGLE_OAUTH_HOSTS = ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com'] as const;

/** Where a Google profile picture is served from (the browser loads it). */
export const GOOGLE_AVATAR_HOSTS = ['lh3.googleusercontent.com'] as const;

/**
 * The sign-in providers' outbound dependencies (#773, PP-14.9):
 *
 * - `auth.google` and `auth.google.avatars`: Google sign-in, exactly as before.
 * - `auth.<id>`: one per other registered provider that declared
 *   `egressHosts` (direction `both`: the browser signs in, the API exchanges
 *   the code).
 *
 * Reads `AuthService.getEnabledProviders()`, the same list the sign-in page
 * renders (configuration only: whether a provider is configured, never a
 * secret). A provider is `required` when it is the only enabled one: then
 * nobody can sign in without reaching it.
 */
@Injectable()
export class AuthProvidersEgressContributor implements EgressContributor, OnModuleInit {
  readonly id = 'auth';

  constructor(
    private readonly egress: EgressRegistry,
    private readonly auth: AuthService,
  ) {}

  onModuleInit(): void {
    this.egress.register(this);
  }

  async describe(): Promise<EgressDependency[]> {
    const enabled = (await this.auth.getEnabledProviders()).filter((p) => p.enabled);
    const enabledIds = new Set(enabled.map((p) => p.name));
    const google = enabledIds.has('google');
    const onlyProvider = (id: string) => enabledIds.has(id) && enabled.length === 1;

    const dependencies: EgressDependency[] = [
      egressDependency({
        id: 'auth.google',
        capability: 'Google sign-in',
        direction: 'both',
        enabled: google,
        required: onlyProvider('google'),
        hosts: [...GOOGLE_OAUTH_HOSTS],
        degradation: onlyProvider('google')
          ? 'Nobody can sign in: Google is the only sign-in provider'
          : 'Signing in with Google fails',
      }),
      egressDependency({
        id: 'auth.google.avatars',
        capability: 'Google profile pictures',
        direction: 'browser',
        enabled: google,
        required: false,
        hosts: [...GOOGLE_AVATAR_HOSTS],
        degradation: 'Profile pictures from Google do not load; initials are shown instead',
      }),
    ];

    for (const provider of authProviderRegistry.list()) {
      if (provider.id === 'google' || !provider.egressHosts || provider.egressHosts.length === 0) continue;
      const label = provider.label ?? provider.id;
      dependencies.push(
        egressDependency({
          id: `auth.${provider.id}`,
          capability: `${label} sign-in`,
          direction: 'both',
          enabled: enabledIds.has(provider.id),
          required: onlyProvider(provider.id),
          hosts: [...provider.egressHosts],
          degradation: onlyProvider(provider.id)
            ? `Nobody can sign in: ${label} is the only sign-in provider`
            : `Signing in with ${label} fails`,
        }),
      );
    }

    return dependencies;
  }
}
