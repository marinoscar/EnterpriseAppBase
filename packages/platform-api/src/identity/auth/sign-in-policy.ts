// =============================================================================
// The sign-in policy seam (PP-14.9)
// =============================================================================
//
// The allowlist is the platform's only built-in gate on who may sign in. An app
// that needs more (a company domain, a tenant id claim, a provider-specific
// group, a role derived from a claim) binds a `SignInPolicy`:
//
//   IdentityModule.forRoot({ signInPolicy: { useClass: CompanyDomainPolicy } })
//
// WHERE IT RUNS. After the allowlist (and the verified-address rule) and before
// any write: a denial creates, links and updates nothing. It runs for EVERY
// provider, Google included, so a domain rule cannot be bypassed by choosing
// another provider. Without a binding nothing changes: every sign-in the
// allowlist admits is allowed.
//
// WHAT IT CANNOT DO. It cannot widen access: the allowlist, the disabled-account
// check and the tenancy rules still run after it. `INITIAL_ADMIN_EMAIL` bypasses
// the allowlist, not the policy.
// =============================================================================

import type { AuthLoginDeniedReason } from './auth-error-codes';
import type { ExternalProfile } from './external-profile';

/**
 * Injection token of the app's {@link SignInPolicy}. Bind it with
 * `IdentityModule.forRoot({ signInPolicy })`; a provider in the app's own module
 * is invisible to identity's internals. Optional: without it every sign-in the
 * allowlist admits is allowed.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const IDENTITY_SIGNIN_POLICY: unique symbol = Symbol.for('@marinoscar/platform/identity/SIGNIN_POLICY');

/**
 * What the policy knows about the sign-in beyond the profile.
 *
 * @stability experimental
 */
export interface SignInContext {
  /** The existing user this sign-in resolves to (by provider identity, or by a permitted email link), or `null` when a user would be created. */
  readonly existingUserId: string | null;
  /** True when the address is `INITIAL_ADMIN_EMAIL` (the allowlist bypass). */
  readonly isInitialAdmin: boolean;
}

/**
 * An allowing answer: continue. `roles` are applied ONLY when this sign-in
 * creates the user (so an administrator's later role edits stick): a role whose
 * scope is `org` becomes the new membership's role in the default organization
 * (at most one; the initial administrator keeps `org_admin`), a role whose scope
 * is `system` is added to the user's system roles. An unknown role name fails
 * the sign-in closed (`authentication_failed`) before anything is written.
 *
 * Map roles only from claims the provider vouches for; a role granted from an
 * unverified field is a privilege escalation.
 *
 * @stability experimental
 */
export interface SignInAllow {
  /** Always `true`. */
  readonly allow: true;
  /** Role names to apply to a user this sign-in creates. */
  readonly roles?: readonly string[];
}

/**
 * A refusing answer: the redirect carries only the closed code, never text.
 *
 * @stability experimental
 */
export interface SignInDeny {
  /** Always `false`. */
  readonly allow: false;
  /** One of the closed login-denied reasons. */
  readonly reason: AuthLoginDeniedReason;
}

/**
 * A policy's answer: {@link SignInAllow} or {@link SignInDeny}.
 *
 * @stability experimental
 */
export type SignInDecision = SignInAllow | SignInDeny;

/**
 * The app's sign-in policy.
 *
 * @example
 * ```ts
 * class CompanyDomainPolicy implements SignInPolicy {
 *   async beforeLogin(profile: ExternalProfile): Promise<SignInDecision> {
 *     return profile.email?.endsWith('@acme.example')
 *       ? { allow: true }
 *       : { allow: false, reason: 'access_denied' };
 *   }
 * }
 * ```
 *
 * @extensionPoint port
 * @stability experimental
 */
export interface SignInPolicy {
  /**
   * Decides one sign-in. A throw refuses the sign-in as `authentication_failed`
   * (fail closed).
   *
   * @param profile - the provider's profile (never log `raw`).
   * @param ctx - the existing user, if any, and the initial-admin flag.
   */
  beforeLogin(profile: ExternalProfile, ctx: SignInContext): Promise<SignInDecision> | SignInDecision;
}
