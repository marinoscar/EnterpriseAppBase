import { metadataFor } from '../env-metadata.js';

// =============================================================================
// Read-only, secret-free views of the environment for app steps  (PP-14.22)
// =============================================================================
//
// An app deploy step may need to branch on the deployment's configuration
// ("only publish the APK when ANDROID_PACKAGE is set"). It is given `env` (the
// `.env` this run acts on) and `answers` (the values supplied with `--answer` /
// `--answers-file`) as DeployStepValues:
//
//   - `get(key)` returns undefined for a SECRET key. A key is secret when its
//     env-spec metadata says so, OR (defence in depth: metadata only annotates
//     the keys someone remembered to annotate) its name looks like a secret
//     (SECRET, PASSWORD, PASSWD, TOKEN, API_KEY, PRIVATE, CREDENTIAL, ...).
//   - `has(key)` reports whether the key holds a non-empty value, secret or not;
//     it reveals no value.
//   - `keys()` lists the non-secret keys only.
//
// There is no way to enumerate or read a secret through these accessors, and
// the objects are frozen. A step that genuinely needs a secret reads it where
// its own code is configured to (its own runtime configuration), not through
// the platform's deploy context.
// =============================================================================

/**
 * A read-only view of environment values with secret keys withheld.
 *
 * @stability experimental
 */
export interface DeployStepValues {
  /** True when the key holds a non-empty value - for secret keys too; the value stays withheld. */
  has(key: string): boolean;
  /** The value of a NON-SECRET key; undefined when unset or when the key is a secret. */
  get(key: string): string | undefined;
  /** The non-secret keys that are set, in file order. */
  keys(): readonly string[];
}

const SECRET_NAME = /(SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|PRIVATE|CREDENTIAL|ENCRYPTION_KEY|SIGNING_KEY|ACCESS_KEY)/i;

/**
 * Whether a key's value must not reach an app step: annotated secret, or a
 * name that looks like one.
 *
 * @internal
 */
export function isSecretEnvKey(key: string): boolean {
  if (SECRET_NAME.test(key)) return true;
  try {
    return metadataFor(key).secret === true;
  } catch {
    // An unresolvable annotation is not a reason to expose the value.
    return true;
  }
}

/**
 * Wraps a source of values as a {@link DeployStepValues}. The source is read
 * on every call, so a value written by an earlier step is visible.
 *
 * @internal
 */
export function redactedValues(source: () => ReadonlyMap<string, string> | undefined): DeployStepValues {
  return Object.freeze({
    has: (key: string) => (source()?.get(key) ?? '') !== '',
    get: (key: string) => (isSecretEnvKey(key) ? undefined : source()?.get(key)),
    keys: () => Object.freeze([...(source()?.keys() ?? [])].filter((key) => !isSecretEnvKey(key))),
  });
}
