import { Injectable, Logger } from '@nestjs/common';

import { CredentialsService } from './credentials.service';
import { UserCredentialsService } from './user-credentials.service';
import { findUserCredentialPurpose } from './user-credential-purposes';

// =============================================================================
// UserCredentialResolver — "whose key do we use?", answered once (issue #387)
// =============================================================================
//
// ONE FIXED RULE, ENCODED IN ONE PLACE:
//
//   1. The caller's own credential wins, whenever they have one.
//   2. If they have none, the deployment's shared credential applies — at the
//      address the purpose registry names in `systemFallback`.
//   3. If the registry has no entry for that purpose, or its `systemFallback`
//      is `null`, there is no fallback and the answer is `null`.
//
// WHY THIS IS A CLASS AND NOT THREE LINES AT EACH CALL SITE. The rule is short
// enough that every consumer would happily write it themselves, which is
// exactly the problem: the second consumer writes it slightly differently —
// falls back when the user's key fails to decrypt (see the failure semantics
// below), or checks the system store first "to avoid a query", or treats an
// unregistered purpose as "use ours". Then two features disagree about whose
// money is being spent, and neither file looks wrong on its own. The rule is
// ordinary; keeping it singular is the point.
//
// -----------------------------------------------------------------------------
// WHY IT RETURNS A SOURCE AND NOT A BARE STRING
// -----------------------------------------------------------------------------
//
// `ResolvedCredential` carries `source` because two things downstream are
// materially different depending on the answer, and neither can recover it
// from the secret itself:
//
//   METERING AND COST ATTRIBUTION. A call made on a user's own key bills them
//   and consumes their provider-side rate limit; the same call on the shared
//   key spends the deployment's budget and contends with every other user.
//   Those are different rows in whatever usage record a feature keeps, and a
//   caller holding only a string cannot tell them apart.
//
//   WHAT TO TELL THE USER WHEN IT FAILS. "Your API key was rejected — check
//   it in settings" and "the shared key is not working, contact an
//   administrator" are different sentences leading to different actions by
//   different people. Getting this wrong sends a user to re-enter a key they
//   never supplied, or leaves them believing their own key is broken when the
//   deployment's is.
//
// The alternative — return a string and let callers ask `describe()` again to
// work out which one they got — is both an extra query and a second, weaker
// derivation of something this method already knew for certain at the moment
// it decided. A caller that genuinely does not care ignores the field.
//
// -----------------------------------------------------------------------------
// FAILURE SEMANTICS: A BROKEN USER KEY IS NOT A MISSING ONE
// -----------------------------------------------------------------------------
//
// A user credential that EXISTS but fails to decrypt PROPAGATES THE THROW. It
// must never fall through to the system key, and the `try`/`catch` that would
// make it do so must never be added here.
//
// `CredentialsService.getSecret`'s own comment gives the argument at the level
// of one store — reporting an undecryptable credential as "not configured"
// would let a key rotation quietly disable email, which is the silent failure
// epic #108 exists to avoid. One level up it is worse, because the fallthrough
// is not merely silent, it SUCCEEDS. A user whose ciphertext was corrupted, or
// was written under a `SECRETS_ENCRYPTION_KEY` that has since rotated, would
// carry on making calls that appear to work while quietly spending the
// deployment's quota and rate limit — believing, correctly as far as any
// screen they can see is concerned, that they are on their own key. Nobody
// finds out until a bill or a rate-limit incident, and by then the trail back
// to a decryption failure weeks earlier is cold.
//
// Loud is the only honest option: the user has a credential, it is unreadable,
// and it must be set again. That is exactly what the store already throws.
//
// -----------------------------------------------------------------------------
// WHAT THIS DELIBERATELY DOES NOT DO
// -----------------------------------------------------------------------------
//
// It does not cache. A resolution is two indexed point lookups, and a cache
// here would have to be invalidated by every write in either store — including
// writes made by another replica — to avoid handing back a key the user has
// already replaced or deleted. That is a real cache with real invalidation, in
// front of a query that is already cheap, holding plaintext secrets in memory.
// If a hot path ever needs one, it belongs to that path, with its lifetime
// visible where the trade is being made.
//
// It does not decide WHETHER a feature is allowed to use the shared key. That
// is policy — a system setting, a permission, a quota — and it belongs to the
// feature that has one. This class answers "what is the credential at this
// address, and whose is it".
// =============================================================================

