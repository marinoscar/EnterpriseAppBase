// =============================================================================
// The settings secret deny-list (issue #373, generalised by #677, moved by #733)
// =============================================================================
//
// A settings document is returned wholesale by its GET route and copied into
// every settings audit row, so no namespace may declare a field that could hold
// a secret. The namespace registries walk every registered schema (any depth,
// any case) against this list at registration time. Secrets belong in the
// encrypted credential store (`CredentialsService`), a user's in their own
// encrypted table (`UserAiKey`, `user_credentials`), never in settings.
//
// Framework-free and import-free.
// =============================================================================

/**
 * Field names no settings namespace may declare, at any depth, compared
 * case-insensitively: `secretAccessKey`, `secretKey`, `sessionToken`,
 * `secret`, `password`, `apiKey`, `token` and `privateKey`. A namespace adds
 * its own with `forbiddenKeys`.
 *
 * The owning slices keep their compile-time proofs (`StorageSettingsCarriesNoSecret`,
 * `AiSettingsCarriesNoSecret`, `TelemetrySettingsCarriesNoSecret`); this list is
 * the run-time generalisation every namespace, an app's included, is held to.
 *
 * @stability stable
 */
export const SETTINGS_SECRET_FIELD_NAMES = [
  'secretAccessKey',
  'secretKey',
  'sessionToken',
  'secret',
  'password',
  'apiKey',
  'token',
  'privateKey',
] as const;

/**
 * One name of {@link SETTINGS_SECRET_FIELD_NAMES}.
 *
 * @stability stable
 */
export type SettingsSecretFieldName = (typeof SETTINGS_SECRET_FIELD_NAMES)[number];

/**
 * The message a registry throws for a secret-named field. Names the field and
 * points to `CredentialsService`.
 *
 * @param field - the namespace part that declares it (`storedSchema`, ...).
 * @param paths - the offending field paths.
 * @param scope - `system`, `user` or `org`.
 * @returns the message.
 *
 * @stability experimental
 */
export function secretFieldMessage(field: string, paths: readonly string[], scope: 'system' | 'user' | 'org'): string {
  const where =
    scope === 'user'
      ? "a user's secrets go in their own encrypted table (see UserAiKey), never in user settings; an app-wide secret goes in CredentialsService"
      : `secrets go in the encrypted credential store (CredentialsService), never in ${scope} settings`;
  return `${field} declares secret-named field(s) ${paths.join(', ')}; ${where}`;
}
