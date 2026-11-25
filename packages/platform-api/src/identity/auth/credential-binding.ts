// =============================================================================
// Credential binding: the org a request's credential is bound to (#724)
// =============================================================================
//
// Every credential path (session or device JWT, PAT, node) resolves the
// caller to the same user graph (`PRINCIPAL_USER_INCLUDE`). What differs per
// credential is the ORG it is bound to and the credential kind: the access
// token's signed `org` claim, the PAT's or device session's `orgId`, or no org
// at all for a system-scoped node credential. `bindCredential` stamps both on
// a COPY of the graph, so a frozen principal-cache entry is never mutated and
// two requests bound to different orgs never share an object.
//
// The two fields are NON-ENUMERABLE: they are request metadata, not columns of
// the user row, so they never reach a JSON body, a log line that serialises
// the user, or the principal cache's deep copy (which copies own enumerable
// properties only, so a cached entry can never carry one request's binding to
// the next). `toRequestUser`, `PrincipalFactory` and `toPrincipal` read them
// by name.
//
// The bound org is TRUSTED only because the path that stamps it checked it
// first: the claim is signed, and `validateJwtPayload` / `PatService` re-check
// that it is an ACTIVE membership of the user before binding. Never stamp an
// org taken from a header, query or body.
// =============================================================================

import type { CredentialKind, OAuthPrincipalInfo } from '../../core/index';

/**
 * What a credential path binds: the org (`null` for a system-scoped node;
 * `undefined` for a pre-#724 credential with no org, which the principal
 * factory's sign-in rule then resolves) and the credential kind.
 *
 * @internal
 */
export interface CredentialBinding {
  activeOrgId: string | null | undefined;
  tokenKind: CredentialKind;
}

/**
 * A user graph carrying its credential binding.
 *
 * @internal
 */
export type BoundUser<T> = T & { activeOrgId?: string | null; tokenKind: CredentialKind };

/**
 * Stamps `binding` on `target` IN PLACE as non-enumerable `activeOrgId` and
 * `tokenKind` properties, and returns it. For a graph fresh from the
 * database (PAT, node); a cached, frozen graph goes through
 * {@link bindCredential} instead. An `undefined` org is left unset.
 *
 * @internal
 */
export function stampCredential<T extends object>(target: T, binding: CredentialBinding): BoundUser<T> {
  Object.defineProperty(target, 'tokenKind', {
    value: binding.tokenKind,
    enumerable: false,
    writable: false,
    configurable: true,
  });
  if (binding.activeOrgId !== undefined) {
    Object.defineProperty(target, 'activeOrgId', {
      value: binding.activeOrgId,
      enumerable: false,
      writable: false,
      configurable: true,
    });
  }
  return target as BoundUser<T>;
}

/**
 * A shallow copy of `user` carrying `binding` (see {@link stampCredential}).
 * The input is never modified, so a frozen principal-cache entry can be bound.
 *
 * @internal
 */
export function bindCredential<T extends object>(user: T, binding: CredentialBinding): BoundUser<T> {
  return stampCredential({ ...user }, binding);
}

/** The part of a membership the active-org checks read. */
interface MembershipLike {
  orgId: string;
  status: string;
}

/**
 * Whether `orgId` is an ACTIVE membership in the loaded graph. A graph loaded
 * without memberships has none: the check fails closed.
 *
 * @internal
 */
export function hasActiveMembership(
  user: { memberships?: ReadonlyArray<MembershipLike> | null },
  orgId: string,
): boolean {
  return (user.memberships ?? []).some(
    (membership) => membership.orgId === orgId && membership.status === 'active',
  );
}

/**
 * What an `oat_` token narrows a request to: the permissions of its scopes,
 * and the metadata `principal.oauth` and `@OAuthGrant()` expose.
 *
 * @internal
 */
export interface OAuthNarrowing {
  /** The union of the permissions of the token's scopes. The user's effective set is intersected with it. */
  readonly permissions: readonly string[];
  /** The client, grant, resource and scopes (`principal.oauth`). */
  readonly info: OAuthPrincipalInfo;
}

/**
 * Stamps an OAuth narrowing on `target` IN PLACE as a non-enumerable
 * `oauthNarrowing` property and returns it. ONLY for a graph fresh from the
 * database (the OAuth resolver builds one per request): the narrowing belongs
 * to ONE credential, so it must never reach the principal cache, whose
 * entries every credential of the same user shares. Non-enumerable, so a
 * cache copy (own enumerable properties only), a JSON body and a log line
 * never carry it.
 *
 * @internal
 */
export function stampOAuthNarrowing<T extends object>(target: T, narrowing: OAuthNarrowing): T & { oauthNarrowing: OAuthNarrowing } {
  Object.defineProperty(target, 'oauthNarrowing', {
    value: Object.freeze({ permissions: Object.freeze([...narrowing.permissions]), info: Object.freeze({ ...narrowing.info, scopes: Object.freeze([...narrowing.info.scopes]) }) }),
    enumerable: false,
    writable: false,
    configurable: true,
  });
  return target as T & { oauthNarrowing: OAuthNarrowing };
}
