// =============================================================================
// The provider-neutral sign-in profile (PP-14.9)
// =============================================================================
//
// What a sign-in provider hands to `AuthService.completeExternalLogin`: who the
// provider says the person is, in one shape for every provider. Google's own
// `GoogleProfile` is mapped onto it by `AuthService.handleGoogleLogin`.
//
// THE PROVIDER ID IS NOT TRUSTED FROM A STRATEGY. The generic callback route
// (`AuthProviderController`) overwrites `provider` with the id of the
// definition that served the request, so a strategy cannot present itself as
// another provider and collide with its `(provider, subject)` identities.
// =============================================================================

import type { GoogleProfile } from './strategies/google.strategy';

/**
 * One person as a sign-in provider describes them: provider-neutral.
 *
 * `email` and `emailVerified` carry the security weight: identity uses the
 * address for the allowlist, the initial-administrator bootstrap and (only
 * when the provider declares it, see `AuthProviderDefinition.linkExistingByEmail`)
 * to link the provider identity to an existing user. A provider must therefore
 * set `emailVerified: true` ONLY when the provider itself vouches that the
 * person controls the address. An unverified address is refused at sign-in.
 *
 * @example
 * ```ts
 * const profile: ExternalProfile = {
 *   provider: 'github',
 *   subject: String(raw.id),
 *   email: primary.email,
 *   emailVerified: primary.verified === true,
 *   displayName: raw.name ?? raw.login,
 * };
 * ```
 *
 * @extensionPoint contract
 * @stability experimental
 */
export interface ExternalProfile {
  /** The registered provider id (`github`). Overwritten with the serving definition's id by the generic callback. */
  provider: string;
  /** The stable account id at the provider (never the email, which can change). */
  subject: string;
  /** The account's email, or `null` when the provider has none (the sign-in is then refused). */
  email: string | null;
  /** Whether the provider vouches that the person controls `email`. */
  emailVerified: boolean;
  /** The account's display name, when it has one. */
  displayName?: string;
  /** The account's picture URL, when it has one. */
  pictureUrl?: string;
  /**
   * The provider's own payload, for a `SignInPolicy` that needs a claim
   * (a tenant id, a group). NEVER logged by identity and never persisted.
   */
  raw?: Record<string, unknown>;
}

/** The longest subject identity stores (`user_identities.provider_subject` is text; this bounds hostile input). */
const MAX_SUBJECT_LENGTH = 255;

/** The longest address, per RFC 5321. */
const MAX_EMAIL_LENGTH = 254;

/**
 * Checks that a value is a well-formed {@link ExternalProfile}.
 *
 * @param value - what a provider's `mapProfile` returned.
 * @returns `null` when it is valid, else one sentence naming the problem
 *   (never the offending value, which can be personal data).
 *
 * @stability experimental
 */
export function externalProfileProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'the profile is not an object';
  const p = value as Record<string, unknown>;
  if (typeof p.provider !== 'string' || p.provider === '') return 'provider must be a non-empty string';
  if (typeof p.subject !== 'string' || p.subject.trim() === '') return 'subject must be a non-empty string';
  if (p.subject.length > MAX_SUBJECT_LENGTH) return `subject must be at most ${MAX_SUBJECT_LENGTH} characters`;
  if (p.email !== null && typeof p.email !== 'string') return 'email must be a string or null';
  if (typeof p.email === 'string' && (p.email.trim() === '' || p.email.length > MAX_EMAIL_LENGTH || !p.email.includes('@'))) {
    return 'email must be an address or null';
  }
  if (typeof p.emailVerified !== 'boolean') return 'emailVerified must be a boolean';
  if (p.displayName !== undefined && typeof p.displayName !== 'string') return 'displayName must be a string when present';
  if (p.pictureUrl !== undefined && typeof p.pictureUrl !== 'string') return 'pictureUrl must be a string when present';
  if (p.raw !== undefined && (typeof p.raw !== 'object' || p.raw === null || Array.isArray(p.raw))) {
    return 'raw must be an object when present';
  }
  return null;
}

/**
 * Throws when a value is not a well-formed {@link ExternalProfile}.
 *
 * @param value - what a provider's `mapProfile` returned.
 * @throws Error with {@link externalProfileProblem}'s sentence.
 *
 * @stability experimental
 */
export function assertExternalProfile(value: unknown): asserts value is ExternalProfile {
  const problem = externalProfileProblem(value);
  if (problem) throw new Error(`Invalid ExternalProfile: ${problem}`);
}

/**
 * Maps the profile `GoogleStrategy` produces to the provider-neutral shape.
 * Google's address is treated as verified, as the sign-in always did.
 *
 * @param raw - a {@link GoogleProfile}.
 * @returns the neutral profile.
 *
 * @stability experimental
 */
export function googleProfileToExternal(raw: unknown): ExternalProfile {
  const profile = raw as GoogleProfile;
  return {
    provider: 'google',
    subject: profile.id,
    email: profile.email,
    emailVerified: true,
    displayName: profile.displayName,
    ...(profile.picture ? { pictureUrl: profile.picture } : {}),
  };
}
