import { BadRequestException } from '@nestjs/common';

// =============================================================================
// Credential store internals — shared by BOTH stores (issue #387)
// =============================================================================
//
// Extracted from `credentials.service.ts` when #387 added a second store
// (`UserCredentialsService`) alongside the system one. Nothing here is new
// behaviour; it is the same code, moved, with one addition called out below.
//
// WHY EXTRACT RATHER THAN LET THE SECOND STORE WRITE ITS OWN. "Blank
// preserves" and "what a hint looks like" are not implementation details of
// either store, they are the CONTRACT both of them present to an operator and
// to a user. Two copies of `isBlankSecret` is two definitions of when a form
// submission destroys a working credential, and they only have to disagree
// once — by a `.trim()` somebody adds to one of them "for consistency" — for
// a whitespace-bearing token to be preserved in one store and treated as a
// no-op in the other. Same for the hint: a mask that reveals four characters
// in one listing and six in another is a listing that leaks more than it
// advertises, and nobody would notice because each file reads fine alone.
//
// This module is a LEAF: it imports one exception class from Nest and nothing
// else in this repository. That is deliberate and matches the reasoning in
// `email/smtp-credential.constants.ts` — a shared value that both a service
// and its consumers import must not sit in a module that imports them back,
// because with `emitDecoratorMetadata` a require cycle is not a style problem
// but a boot failure (`design:paramtypes` resolves to `undefined` for
// whichever module CommonJS loads second, and Nest cannot resolve the
// constructor parameter).
//
// These are functions, not a Nest provider, for the same reason
// `notification-events.ts` is not one: they are pure, they hold no state, and
// standing up DI to reach a string-mask constant buys nothing.
// =============================================================================

// -----------------------------------------------------------------------------
// Hints
// -----------------------------------------------------------------------------

/** The mask shown for the unreadable part of a secret. */
export const HINT_MASK = '••••';

/**
 * Number of trailing characters revealed in a hint.
 *
 * Four is enough to tell two API keys apart in a list, which is the entire job
 * of a hint. More is not a better hint, it is a worse secret.
 */
export const HINT_REVEALED_CHARS = 4;

/**
 * Below this length, reveal nothing.
 *
 * At 4 characters "the last 4" is the whole secret; at 5 it is all but one. The
 * floor keeps the hint from being a substantial fraction of a short PIN-like
 * value. Anything at or above 8 loses at most half.
 */
export const HINT_MIN_LENGTH_TO_REVEAL = 8;

/**
 * Derive the non-secret display hint from the plaintext.
 *
 * Called only from the write path, where the service already holds the
 * plaintext for encryption, so this adds no new exposure — and it is why
 * `CredentialMeta` has no `hint` field for a caller to fill in wrongly.
 *
 * Iterates code points rather than UTF-16 units: `'…'.slice(-4)` can cut a
 * surrogate pair in half and leave a lone surrogate, which is not valid UTF-8
 * and blows up on the way into a Postgres `text` column — a passphrase with an
 * emoji in it would make saving fail with a completely unrelated error.
 */
export function deriveHint(plaintext: string): string {
  const codePoints = Array.from(plaintext);

  if (codePoints.length < HINT_MIN_LENGTH_TO_REVEAL) {
    return HINT_MASK;
  }

  return `${HINT_MASK}${codePoints.slice(-HINT_REVEALED_CHARS).join('')}`;
}

// -----------------------------------------------------------------------------
// Blank-preserves
// -----------------------------------------------------------------------------

/**
 * Is this write a "preserve what is stored" write?
 *
 * `undefined` and `null` are both here because a JSON body deserialises an
 * omitted field to `undefined` and an explicitly-null one to `null`, and an
 * admin form means the same thing by both: "I did not type a new password."
 *
 * NOTE THE ABSENCE OF `.trim()`. A whitespace-only submission counts as a real
 * value, and a secret is stored byte-for-byte. Normalising a secret's bytes is
 * not this service's call: the caller may legitimately hold a token whose
 * surrounding whitespace is significant, and silently altering it produces an
 * authentication failure with no visible cause. Trimming user input is a
 * presentation-layer decision, made where the form is.
 */
