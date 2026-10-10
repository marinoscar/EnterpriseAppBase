// =============================================================================
// Sign-in provider conformance kit (PP-14.9)
// =============================================================================
//
// ONE suite every sign-in provider runs, so "implements the provider contract"
// means the same thing for Google and for an app's GitHub, Entra or OIDC:
//
//   import { describeAuthProviderConformance } from '@marinoscar/platform-api/identity/testing';
//
//   describeAuthProviderConformance(definition, {
//     describe, it, expect,
//     rawProfile: { sub: 'u-1', email: 'a@b.test', email_verified: true },
//     expectedSubject: 'u-1',
//     enabledWith: { credentials: { client_secret: 'not-a-real-secret' } },
//     host: { completeLogin, hasIdentity, withAllowlist, withPolicy, routeIsMounted },
//   });
//
// It is runner-agnostic like the other kits: it receives `describe`, `it` and
// `expect`, so Jest and Vitest both work and the package imports no test
// framework. Nothing here needs a network: the definition's strategy is only
// BUILT, never run.
//
// WHAT IT CHECKS
//
//   - the definition: a valid id, a `mapProfile`, and (for a redirect provider)
//     a strategy source;
//   - `mapProfile` returns a valid `ExternalProfile` for the fixture, with the
//     expected subject, and does not throw when every optional field is missing;
//   - `isEnabled` is FALSE with no configuration and no credentials, and TRUE
//     with `enabledWith`;
//   - `createStrategy` (when defined) builds a strategy with credentials;
//   - the sign-in routes are mounted for a redirect provider (host-supplied);
//   - a full login through `completeExternalLogin` creates a `UserIdentity`
//     with this provider id and the fixture's subject (host-supplied);
//   - the allowlist still applies, an unverified address is refused, and a
//     `SignInPolicy` denial returns its reason (host-supplied).
//
// The host-supplied scenarios run only when `host` is given; each carries the
// refusal it expects as the `reason` of an `AuthLoginDeniedException` (matched
// by shape, so two copies of the package agree).
// =============================================================================

import type { ConfigService } from '@nestjs/config';

import type { AuthLoginDeniedReason } from '../auth/auth-error-codes';
import { externalProfileProblem, type ExternalProfile } from '../auth/external-profile';
import {
  authCredentialPurpose,
  type AuthProviderContext,
  type AuthProviderDefinition,
} from '../auth/providers/auth-provider.registry';
import type { SignInPolicy } from '../auth/sign-in-policy';

/**
 * The test runner's own globals, passed in.
 *
 * @stability experimental
 */
export interface AuthProviderConformanceHarness {
  /** The runner's `describe`. */
  describe: (name: string, fn: () => void) => unknown;
  /** The runner's `it`. Every case body the kit passes is an asynchronous function. */
  it: (name: string, fn: () => Promise<void>) => unknown;
  /** The runner's `expect`. */
  expect: (actual: unknown) => any;
}

/**
 * The running identity slice the kit drives for the scenarios that need one:
 * a real or mocked `AuthService`, its database and its allowlist.
 *
 * @stability experimental
 */
export interface AuthProviderConformanceHost {
  /**
   * `AuthService.completeExternalLogin(profile)`. Resolves when the sign-in
   * succeeded; rejects with the refusal otherwise. The host admits the
   * fixture's address by default (the kit never edits the allowlist itself).
   */
  completeLogin(profile: ExternalProfile): Promise<unknown>;
  /** Whether a `user_identities` row exists for `(provider, subject)`. */
  hasIdentity(provider: string, subject: string): Promise<boolean>;
  /**
   * Runs `fn` with the allowlist ADMITTING (`true`) or REFUSING (`false`) the
   * fixture's address, then restores it.
   */
  withAllowlist?(allowed: boolean, fn: () => Promise<void>): Promise<void>;
  /** Runs `fn` with `policy` bound as the sign-in policy, then unbinds it. */
  withPolicy?(policy: SignInPolicy, fn: () => Promise<void>): Promise<void>;
  /** Whether the sign-in route `GET /api/auth/<id>` is mounted (not a 404). */
  routeIsMounted?(providerId: string): Promise<boolean>;
}

