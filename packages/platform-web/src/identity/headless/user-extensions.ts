// =============================================================================
// Reading what the app's user extensions added (PP-14.25)
// =============================================================================
//
// The API merges the app's `registerCurrentUserExtension` contributions into
// `GET /api/auth/me` and its `registerUserListExtension` contributions into each
// row of `GET /api/users`, under `extensions.<id>`. The browser only reads them:
// it never decides anything from them (the API enforces every permission), and
// what an extension returns is untrusted data to render, not markup.
// =============================================================================

import { useOptionalAuth } from './auth-context.js';

/**
 * One extension's contribution to a user payload, or `undefined` when the
 * extension did not contribute (it is not registered, it returned nothing for
 * this user, or the API skipped it).
 *
 * Works on the signed-in user (`useAuth().user`) and on a row of the user list
 * (`UserListItem`) alike.
 *
 * @typeParam T - the contribution's shape. The API sends JSON the extension
 *   chose; the caller states what it expects, and should still tolerate a
 *   missing field.
 * @param holder - a user payload that may carry `extensions`.
 * @param id - the extension id.
 * @returns the contribution, or `undefined`.
 *
 * @example
 * ```tsx
 * { id: 'plan', label: 'Plan', priority: 'secondary', value: (user) => userExtension<{ plan: string }>(user, 'billing')?.plan ?? '' }
 * ```
 *
 * @stability experimental
 */
export function userExtension<T extends object = Record<string, unknown>>(
  holder: { extensions?: Readonly<Record<string, unknown>> | undefined } | null | undefined,
  id: string,
): T | undefined {
  const extensions = holder?.extensions;
  if (!extensions || !Object.prototype.hasOwnProperty.call(extensions, id)) return undefined;
  const value = extensions[id];
  return value !== null && typeof value === 'object' ? (value as T) : undefined;
}

/**
 * The signed-in user's contribution from one current-user extension
 * (`GET /api/auth/me` `extensions.<id>`), or `undefined` when there is none or
 * nobody is signed in. Outside an `AuthProvider` it answers `undefined`.
 *
 * @typeParam T - the contribution's shape.
 * @param id - the extension id.
 * @returns the contribution, or `undefined`.
 *
 * @example
 * ```tsx
 * const billing = useCurrentUserExtension<{ plan: string }>('billing');
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useCurrentUserExtension<T extends object = Record<string, unknown>>(id: string): T | undefined {
  return userExtension<T>(useOptionalAuth()?.user, id);
}
