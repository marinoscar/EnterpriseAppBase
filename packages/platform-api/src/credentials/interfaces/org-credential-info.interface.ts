// =============================================================================
// OrgCredentialInfo — the presentation-safe view of an organization's
// credential (issue #735)
// =============================================================================
//
// The organization mirror of `CredentialInfo` and `UserCredentialInfo`, for the
// same reason: "no plaintext egress" is a property of the TYPE SYSTEM.
//
//   OrgCredentialsService.getSecret()  -> string | null      (plaintext, server-side)
//   OrgCredentialsService.describe()   -> OrgCredentialInfo  (safe for a response)
// =============================================================================

/**
 * Everything about an organization's credential that is safe to serialise.
 * No secret, no ciphertext, no row id and no `orgId` (every read is already
 * scoped by the caller's organization).
 *
 * @stability experimental
 */
export interface OrgCredentialInfo {
  /** A registered purpose with the `org` tier. */
  readonly purpose: string;
  /** Discriminator within a purpose: 'default', a provider id, … */
  readonly name: string;
  /** Non-secret display aid, derived from the plaintext on write. */
  readonly hint: string | null;
  /** Human description. Admin-entered, non-secret. */
  readonly label: string | null;
  /** Provenance: who last set the value. Null if the user was deleted. */
  readonly updatedByUserId: string | null;
  /** When it was first stored. */
  readonly createdAt: Date;
  /** When it last changed. */
  readonly updatedAt: Date;
}

/**
 * Metadata accepted alongside a write. `hint` is derived by the service.
 * Omitting a field leaves it alone; `null` clears `label`.
 *
 * @stability experimental
 */
export interface OrgCredentialMeta {
  /** Human description; `null` clears it. */
  readonly label?: string | null;
  /** Who is writing (provenance). */
  readonly updatedByUserId?: string;
}

/** Fails to compile unless `T` is exactly `true`. */
type AssertTrue<_T extends true> = void;

/** Field names that would, or plausibly could, carry secret material. */
type SecretBearingKey =
  | 'secret'
  | 'secretValue'
  | 'plaintext'
  | 'password'
  | 'value'
  | 'ciphertext'
  | 'encrypted'
  | 'payload';

/** PROOF 1: `OrgCredentialInfo` declares no secret-bearing field. */
type _OrgCredentialInfoCarriesNoSecret = AssertTrue<
  [Extract<keyof OrgCredentialInfo, SecretBearingKey>] extends [never] ? true : false
>;

/** PROOF 2: nor does the write-side metadata, and `hint` is never caller-supplied. */
type _OrgCredentialMetaCarriesNoSecret = AssertTrue<
  [Extract<keyof OrgCredentialMeta, SecretBearingKey | 'hint'>] extends [never] ? true : false
>;

/** PROOF 3: no tenant-scoping escape hatch — neither the row id nor the org id. */
type _OrgCredentialInfoCarriesNoId = AssertTrue<
  [Extract<keyof OrgCredentialInfo, 'id' | 'orgId'>] extends [never] ? true : false
>;