/** Whose credential answered a resolution. */
export type UserCredentialSource = 'user' | 'system';

/**
 * A resolved credential and its provenance.
 *
 * `secret` IS PLAINTEXT, with every warning `getSecret` carries: use it at the
 * moment of use, let it go out of scope, and never put it in a DTO, a log
 * line, or an error message. There is deliberately no presentation-safe
 * counterpart of this type — resolution exists to produce a usable secret, and
 * a "resolve, but masked" method would just be `describe` in both stores.
 */
export interface ResolvedCredential {
  readonly secret: string;
  readonly source: UserCredentialSource;
}

@Injectable()
export class UserCredentialResolver {
  private readonly logger = new Logger(UserCredentialResolver.name);

  constructor(
    private readonly userCredentials: UserCredentialsService,
    private readonly credentials: CredentialsService,
  ) {}

  /**
   * Resolve the credential a call made on `userId`'s behalf should use.
   *
   * SERVER-SIDE ONLY. RETURNS PLAINTEXT. NEVER CALL THIS FROM A CONTROLLER,
   * and never serialise the result.
   *
   * @param userId  the user the work is being done for; canonical UUID
   * @param purpose the per-user purpose (see user-credential-purposes.ts)
   * @param name    the discriminator within that purpose
   *
   * @returns the secret and whose it is, or `null` when the user has none and
   *          no system fallback is defined for this purpose.
   * @throws if the user HAS a credential here that cannot be decrypted — see
   *         the failure-semantics section in the header. Do not catch this in
   *         order to continue with the system key.
   */
  async resolve(
    userId: string,
    purpose: string,
    name: string,
  ): Promise<ResolvedCredential | null> {
    // Step 1. The owner's own key wins. Argument validation (owner id shape,
    // the purpose/name rules) happens inside the store, so a malformed address
    // fails here as a 400 before anything looks at the system store — the
    // fallback must never become a way for a bad address to still return
    // something.
    //
    // NOT WRAPPED IN try/catch, ON PURPOSE. See the header: a throw from this
    // line means the user has a credential that cannot be read, and that is a
    // different answer from "the user has no credential". Only `null` — the
    // store's explicit "no row" — reaches step 2.
    const own = await this.userCredentials.getSecret(userId, purpose, name);

    if (own !== null) {
      return { secret: own, source: 'user' };
    }

    // Step 2. No personal key. Where does the deployment keep the shared one?
    //
    // The registry is the ONLY source for that address. Deriving it — assuming
    // the system store uses the same `purpose`, or the same `name` — would be
    // a guess that silently resolves to nothing when it is wrong, because a
    // missing system credential and a mis-guessed address are indistinguishable
    // from here. `findUserCredentialPurpose` returns `undefined` for an
    // unregistered purpose rather than throwing (a row can outlive its
    // registry entry), and an unregistered purpose means no fallback: a
    // purpose nobody declared must not reach for a shared key.
    const fallback = findUserCredentialPurpose(purpose)?.systemFallback;

    if (!fallback) {
      return null;
    }

    // Step 3. The deployment's key, at the address the registry named. A null
    // here is an ordinary "not configured" — the administrator has not set one
    // — and is the caller's problem to report, not this class's to invent a
    // value for.
    //
    // An undecryptable SYSTEM credential throws from inside this call for the
    // same reason a user one does, and is likewise not caught: there is
    // nothing further to fall back to, and swallowing it would report a
    // rotated encryption key as "email/AI/whatever is simply not set up".
    const shared = await this.credentials.getSecret(
      fallback.purpose,
      fallback.name,
    );

    if (shared === null) {
      // Debug, not warn: for a purpose whose shared key is genuinely optional
      // this is the normal steady state for every user who has not supplied
      // their own, and a warning per call would be noise that trains operators
      // to ignore the log. Purpose and name only — no user id, per
      // `UserCredentialsService`'s logging rule, which this class is held to
      // as well.
      this.logger.debug(
        `No credential for "${purpose}/${name}": the user has none and the system fallback "${fallback.purpose}/${fallback.name}" is not configured.`,
      );
      return null;
    }

    return { secret: shared, source: 'system' };
  }
}