/**
 * One scenario of the kit; each is skippable by name.
 *
 * @stability experimental
 */
export type AuthProviderConformanceScenario =
  | 'definition'
  | 'mapProfile'
  | 'sparseProfile'
  | 'disabledWithoutCredentials'
  | 'enabledWithCredentials'
  | 'strategyBuilds'
  | 'routesMounted'
  | 'login'
  | 'allowlist'
  | 'unverifiedEmail'
  | 'policyDeny';

/**
 * What {@link describeAuthProviderConformance} takes.
 *
 * @stability experimental
 */
export interface AuthProviderConformanceOptions extends AuthProviderConformanceHarness {
  /** What the provider's strategy returns for a normal account (the input of `mapProfile`). */
  rawProfile: unknown;
  /** The subject `mapProfile` must produce for {@link rawProfile}. */
  expectedSubject: string;
  /** The address `mapProfile` must produce, when you want it pinned. */
  expectedEmail?: string | null;
  /** The same account with every optional field missing; `mapProfile` must not throw on it. Default: `rawProfile` minus nothing. */
  sparseRawProfile?: unknown;
  /**
   * What makes the provider configured: extra configuration keys and the
   * secrets in the credential store (name and value, under the provider's
   * credential purpose). Without it the enabled scenarios are skipped.
   */
  enabledWith?: {
    /** `ConfigService.get` answers, by key. */
    config?: Readonly<Record<string, unknown>>;
    /** Secrets by name, under the purpose `auth_<id>` (`authCredentialPurpose(id)`). */
    credentials?: Readonly<Record<string, string>>;
  };
  /** The running slice, for the login, allowlist, policy and route scenarios. */
  host?: AuthProviderConformanceHost;
  /** Scenarios to skip, each with a reason in a comment at the call site. */
  skip?: readonly AuthProviderConformanceScenario[];
}

function fakeContext(
  values: Readonly<Record<string, unknown>>,
  secrets: Readonly<Record<string, string>>,
  purpose: string,
): AuthProviderContext {
  const config = {
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
  } as unknown as ConfigService;
  return {
    config,
    credentials: {
      getSecret: async (askedPurpose, name) => (askedPurpose === purpose && name in secrets ? (secrets[name] ?? null) : null),
    },
  };
}

function refusalReason(error: unknown): string | null {
  const reason = (error as { reason?: unknown } | null)?.reason;
  return typeof reason === 'string' ? reason : null;
}

async function refusal(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return refusalReason(error) ?? `unexpected:${error instanceof Error ? error.name : typeof error}`;
  }
}

/**
 * Runs the sign-in provider conformance kit against one definition.
 *
 * @param definition - the provider, as registered (`registerAuthProvider`).
 * @param options - the runner's globals, the fixtures and, optionally, the host.
 *
 * @example
 * ```ts
 * describeAuthProviderConformance(exampleOidcProvider, {
 *   describe, it, expect,
 *   rawProfile: { sub: 'oidc-1', email: 'person@example.test', email_verified: true },
 *   expectedSubject: 'oidc-1',
 *   enabledWith: { credentials: { signing_key: 'test-signing-key' } },
 *   host,
 * });
 * ```
 *
 * @extensionPoint kit
 * @stability experimental
 */
