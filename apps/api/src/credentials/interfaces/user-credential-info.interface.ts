import type {
  AssertTrue,
  SecretBearingKey,
} from './credential-info.interface';

// =============================================================================
// UserCredentialInfo — the presentation-safe view of a per-user credential
// (issue #387)
// =============================================================================
//
// The exact counterpart of `credential-info.interface.ts`, one ownership level
// down, and it exists for the same reason: to make "no plaintext egress" a
// property of the TYPE SYSTEM rather than a property of everyone's good
// intentions.
//
// The per-user store has two reads with two different return types:
//
//   UserCredentialsService.getSecret()  -> string | null        (server-side)
//   UserCredentialsService.describe()   -> UserCredentialInfo   (a response)
//
// Everything that can reach an HTTP response, an OpenAPI schema, or a log line
// travels as `UserCredentialInfo`, which has no field capable of holding
// secret material — not the plaintext and not the ciphertext — so the change
// that leaks a secret ("just add it to the DTO") has nowhere to land. As in
// the system store there is deliberately NO `{ includeSecret?: boolean }`
// flag: two methods, two types, no flag.
//
// THE PROOFS BELOW IMPORT `SecretBearingKey` RATHER THAN RESTATING IT. That is
// the whole point of it being shared — the leak arrives under whatever field
// name the person adding it picked, and a per-store list would mean a name
// that is caught for `smtp/default` sails through for a user's personal LLM
// key. One list, widened in one edit, checked in both places.
//
// -----------------------------------------------------------------------------
// WHAT IS ABSENT HERE THAT IS ABSENT IN `CredentialInfo` TOO
// -----------------------------------------------------------------------------
//
// - `id`. Same reasoning, and it bites harder here. The store's address is
//   `(userId, purpose, name)` and that is the ONLY way to reach a row.
//   Publishing a uuid invites an id-addressed lookup, and an id-addressed
//   lookup silently drops the `userId` scoping — which is not merely the
//   table's uniqueness and the cipher's sub-key domain (as it is for the
//   system store) but the OWNERSHIP boundary itself. The endpoint that fetches
//   "credential 4f3a…" without a `WHERE user_id = me` is the endpoint that
//   hands one user another user's credential metadata, and the type not
//   carrying an id is what keeps that endpoint from being easy to write.
//
// -----------------------------------------------------------------------------
// WHAT IS ABSENT HERE THAT `CredentialInfo` DOES CARRY
// -----------------------------------------------------------------------------
//
// - `updatedByUserId`. There is no column for it, by design: see the
//   `UserCredential` block comment in `prisma/schema.prisma`, which states
//   that the owner is the only party ever permitted to write the row, so the
//   column could only repeat `userId` back or record an administrator reaching
//   into a user's private key — and that second thing is not permitted, so no
//   column exists to be tempted into it. `userId` below is the owner, not
//   provenance; do not read it as the system store's provenance field.
// =============================================================================

/**
 * Everything about a per-user credential that is safe to serialise: whose it
 * is, what it is for, roughly what is in it, and when it changed.
 *
 * WHAT IS ABSENT AND WHY:
 *
 * - `secret` / any plaintext. The whole point; see the header.
 * - The ciphertext. Not merely "not useful" — an attacker holding a base64
 *   payload has the thing that a leaked/rotated key turns into a password, and
 *   it also survives being copied somewhere the encryption key can read it.
 *   Presentation never needs it.
 * - `id`, `updatedByUserId`. See the header.
 */
export interface UserCredentialInfo {
  /**
   * The owning user. The first component of the address, and — folded into
   * `user:<userId>:<purpose>` by `userCredentialPurpose` — part of the cipher
   * domain the row is encrypted under.
   *
   * SAFE TO SERIALISE ONLY BACK TO THAT USER, in practice: it is not secret,
   * but it is the id of the person the response is about, and whatever
   * endpoint eventually returns one of these is expected to be returning the
   * caller's own credentials. The type cannot enforce that; the service's
   * required `userId` argument is what scopes every read.
   */
  readonly userId: string;

  /** Feature domain within that user: 'llm', … See user-credential-purposes.ts. */
  readonly purpose: string;

  /** Discriminator within a purpose: a provider id, 'default', … */
  readonly name: string;

  /**
   * Non-secret display aid, derived from the plaintext on write — never
   * supplied by a caller. Null only for a row written outside this service.
   */
  readonly hint: string | null;

  /** Human description, shown in the owner's own list. User-entered, non-secret. */
  readonly label: string | null;

  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Metadata accepted alongside a write.
 *
 * Note what is NOT here, and it is the same two things plus one:
 *
 * - `hint`. A caller computing the hint is a caller holding the plaintext
 *   longer than it needs to, and a caller free to get it wrong (send the whole
 *   key as the "hint" and the mask is decorative). The service derives it from
 *   the plaintext it already has, in one place.
 * - `updatedByUserId`. No column, no concept — see the header.
 * - `userId`. Not metadata. It is the first component of the ADDRESS and is
 *   therefore a required positional argument on every method, not an optional
 *   field on a bag a caller may forget to fill in.
 *
 * `label` is optional and distinguishes "not provided" from "explicitly null":
 * omitting it on a write leaves the stored label alone, whereas passing `null`
 * clears it. Metadata is not secret, so clearing it is a legitimate thing to
 * ask for — unlike the secret, where blank means preserve.
 */
export interface UserCredentialMeta {
  readonly label?: string | null;
}

// -----------------------------------------------------------------------------
// Compile-time proofs. These are types only — they emit nothing — but a
// violation is a build failure, which is the point: the guarantee above is
// worth exactly as much as the thing that fails when someone breaks it.
// `AssertTrue` and `SecretBearingKey` are imported, not redeclared; see header.
// -----------------------------------------------------------------------------

/**
 * PROOF 1: `UserCredentialInfo` declares no secret-bearing field.
 *
 * If this line errors, do not widen the list — the field being added is the
 * bug. A consumer that needs the plaintext calls `getSecret` from server-side
 * code; nothing that needs it should be shaped like a response DTO.
 */
type _UserCredentialInfoCarriesNoSecret = AssertTrue<
  [Extract<keyof UserCredentialInfo, SecretBearingKey>] extends [never]
    ? true
    : false
>;

/**
 * PROOF 2: the same for the write-side metadata, which also stops `hint` from
 * quietly becoming a caller-supplied field again.
 */
type _UserCredentialMetaCarriesNoSecret = AssertTrue<
  [Extract<keyof UserCredentialMeta, SecretBearingKey | 'hint'>] extends [never]
    ? true
    : false
>;
