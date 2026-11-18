// Which sign-in provider started the current sign-in. `login(provider)` writes it
// before leaving for the provider; the callback page reads it so its retry
// buttons restart the same provider (the API's redirect names none). Storage can
// be blocked or empty, so every access is guarded and the value is validated:
// it is spliced into a navigation path.

const LAST_PROVIDER_KEY = 'auth_provider';

/** A provider id as the API registers them (lower-case, hyphens, at most 32 characters). */
const PROVIDER_ID = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * Whether a value is a well-formed provider id (it is spliced into a
 * navigation path, so nothing else is accepted).
 *
 * @param value - a candidate id, for example a route parameter.
 * @returns the id, or `undefined`.
 *
 * @stability experimental
 */
export function validAuthProviderId(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && PROVIDER_ID.test(value) ? value : undefined;
}

/**
 * Remembers the provider a sign-in starts with.
 *
 * @param provider - the provider id.
 *
 * @stability experimental
 */
export function rememberAuthProvider(provider: string): void {
  try {
    sessionStorage.setItem(LAST_PROVIDER_KEY, provider);
  } catch {
    // Storage can be blocked (private window); the retry then defaults to Google.
  }
}

/**
 * The provider the current sign-in started with, when one was remembered and is
 * a well-formed provider id.
 *
 * @returns the provider id, or `undefined`.
 *
 * @stability experimental
 */
export function lastAuthProvider(): string | undefined {
  try {
    return validAuthProviderId(sessionStorage.getItem(LAST_PROVIDER_KEY));
  } catch {
    return undefined;
  }
}