export function describeAuthProviderConformance(
  definition: AuthProviderDefinition,
  options: AuthProviderConformanceOptions,
): void {
  const { describe, it, expect, host } = options;
  const skipped = new Set(options.skip ?? []);
  const purpose = authCredentialPurpose(definition.id);
  const run = (scenario: AuthProviderConformanceScenario, name: string, fn: () => Promise<void>): void => {
    if (!skipped.has(scenario)) it(name, fn);
  };
  const mapped = (): ExternalProfile => {
    if (!definition.mapProfile) throw new Error(`auth provider "${definition.id}" has no mapProfile`);
    // The id is the serving definition's, as the generic callback sets it.
    return { ...definition.mapProfile(options.rawProfile), provider: definition.id };
  };
  const emptyContext = fakeContext({}, {}, purpose);
  const enabledContext = options.enabledWith
    ? fakeContext(options.enabledWith.config ?? {}, options.enabledWith.credentials ?? {}, purpose)
    : null;

  describe(`auth provider "${definition.id}" (conformance)`, () => {
    run('definition', 'is a well-formed definition', async () => {
      expect(definition.id).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
      expect(typeof definition.isEnabled).toBe('function');
      expect(typeof definition.mapProfile).toBe('function');
      if ((definition.mode ?? 'redirect') === 'redirect') {
        const classBased = typeof definition.strategy === 'function' && typeof definition.guard === 'function';
        expect(classBased || typeof definition.createStrategy === 'function').toBe(true);
      }
    });

    run('mapProfile', 'maps the fixture to a valid ExternalProfile with the expected subject', async () => {
      const profile = mapped();
      expect(externalProfileProblem(profile)).toBeNull();
      expect(profile.provider).toBe(definition.id);
      expect(profile.subject).toBe(options.expectedSubject);
      if (options.expectedEmail !== undefined) expect(profile.email).toBe(options.expectedEmail);
    });

    run('sparseProfile', 'does not throw when optional fields are missing', async () => {
      const raw = options.sparseRawProfile ?? options.rawProfile;
      const profile = { ...definition.mapProfile!(raw), provider: definition.id };
      expect(externalProfileProblem(profile)).toBeNull();
    });

    run('disabledWithoutCredentials', 'is not enabled with no configuration and no credentials', async () => {
      expect(await definition.isEnabled(emptyContext.config, emptyContext)).toBe(false);
    });

    if (enabledContext) {
      run('enabledWithCredentials', 'is enabled once configured', async () => {
        expect(await definition.isEnabled(enabledContext.config, enabledContext)).toBe(true);
      });

      run('strategyBuilds', 'builds a strategy with credentials', async () => {
        if (!definition.createStrategy) {
          // Class-based registration: Nest builds it with DI at boot; nothing to build here.
          expect(typeof definition.strategy).toBe('function');
          return;
        }
        const strategy = await definition.createStrategy(enabledContext);
        expect(typeof (strategy as { authenticate?: unknown }).authenticate).toBe('function');
      });
    }

    if (host) {
      if ((definition.mode ?? 'redirect') === 'redirect' && host.routeIsMounted) {
        run('routesMounted', 'mounts its sign-in route', async () => {
          expect(await host.routeIsMounted!(definition.id)).toBe(true);
        });
      }

      run('login', 'a full login creates a UserIdentity with this provider and subject', async () => {
        const profile = mapped();
        await host.completeLogin(profile);
        expect(await host.hasIdentity(definition.id, profile.subject)).toBe(true);
      });

      run('unverifiedEmail', 'refuses an address the provider did not verify', async () => {
        const profile: ExternalProfile = { ...mapped(), emailVerified: false };
        expect(await refusal(host.completeLogin(profile))).toBe('access_denied');
      });

      if (host.withAllowlist) {
        run('allowlist', 'still applies the allowlist', async () => {
          const profile = mapped();
          await host.withAllowlist!(false, async () => {
            expect(await refusal(host.completeLogin(profile))).toBe('not_allowlisted');
          });
        });
      }

      if (host.withPolicy) {
        run('policyDeny', 'returns the reason a SignInPolicy denial carries', async () => {
          const reason: AuthLoginDeniedReason = 'access_denied';
          const policy: SignInPolicy = { beforeLogin: () => ({ allow: false, reason }) };
          await host.withPolicy!(policy, async () => {
            expect(await refusal(host.completeLogin(mapped()))).toBe(reason);
          });
        });
      }
    }
  });
}
