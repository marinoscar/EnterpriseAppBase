// The web sign-in provider registry (issue #727, PP-6.6): how a sign-in button
// looks for each provider id the API offers (`GET /api/auth/providers`). The
// API side registers the strategy (`registerAuthProvider` of
// `@marinoscar/platform-api/identity`); this one registers the button. The
// package ships the look of `google`, `microsoft` and `github`; an app
// registers any other provider, or overrides a built-in one, once at start-up.

import type { ComponentType } from 'react';

/**
 * How the login page's button looks for one sign-in provider.
 *
 * @stability experimental
 */
export interface AuthProviderDescriptor {
  /** The provider id, as `GET /api/auth/providers` names it (matched case-insensitively). */
  id: string;
  /** The button text, e.g. `Continue with Google`. */
  label: string;
  /** The button's start icon. */
  Icon?: ComponentType;
  /** The button background. Default the theme's primary blue (`#1976d2`). */
  color?: string;
  /** The button text colour. Default `#ffffff`. */
  textColor?: string;
  /** A CSS border for the button (Google's `1px solid #dadce0`). Default none. */
  border?: string;
}

const registered = new Map<string, AuthProviderDescriptor>();

/**
 * Register the look of a sign-in provider's button. Call it once, at app
 * start-up, before the login page renders. A provider the API does not offer
 * never renders, whatever is registered.
 *
 * @param descriptor - the provider id, label and optional icon and colours.
 * @returns a function that removes the registration (tests).
 * @throws Error when an app registered the same id already.
 *
 * @example
 * ```ts
 * registerAuthProvider({ id: 'oidc', label: 'Continue with SSO', Icon: KeyIcon });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerAuthProvider(descriptor: AuthProviderDescriptor): () => void {
  const id = descriptor.id.toLowerCase();
  if (registered.has(id)) {
    throw new Error(`registerAuthProvider: the sign-in provider "${id}" is already registered.`);
  }
  const entry = Object.freeze({ ...descriptor, id });
  registered.set(id, entry);
  return () => {
    if (registered.get(id) === entry) registered.delete(id);
  };
}

/**
 * The look an app registered for `id` (case-insensitive), or `undefined`; the
 * login button then falls back to the package's built-in look for `google`,
 * `microsoft` and `github`, and to a generic `Continue with <id>` button.
 *
 * @param id - the provider id.
 * @returns the registered descriptor, if any.
 *
 * @stability experimental
 */
export function getRegisteredAuthProvider(id: string): AuthProviderDescriptor | undefined {
  return registered.get(id.toLowerCase());
}

/**
 * Every provider look an app registered, in registration order.
 *
 * @returns the registered descriptors.
 *
 * @stability experimental
 */
export function listRegisteredAuthProviders(): readonly AuthProviderDescriptor[] {
  return [...registered.values()];
}