export function isBlankSecret(
  secret: string | null | undefined,
): secret is null | undefined | '' {
  return secret === undefined || secret === null || secret === '';
}

// -----------------------------------------------------------------------------
// Address validation
// -----------------------------------------------------------------------------

/** Which half of a credential address is being validated. */
export type CredentialIdentifierField = 'purpose' | 'name';

/**
 * Reject an unusable address component.
 *
 * Runtime checks despite the `string` types because a config value, a JSON
 * round-trip, or a plain-JS caller can all deliver something else.
 *
 * WHITESPACE IS REJECTED RATHER THAN TRIMMED, and `purpose` is the reason:
 * it is also the cipher's sub-key domain, so `'smtp '` and `'smtp'` derive
 * two different keys. Silently trimming would let a row written under one
 * spelling become permanently unreadable under the other, with both looking
 * identical in a log. `name` is held to the same rule so the two halves of
 * the address behave the same way. These are code-level constants, not user
 * input; there is nothing legitimate to normalise.
 *
 * ── ADDED BY #387: `purpose` MAY NOT CONTAIN A COLON ─────────────────────
 * This is the one change made while moving this validator out of
 * `CredentialsService`, and it is not a tidiness rule — it is half of a proof
 * that lives elsewhere.
 *
 * `userCredentialPurpose` (common/crypto/secret-cipher.ts) builds a per-user
 * cipher domain as `user:<uuid>:<purpose>`, and its collision proof depends on
 * a user domain containing exactly two colons after the fixed derivation-label
 * prefix while a SYSTEM purpose — which is the whole of a system domain's
 * variable part — contains none. That is what makes the two domains provably
 * disjoint, so a ciphertext cannot be read under the wrong one. The cipher
 * enforces the rule on the user side itself; this validator is the system
 * side, and without it a system purpose such as `'user:0000…:llm'` could be
 * chosen (by a fork, by a future feature) that derives the identical key as
 * some user's real domain.
 *
 * THE THREE SYSTEM PURPOSES THAT EXIST TODAY ARE UNAFFECTED, verified rather
 * than assumed: `'smtp'` (email/smtp-credential.constants.ts), `'storage'`
 * (storage/storage-credential.constants.ts) and `'push_vapid'`
 * (notifications/push-vapid-credential.constants.ts). None contains a colon,
 * so this rule rejects nothing that is already stored and breaks no existing
 * row; it only constrains purposes not yet written.
 *
 * The rule is on `purpose` ONLY. `name` is never part of a cipher domain — it
 * addresses a row and nothing else — so a colon in it collides with nothing,
 * and forbidding it there would be a restriction with no argument behind it.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * @throws BadRequestException — a caller/operator input problem (400), not a
 *         fault, which is what both stores want at their own boundary.
 */
export function assertCredentialIdentifier(
  value: string,
  field: CredentialIdentifierField,
): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestException(
      `Credential ${field} must be a non-empty string.`,
    );
  }

  if (value !== value.trim()) {
    throw new BadRequestException(
      `Credential ${field} must not have leading or trailing whitespace.`,
    );
  }

  if (field === 'purpose' && value.includes(':')) {
    // The message explains the rule rather than just stating it: the next
    // person to hit this is choosing a purpose string, and "not allowed" would
    // send them looking for the arbitrary restriction instead of the proof.
    throw new BadRequestException(
      'Credential purpose must not contain ":". The colon is reserved as the ' +
        'field delimiter in a per-user cipher domain ("user:<userId>:<purpose>"), ' +
        'and keeping it out of a system purpose is what keeps the two key ' +
        'domains provably disjoint.',
    );
  }
}

/**
 * Validate both halves of a `(purpose, name)` address.
 *
 * Purpose first, deliberately: it is the half that is also a cipher domain, so
 * when both are wrong the error an operator sees is about the one that matters.
 */
export function assertCredentialAddress(purpose: string, name: string): void {
  assertCredentialIdentifier(purpose, 'purpose');
  assertCredentialIdentifier(name, 'name');
}
