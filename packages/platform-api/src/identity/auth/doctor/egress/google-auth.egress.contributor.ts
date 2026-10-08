import { Injectable, OnModuleInit } from '@nestjs/common';

import {
  EgressContributor,
  EgressDependency,
  EgressRegistry,
  egressDependency,
} from '../../../../doctor/index';

import { AuthService } from '../../auth.service';

/** Where the browser signs in, and where the API exchanges the code and reads the profile. */
export const GOOGLE_OAUTH_HOSTS = ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com'] as const;

/** Where a Google profile picture is served from (the browser loads it). */
export const GOOGLE_AVATAR_HOSTS = ['lh3.googleusercontent.com'] as const;

/**
 * `auth.google` and `auth.google.avatars` (#773): Google sign-in's outbound
 * dependencies.
 *
 * Reads `AuthService.getEnabledProviders()`, the same list the sign-in page
 * renders (configuration only: whether the client id and secret are set, never
 * their values). Google is `required` when it is the only enabled provider:
 * then nobody can sign in without reaching it.
 */
@Injectable()
export class GoogleAuthEgressContributor implements EgressContributor, OnModuleInit {
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
    const google = enabled.some((p) => p.name === 'google');
    const onlyProvider = google && enabled.length === 1;

    return [
      egressDependency({
        id: 'auth.google',
        capability: 'Google sign-in',
        direction: 'both',
        enabled: google,
        required: onlyProvider,
        hosts: [...GOOGLE_OAUTH_HOSTS],
        degradation: onlyProvider
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
  }
}
