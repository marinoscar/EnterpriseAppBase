// =============================================================================
// The sign-in provider registry (issue #727, PP-6.6)
// =============================================================================
//
// Rung 2 of the extension contract. Google is the first registered provider
// (./google.provider.ts, registered when this slice loads). An app adds one
// with `registerAuthProvider(...)` BEFORE `IdentityModule.forRoot()` runs:
// `forRoot` provides every registered strategy (so Passport knows it), and
// `GET /api/auth/providers` (`AuthService.getEnabledProviders`) lists, in
// registration order, every provider whose `isEnabled` says it is configured.
//
// A provider's sign-in ROUTES are the app's or the slice's own controller
// methods guarded by its `guard`; the registry does not create routes (the
// generated OpenAPI document never changes because a provider registered).
//
// Frozen when the application has bootstrapped (`RegistryFreezeService`).
// =============================================================================

import type { CanActivate, Type } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { defineRegistry, type Registry } from '../../../core/index';

/**
 * One sign-in provider.
 *
 * @stability experimental
 */
export interface AuthProviderRegistration {
  /** The provider id, as `GET /api/auth/providers` lists it (`google`). Lower-case. */
  readonly id: string;
  /** The Passport strategy class; provided by `IdentityModule.forRoot()`. */
  readonly strategy: Type<unknown>;
  /** The guard its sign-in routes use (`GoogleOAuthGuard`). */
  readonly guard: Type<CanActivate>;
  /**
   * Whether the provider is configured, read on every `GET /api/auth/providers`.
   *
   * @param config - the app's configuration.
   */
  isEnabled(config: ConfigService): boolean;
}

/**
 * Every registered sign-in provider, in registration order.
 *
 * @stability experimental
 */
export const authProviderRegistry: Registry<AuthProviderRegistration> = defineRegistry<AuthProviderRegistration>({
  name: 'identity.auth-providers',
  idOf: (provider) => provider.id,
  idPattern: /^[a-z][a-z0-9-]{0,31}$/,
  validate: (provider) => {
    if (typeof provider.strategy !== 'function') throw new Error(`auth provider "${provider.id}": strategy must be a class`);
    if (typeof provider.guard !== 'function') throw new Error(`auth provider "${provider.id}": guard must be a class`);
    if (typeof provider.isEnabled !== 'function') throw new Error(`auth provider "${provider.id}": isEnabled must be a function`);
  },
});

/**
 * Registers a sign-in provider. Call it at module load, before
 * `IdentityModule.forRoot()`; a duplicate id throws.
 *
 * @param provider - the provider.
 *
 * @example
 * ```ts
 * registerAuthProvider({
 *   id: 'github',
 *   strategy: GithubStrategy,
 *   guard: GithubOAuthGuard,
 *   isEnabled: (config) => Boolean(config.get('github.clientId')),
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerAuthProvider(provider: AuthProviderRegistration): void {
  authProviderRegistry.register(provider);
}
