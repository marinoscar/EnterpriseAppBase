// =============================================================================
// SMTP credential address (issue #122, moved here by #124, epic #109)
// =============================================================================
//
// The `(purpose, name)` pair the SMTP password is stored under in the
// encrypted credential store (#115, epic #108).
//
// WHY THESE MOVED OUT OF `providers/smtp-email.provider.ts`:
//
// #124 adds the WRITE side of the SMTP password to `EmailSettingsService`, and
// `SmtpEmailProvider` already injects `EmailSettingsService`. Had the service
// imported these constants from the provider, the two modules would import
// each other, and with `emitDecoratorMetadata` a cycle is not a style problem:
// `design:paramtypes` is evaluated at class-decoration time, so whichever
// module CommonJS begins loading second sees `undefined` where a constructor
// parameter type should be, and Nest fails to resolve the dependency at boot.
//
// So the shared value lives in a leaf module that imports nothing at run time. The
// provider re-exports both names, so `SMTP_CREDENTIAL_PURPOSE` and
// `SMTP_CREDENTIAL_NAME` remain importable from exactly where #122 put them
// and the `../email` barrel is unchanged.
//
// ONE DEFINITION, TWO SIDES. The write path (#124's settings PUT) and the read
// path (`SmtpEmailProvider.getTransport`) must address the same row; `purpose`
// is ALSO the cipher's sub-key domain, so a second string literal that differs
// by a character produces a credential that saves without complaint and can
// never be decrypted back. There is deliberately nothing to keep in sync.
// =============================================================================

import type { CredentialPurposeDef } from '../credentials/index';

/**
 * Credential store address for the SMTP password: the sub-key domain.
 *
 * `purpose` is also the AES-GCM sub-key domain (see `CredentialsService`), so
 * changing this string orphans every already-stored SMTP password — they
 * remain in the table and become permanently unreadable. It is not a rename.
 *
 * @stability stable
 */
export const SMTP_CREDENTIAL_PURPOSE = 'smtp';

/**
 * Discriminator within the purpose. 'default' because this app has one mail
 * transport; a future multi-relay setup keys additional rows by relay id
 * without touching anything above.
 *
 * @stability stable
 */
export const SMTP_CREDENTIAL_NAME = 'default';

/**
 * Human label written alongside the stored password.
 *
 * NON-SECRET, and it must stay that way: `CredentialMeta` carries a
 * compile-time proof that it has no secret-bearing field, and this string is
 * shown verbatim in any credential listing. It exists so a row in that listing
 * says what it is for rather than only `smtp/default`.
 *
 * @stability stable
 */
export const SMTP_CREDENTIAL_LABEL = 'SMTP password';

/**
 * The `smtp` purpose's declaration for the credential purpose registry (#735),
 * registered by `platform/credentials/credential-purposes.manifest.ts`.
 *
 * @stability stable
 */
export const SMTP_CREDENTIAL_PURPOSE_DEF = {
  /** The purpose (and cipher sub-key domain). */
  purpose: SMTP_CREDENTIAL_PURPOSE,
  /** The owning slice. */
  owner: 'email',
  /** The label shown in a credential listing. */
  label: 'SMTP password',
  /** Deployment-wide only. */
  tiers: ['system'],
} as const satisfies CredentialPurposeDef;
