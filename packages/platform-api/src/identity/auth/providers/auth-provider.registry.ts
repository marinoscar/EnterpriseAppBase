// =============================================================================
// The sign-in provider registry (issue #727, PP-6.6; completed by PP-14.9)
// =============================================================================
//
// Rung 2 of the extension contract. Google is the first registered provider
// (./google.provider.ts, registered when this slice loads). An app adds one
// with `registerAuthProvider(...)` BEFORE `IdentityModule.forRoot()` runs, and
// the registration is enough to complete a sign-in:
//
//   - `GET /api/auth/providers` lists, in registration order, every provider
//     whose `isEnabled` says it is configured (it may be asynchronous and read
//     the credential store);
//   - for a `redirect` provider the slice mounts `GET /api/auth/:id` (starts
//     the sign-in) and `GET /api/auth/:id/callback` (maps the strategy's raw
//     profile with `mapProfile`, calls `AuthService.completeExternalLogin`,
//     sets the refresh cookie and redirects, exactly as Google's callback);
//   - a `custom` provider (a popup, a native SDK, a SAML POST) mounts no
//     routes: the app's own controller maps its profile, calls
//     `AuthService.completeExternalLogin` and answers with
//     `respondToSignIn` / `setRefreshTokenCookie` from this slice;
//   - the Doctor's `auth.providers` check and the egress inventory read the
//     definition (`label`, `egressHosts`, `doctorRemedy`).
//
// TWO WAYS TO SUPPLY THE PASSPORT STRATEGY
//
//   - `strategy` + `guard` (classes): provided by `IdentityModule.forRoot()` and
//     constructed by Nest at boot with injected configuration. Google uses this
//     and is unchanged.
//   - `createStrategy(ctx)`: built lazily, on each sign-in request, so a secret
//     an administrator stores or rotates at run time is picked up without a
//     restart. Secrets come from `ctx.credentials` (purpose `auth_<id>`), never
//     from an environment variable.
//
// Frozen when the application has bootstrapped (`RegistryFreezeService`).
// =============================================================================

import type { CanActivate, Type } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Strategy as PassportStrategyInstance } from 'passport';

import { defineRegistry, type Registry } from '../../../core/index';
import type { ExternalProfile } from '../external-profile';

/**
 * How a provider signs a person in.
 *
 * - `redirect` (default): the slice mounts the sign-in and callback routes.
 * - `custom`: the provider owns its flow; the slice mounts nothing and the
 *   login page asks the web provider look (`registerAuthProvider` of
 *   `@marinoscar/platform-web/identity/headless`) to start it.
 *
 * @stability experimental
 */
export type AuthProviderMode = 'redirect' | 'custom';

/**
 * Where a provider reads the secrets it was configured with: the deployment's
 * encrypted credential store, seen through the one method identity needs.
 * `CredentialsService` of `@marinoscar/platform-api/credentials` satisfies it.
 *
 * @stability experimental
 */
export interface AuthProviderCredentials {
  /**
   * The plaintext secret at `(purpose, name)`, or `null` when none is stored.
   * Call it at the moment of use and let the value go out of scope; never log
   * it and never cache it.
   *
   * @param purpose - the credential purpose, `auth_<id>` by convention ({@link authCredentialPurpose}).
   * @param name - the secret's name within the purpose (`client_secret`).
   */
  getSecret(purpose: string, name: string): Promise<string | null>;
}

/**
 * What a provider's `isEnabled` and `createStrategy` receive.
 *
 * @stability experimental
 */
export interface AuthProviderContext {
  /** The app's configuration (deployment defaults, for example Google's `GOOGLE_*`). */
  readonly config: ConfigService;
  /**
   * The credential store; resolves every secret to `null` when the app bound no
   * `IDENTITY_AUTH_CREDENTIALS`, so a credentials-backed provider is then simply off.
   */
  readonly credentials: AuthProviderCredentials;
}

/**
 * The Passport strategy instance a provider builds: anything with
 * `authenticate(req, options?)` (a `passport-oauth2`, `passport-openid` or
 * custom strategy).
 *
 * @stability experimental
 */
export type AuthProviderStrategy = PassportStrategyInstance;

