// =============================================================================
// AI admin (org) key credential address (issue #427, epic #419)
// =============================================================================
//
// The `(purpose, name)` pair each provider's ADMIN key is stored under in the
// encrypted credential store. Mirrors `../../storage/storage-credential
// .constants.ts`, including why it is a leaf module that imports nothing:
// several modules need this address (the admin config API that stores the key,
// #428; the catalog sync that reads it back, #427), and a file with no imports
// of its own is safe to import from either side without inviting a module
// import cycle.
//
// ONE DEFINITION, EVERY READER. `purpose` is ALSO the cipher's sub-key domain
// (see `CredentialsService`), so a second string literal that differs by a
// character produces a credential that saves without complaint and can never
// be decrypted back.
//
// The NAME is the provider id (`'openai'`), not a constant: there is one admin
// key per provider — see docs/specs/ai-platform.md §3.
// =============================================================================

/**
 * Credential store purpose for every AI provider's admin key.
 *
 * Changing this string orphans every already-stored admin key — they remain in
 * the table and become permanently unreadable. It is not a rename.
 */
export const AI_CREDENTIAL_PURPOSE = 'ai';

/** The credential name an AI provider's admin key is stored under: its id. */
export function aiCredentialName(providerId: string): string {
  return providerId;
}
