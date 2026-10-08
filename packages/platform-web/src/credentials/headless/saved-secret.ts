// =============================================================================
// The "saved secret" wording, once (issue #735, PP-8.8)
// =============================================================================
//
// Five pages of the reference app render a write-only secret field with their
// own hint sentence (storage, e-mail, the AI provider card, the telemetry
// connection, a user's own AI key). This is the unified sentence, headless, for
// an app that renders its own field; `SecretField` (../ui) uses it.
//
// Secrets are WRITE-ONLY: the API never returns one, only the store's
// non-secret `hint` (`••••abcd`). A blank field therefore means "keep what is
// stored", which is what the sentence tells the user and what
// `secretForSubmit` sends.
// =============================================================================

import type { CredentialInfoDto } from '@marinoscar/platform-contract/credentials';

/**
 * What the page knows about the stored secret: the presentation fields of a
 * credential info (`CredentialInfoDto` from `@marinoscar/platform-contract/credentials`),
 * or `null` when nothing is stored.
 *
 * @stability experimental
 */
export type SavedSecretInfo = Pick<CredentialInfoDto, 'hint'> &
  Partial<Pick<CredentialInfoDto, 'label'>> & {
    /** When it was last changed: an ISO string or a `Date`. */
    readonly updatedAt?: string | Date | null;
  };

/**
 * Options of {@link savedSecretHelperText}.
 *
 * @stability experimental
 */
export interface SavedSecretHelperTextOptions {
  /**
   * What the secret is called in the sentence.
   *
   * @defaultValue `'key'`
   */
  readonly noun?: string;
  /**
   * The sentence when nothing is stored.
   *
   * @defaultValue `'No <noun> is saved yet.'`
   */
  readonly emptyHelp?: string;
  /**
   * Formats the last-change date.
   *
   * @defaultValue `date.toLocaleDateString()`
   */
  readonly formatDate?: (date: Date) => string;
}

/** `a key`, `an access key`. */
function withArticle(noun: string): string {
  return /^[aeiou]/i.test(noun) ? `An ${noun}` : `A ${noun}`;
}

/**
 * The helper text under a write-only secret field.
 *
 * Saved: "A key is saved (••••abcd), updated 10/8/2026. Leave this blank to
 * keep it, or type a new one to replace it." The hint and the date are left
 * out when unknown, and the sentence still reads. Not saved: `emptyHelp`.
 *
 * @param info - the stored secret's presentation fields, or `null`/`undefined` when none is stored.
 * @param options - the noun, the empty sentence and the date format.
 * @returns the sentence.
 *
 * @example
 * ```ts
 * savedSecretHelperText({ hint: '••••abcd', updatedAt: '2026-10-08T00:00:00Z' }, { noun: 'secret access key' });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function savedSecretHelperText(
  info: SavedSecretInfo | null | undefined,
  options: SavedSecretHelperTextOptions = {},
): string {
  const noun = options.noun ?? 'key';
  if (!info) return options.emptyHelp ?? `No ${noun} is saved yet.`;

  const which = info.hint ? ` (${info.hint})` : '';
  const date = info.updatedAt ? new Date(info.updatedAt) : null;
  const format = options.formatDate ?? ((d: Date) => d.toLocaleDateString());
  const when = date && !Number.isNaN(date.getTime()) ? `, updated ${format(date)}` : '';
  return `${withArticle(noun)} is saved${which}${when}. Leave this blank to keep it, or type a new one to replace it.`;
}

/**
 * What to send for a write-only secret field: the typed value, or `undefined`
 * when the field is blank, so the API keeps the stored secret ("blank
 * preserves"). The value is sent byte for byte (never trimmed).
 *
 * @param value - the field's current value.
 * @returns the value, or `undefined` for `''`.
 *
 * @example
 * ```ts
 * await api.patch('/admin/storage-config', { secretAccessKey: secretForSubmit(secret) });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function secretForSubmit(value: string): string | undefined {
  return value === '' ? undefined : value;
}