/**
 * One sign-in provider.
 *
 * @example
 * ```ts
 * registerAuthProvider({
 *   id: 'github',
 *   label: 'GitHub',
 *   async isEnabled(_config, { credentials }) {
 *     return Boolean(await credentials.getSecret(authCredentialPurpose('github'), 'client_secret'));
 *   },
 *   async createStrategy({ config, credentials }) {
 *     const secret = await credentials.getSecret(authCredentialPurpose('github'), 'client_secret');
 *     return new GithubStrategy({
 *       clientID: config.get('github.clientId'), clientSecret: secret!, callbackURL,
 *       // `state: true` alone throws here (no session plugin): bring a store.
 *       store: createCookieStateStore({ secret: config.get('jwt.secret')! }),
 *     }, verify);
 *   },
 *   mapProfile: (raw) => toExternalProfile('github', raw),
 *   egressHosts: ['github.com', 'api.github.com'],
 *   doctorRemedy: 'Store the GitHub OAuth app secret under the credential purpose auth_github.',
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export interface AuthProviderDefinition {
  /** The provider id, as `GET /api/auth/providers` lists it (`google`). Lower-case; also the route segment and `UserIdentity.provider`. */
  readonly id: string;
  /** A human name for the Doctor and the egress view (`GitHub`). Default the id. */
  readonly label?: string;
  /**
   * How the provider signs a person in. Default `redirect`.
   *
   * @defaultValue `'redirect'`
   */
  readonly mode?: AuthProviderMode;
  /** The Passport strategy CLASS; provided by `IdentityModule.forRoot()` (Google). Alternative to {@link createStrategy}. */
  readonly strategy?: Type<unknown>;
  /** The guard CLASS its sign-in routes use (`GoogleOAuthGuard`). Required with {@link strategy}. */
  readonly guard?: Type<CanActivate>;
  /**
   * Builds the Passport strategy for ONE sign-in request, reading its secrets
   * through `ctx.credentials`. Called on every `GET /api/auth/:id` and
   * `/callback`; the result is registered with Passport under
   * `authProviderStrategyName(id)`.
   *
   * LOGIN CSRF IS YOURS TO PREVENT. The slice adds no `state` and no PKCE. For a
   * `passport-oauth2` strategy, `state: true` or `pkce: true` WITHOUT a `store`
   * uses the session store and throws "requires session support" on every
   * sign-in, because this Fastify app registers no session plugin. Pass your own
   * `store` instead: {@link createCookieStateStore} is a signed, short-lived
   * HttpOnly cookie store that works here.
   *
   * @param ctx - configuration and the credential store.
   */
  createStrategy?(ctx: AuthProviderContext): AuthProviderStrategy | Promise<AuthProviderStrategy>;
  /**
   * Whether the provider is configured, read on every `GET /api/auth/providers`
   * and before every sign-in request. May be asynchronous (a credential lookup).
   * A throw counts as "not enabled".
   *
   * `config` stays the first argument so a registration written before
   * `AuthProviderContext` existed (`isEnabled: (config) => ...`) is unchanged.
   *
   * @param config - the app's configuration.
   * @param ctx - configuration and the credential store.
   */
  isEnabled(config: ConfigService, ctx: AuthProviderContext): boolean | Promise<boolean>;
  /**
   * Maps what the strategy's verify callback returned (`req.user`) to the
   * provider-neutral profile. Required for the generic callback route; the
   * returned `provider` is ignored (the definition's `id` is used). Must not
   * throw for a missing optional field. Never log `raw`.
   *
   * @param raw - the strategy's result.
   */
  mapProfile?(raw: unknown): ExternalProfile;
  /**
   * Whether this provider is TRUSTED TO VOUCH FOR THE EMAIL ADDRESS. It gates
   * two things, both keyed by the address:
   *
   * - linking: a verified address may link this provider's identity to an
   *   EXISTING user with the same address (otherwise that sign-in is refused,
   *   `access_denied`, rather than silently merged);
   * - the `INITIAL_ADMIN_EMAIL` bootstrap: only a trusted provider may use that
   *   address to bypass the allowlist and become the first administrator. Any
   *   other provider is allowlist-only and is never made an administrator.
   *
   * Set `true` ONLY for a provider whose verified-email claim an attacker
   * cannot choose (Google). Never for a multi-tenant issuer where a tenant
   * admin or user sets the address (Entra's `email` claim, a shared OIDC issuer).
   *
   * @defaultValue `false`
   */
  readonly linkExistingByEmail?: boolean;
  /** Hosts the provider needs (sign-in, token exchange, profile), for the egress inventory. */
  readonly egressHosts?: readonly string[];
  /** One sentence telling an operator how to configure the provider; the Doctor shows it while the provider is off. */
  readonly doctorRemedy?: string;
}

