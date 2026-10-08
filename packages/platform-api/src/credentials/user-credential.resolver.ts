import { Inject, Injectable, InternalServerErrorException, Optional } from '@nestjs/common';

import { CredentialsService } from './credentials.service';
import { OrgCredentialsService } from './org-credentials.service';
import {
  DEFAULT_USER_CREDENTIAL_NAME,
  danglingCredentialAddresses,
  fallbackOf,
  findUserCredentialPurpose,
  type UserCredentialPurposeDef,
} from './registry';
import { UserCredentialsService } from './user-credentials.service';

// =============================================================================
// UserCredentialResolver — whose key answers? (issue #387; org tier #735)
// =============================================================================
//
// THE CHAIN, for every purpose in the registry:
//
//   1. the user's own credential, if they stored one;
//   2. then each tier of the purpose's `fallback`, in order:
//        'org'    the organization's credential at the purpose's `org` address
//                 (needs `{ orgId }`; skipped without one);
//        'system' the deployment's credential at the purpose's `system` address;
//   3. else none.
//
// The default fallback is `['system']` when the purpose has a system address
// and `[]` otherwise, which is exactly the rule before organizations existed:
// an existing purpose resolves as it always did.
//
// The result says WHICH source answered (`source`), so a caller can attribute
// usage/billing to the right party and tell a user "using your key" vs.
// "using your organization's key" without re-deriving the rule itself.
//
// FAILURES DO NOT FALL THROUGH. A credential that exists but will not decrypt
// throws (from the store's `getSecret`) rather than quietly resolving to the
// next tier: silently billing the organization for a user whose own key is
// broken is exactly the invisible failure the stores refuse to produce.
// =============================================================================

/**
 * DI token for the user credential purposes the resolver consults: a
 * `readonly UserCredentialPurposeDef[]`. `UserCredentialsModule` provides the
 * registry's entries (`userCredentialPurposeRegistry.list()`); a test provides
 * a fixture.
 *
 * @stability experimental
 */
export const USER_CREDENTIAL_PURPOSE_REGISTRY: unique symbol = Symbol.for(
  '@marinoscar/platform/credentials/USER_CREDENTIAL_PURPOSE_REGISTRY',
);

/**
 * The outcome of a resolution. SERVER-SIDE ONLY — the `user`/`org`/`system`
 * arms carry plaintext; never return one from a controller.
 *
 * @stability experimental
 */
export type ResolvedCredential =
  | { readonly source: 'user'; readonly purpose: string; readonly secret: string }
  | { readonly source: 'org'; readonly purpose: string; readonly secret: string }
  | { readonly source: 'system'; readonly purpose: string; readonly secret: string }
  | { readonly source: 'none'; readonly purpose: string };

/**
 * Which source answered, without the secret — safe to log or return.
 *
 * @stability experimental
 */
export type ResolvedCredentialSource = ResolvedCredential['source'];

/**
 * Options of {@link UserCredentialResolver.resolve}.
 *
 * @stability experimental
 */
export interface ResolveCredentialOptions {
  /**
   * The organization the request runs in (`principal.activeOrgId`, or a job
   * payload's `orgId`; never request input). Without it the `org` tier is
   * skipped.
   */
  readonly orgId?: string;
}

/**
 * Answers "whose key does this user's request use?" for a declared user
 * credential purpose: user, then the purpose's fallback tiers (org, system),
 * then none.
 *
 * @example
 * ```ts
 * const key = await resolver.resolve(principal.userId, 'partner_api_token', undefined, {
 *   orgId: principal.activeOrgId ?? undefined,
 * });
 * if (key.source !== 'none') await callPartner(key.secret);
 * ```
 *
 * @stability experimental
 */
@Injectable()
export class UserCredentialResolver {
  /**
   * @param userCredentials - the user store.
   * @param credentials - the deployment store.
   * @param registry - the user credential purposes.
   * @param orgCredentials - the organization store; optional so an app
   *   without `OrgCredentialsModule` keeps the user → system chain.
   * @throws Error at construction (boot) on a malformed registry.
   */
  constructor(
    private readonly userCredentials: UserCredentialsService,
    private readonly credentials: CredentialsService,
    @Inject(USER_CREDENTIAL_PURPOSE_REGISTRY)
    private readonly registry: readonly UserCredentialPurposeDef[],
    @Optional() private readonly orgCredentials?: OrgCredentialsService,
  ) {
    assertValidRegistry(registry);
  }

  /**
   * Resolve the credential `userId` should use for `purpose`.
   *
   * @param userId - the user (a canonical UUID).
   * @param purpose - a registered user credential purpose.
   * @param name - the user-side discriminator; defaults to `'default'` for a
   *   purpose with one key per user. The org and system addresses are fixed by
   *   the registry and do not vary with it.
   * @param options - the organization the request runs in.
   * @returns which source answered and, unless `none`, its plaintext.
   * @throws InternalServerErrorException for a purpose not in the registry (a
   *   programming error, not a missing credential), and when a stored
   *   credential will not decrypt.
   */
  async resolve(
    userId: string,
    purpose: string,
    name: string = DEFAULT_USER_CREDENTIAL_NAME,
    options: ResolveCredentialOptions = {},
  ): Promise<ResolvedCredential> {
    const def = findUserCredentialPurpose(this.registry, purpose);
    if (!def) {
      throw new InternalServerErrorException(
        `Unknown user credential purpose "${purpose}": it is not registered (registerUserCredentialPurpose).`,
      );
    }

    const own = await this.userCredentials.getSecret(userId, purpose, name);
    if (own !== null) {
      return { source: 'user', purpose, secret: own };
    }

    for (const tier of fallbackOf(def)) {
      if (tier === 'org') {
        if (!def.org || !options.orgId || !this.orgCredentials) continue;
        const org = await this.orgCredentials.getSecret(options.orgId, def.org.purpose, def.org.name);
        if (org !== null) return { source: 'org', purpose, secret: org };
      } else if (def.system) {
        const system = await this.credentials.getSecret(def.system.purpose, def.system.name);
        if (system !== null) return { source: 'system', purpose, secret: system };
      }
    }

    return { source: 'none', purpose };
  }
}

/**
 * Fail at boot (provider construction) on a malformed registry rather than at
 * the first resolution: a duplicate purpose would make `find` silently pick
 * one entry, a bad identifier could never be stored under anyway, and an
 * address naming an unregistered purpose could never be written.
 */
function assertValidRegistry(registry: readonly UserCredentialPurposeDef[]): void {
  const seen = new Set<string>();

  for (const def of registry) {
    if (!def.label || !def.description) {
      throw new Error(
        `Invalid user credential registry entry "${String(def.purpose)}": label and description are required.`,
      );
    }
    if (typeof def.purpose !== 'string' || def.purpose.includes(':') || def.purpose.trim() !== def.purpose || def.purpose === '') {
      throw new Error(
        `Invalid user credential registry entry "${String(def.purpose)}": Credential purpose must be a non-empty string with no ":" and no surrounding whitespace.`,
      );
    }
    if (seen.has(def.purpose)) {
      throw new Error(`Duplicate user credential registry entry "${def.purpose}".`);
    }
    seen.add(def.purpose);
  }

  const dangling = danglingCredentialAddresses(registry);
  if (dangling.length > 0) {
    throw new Error(`Invalid user credential registry: ${dangling.join('; ')}.`);
  }
}