/**
 * The registration shape before `AuthProviderDefinition` was widened; the same
 * type. Kept so existing `registerAuthProvider({ id, strategy, guard, isEnabled })`
 * calls and imports compile unchanged.
 *
 * @stability experimental
 */
export type AuthProviderRegistration = AuthProviderDefinition;

/**
 * Passport strategy names that already exist in the process (the JWT strategy
 * `JwtAuthGuard` authenticates with, Passport's built-in `session`). A provider
 * may not take one as its id: Passport's registry is process-global.
 */
const RESERVED_PROVIDER_IDS: ReadonlySet<string> = new Set(['jwt', 'session']);

/**
 * The name a `createStrategy` provider's strategy is registered under in
 * Passport (`auth-provider:<id>`), so no provider id can collide with another
 * strategy's name.
 *
 * @param providerId - the provider id.
 * @returns the Passport strategy name.
 *
 * @stability experimental
 */
export function authProviderStrategyName(providerId: string): string {
  return `auth-provider:${providerId}`;
}

/**
 * The credential purpose a provider's secrets use by convention (`auth_<id>`).
 * The provider's owner registers it with `registerCredentialPurpose` (tier
 * `system`); identity does not register it, because the credentials slice is
 * optional for an app.
 *
 * @param providerId - the provider id.
 * @returns `auth_<id>`.
 *
 * @stability experimental
 */
export function authCredentialPurpose(providerId: string): string {
  return `auth_${providerId}`;
}

/**
 * Every registered sign-in provider, in registration order.
 *
 * @stability experimental
 */
export const authProviderRegistry: Registry<AuthProviderDefinition> = defineRegistry<AuthProviderDefinition>({
  name: 'identity.auth-providers',
  idOf: (provider) => provider.id,
  idPattern: /^[a-z][a-z0-9-]{0,31}$/,
  validate: (provider) => {
    if (RESERVED_PROVIDER_IDS.has(provider.id)) {
      throw new Error(`auth provider "${provider.id}": the id is reserved (it names an existing Passport strategy)`);
    }
    if (typeof provider.isEnabled !== 'function') throw new Error(`auth provider "${provider.id}": isEnabled must be a function`);
    if (provider.mode !== undefined && provider.mode !== 'redirect' && provider.mode !== 'custom') {
      throw new Error(`auth provider "${provider.id}": mode must be "redirect" or "custom"`);
    }
    if (provider.mapProfile !== undefined && typeof provider.mapProfile !== 'function') {
      throw new Error(`auth provider "${provider.id}": mapProfile must be a function`);
    }
    if (provider.egressHosts !== undefined && !Array.isArray(provider.egressHosts)) {
      throw new Error(`auth provider "${provider.id}": egressHosts must be an array of host names`);
    }
    if ((provider.mode ?? 'redirect') === 'custom') return;
    const classBased = provider.strategy !== undefined || provider.guard !== undefined;
    if (classBased) {
      if (typeof provider.strategy !== 'function') throw new Error(`auth provider "${provider.id}": strategy must be a class`);
      if (typeof provider.guard !== 'function') throw new Error(`auth provider "${provider.id}": guard must be a class`);
    } else if (typeof provider.createStrategy !== 'function') {
      throw new Error(
        `auth provider "${provider.id}": a redirect provider needs a strategy class with a guard class, or createStrategy`,
      );
    }
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
export function registerAuthProvider(provider: AuthProviderDefinition): void {
  authProviderRegistry.register(provider);
}
