import { createHash } from 'node:crypto';

// =============================================================================
// The resolved, active storage configuration (issue #373; drivers: PP-14.7)
// =============================================================================
//
// What `StorageConfigService.resolve()` answers with: the ACTIVE driver's
// settings and secrets, joined, with the driver's own verdict on whether they
// are complete. The rules about what "configured" means belong to the driver
// (`StorageDriver.missing`): the S3 family's are in `drivers/s3/s3-config.ts`
// and an app's driver brings its own. Nothing in the slice knows the names of
// the settings a driver declares.
//
// PURE, AND NEST-FREE, ON PURPOSE. Nothing here injects, reads a row, decrypts
// anything or logs. That is what lets the fingerprint and the description be
// exercised with a literal.
// =============================================================================

/**
 * A configuration that is complete enough to build a provider from.
 *
 * `bucket`, `region` and `endpoint` are the driver's `location()`, already
 * resolved (R2's endpoint is derived, a missing region carries the driver's
 * default): a caller holding one has nothing left to decide. `settings` is the
 * driver's parsed settings; `secrets` its stored secrets by name.
 *
 * ⚠ `secrets` IS PLAINTEXT. It is here because a provider cannot be built
 * without it. Treat a value of this type the way
 * `CredentialsService.getSecret` tells you to treat its return: use it, then
 * let it go out of scope. Do not store one on an instance field, do not put one
 * in a DTO, do not log one, and do not hand one to an error constructor.
 * `StorageConfigService` holds to that rule itself: it caches the settings half
 * and re-reads the secrets every time.
 *
 * @stability experimental
 */
export interface ResolvedStorageConfig {
  /** The id of the active driver. */
  provider: string;
  /** The bucket, container or directory name. Never empty. */
  bucket: string;
  /** The region; empty when the backend has none. */
  region: string;
  /**
   * The origin the driver talks to, or absent for "the SDK's own default host".
   * Absent is meaningful and is NOT the same as empty.
   */
  endpoint?: string;
  /** The driver's parsed, non-secret settings. */
  settings: Readonly<Record<string, unknown>>;
  /** ⚠ Plaintext. The driver's stored secrets by declared name. See the type's own warning. */
  secrets: Readonly<Record<string, string>>;
}

/**
 * The result of asking whether storage is usable: yes with a config, or no with
 * the list of reasons.
 *
 * A DISCRIMINATED UNION RATHER THAN `ResolvedStorageConfig | null`, because the
 * `null` branch is the one that has to be explained to a person. An operator
 * whose uploads have started returning 503 needs "bucket, secretAccessKey",
 * and a bare `null` forces whoever writes the error to re-derive that list.
 *
 * @stability experimental
 */
export type StorageConfigResolution =
  | {
      /** Usable. */
      configured: true;
      /** The resolved configuration a provider is built from. */
      config: ResolvedStorageConfig;
    }
  | {
      /** Not usable. */
      configured: false;
      /** Which driver's requirements were checked. */
      provider: string;
      /** Every missing field the driver named, not just the first. */
      missing: string[];
    };

/**
 * A stable, non-reversible identity for a resolved configuration.
 *
 * WHAT IT IS FOR: `ResolvingStorageProvider` keeps a built provider and needs
 * to know, per call, whether the configuration that produced it is still the
 * configuration in force. Comparing fingerprints answers that in constant time
 * and, crucially, ACROSS A SECRET ROTATION: the secrets are an input, so a key
 * rotated in the credential store yields a different fingerprint, the old
 * provider is discarded, and the new key is in use on the very next call rather
 * than at the next restart.
 *
 * WHY A HASH RATHER THAN THE VALUES JOINED. Keying on the raw tuple would park
 * a plaintext copy of the secrets on a long-lived instance field for the life
 * of the process, where a heap dump or a careless `JSON.stringify(this)` in a
 * debug log would find it. SHA-256 detects change exactly as well and carries
 * nothing back out.
 *
 * ⚠ NEVER LOG THE RETURN VALUE. It is a hash of a secret; publishing it invites
 * exactly the offline guessing attack the hash is otherwise immune to. Use
 * {@link describeStorageConfig} for anything a human will read.
 *
 * Every field that changes the bytes on the wire is an input, and nothing else
 * is: two configurations with the same fingerprint are two configurations the
 * same provider can serve.
 *
 * @stability experimental
 */
export function fingerprintStorageConfig(config: ResolvedStorageConfig): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        config.provider,
        // Sorted, so two spellings of one configuration agree.
        sortedEntries(config.settings),
        sortedEntries(config.secrets),
      ]),
    )
    .digest('hex');
}

function sortedEntries(record: Readonly<Record<string, unknown>>): Array<[string, unknown]> {
  return Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * A one-line, SECRET-FREE description of a configuration, for log lines.
 *
 * Exists so that "which storage is this process using?" is answerable from the
 * logs without anybody being tempted to interpolate the config object itself,
 * which would put the secrets in the log pipeline, in whatever aggregator ships
 * it, and in every retention window downstream.
 *
 * An `accessKeyId` setting is included when the driver has one: it is an
 * identifier that travels in the clear in every SigV4 `Authorization` header,
 * and the one field that distinguishes "the key was rotated" from "the key was
 * mistyped" when both look the same from the outside.
 *
 * @stability experimental
 */
export function describeStorageConfig(config: ResolvedStorageConfig): string {
  const where = config.endpoint ?? (config.region ? `${config.region} (default host)` : 'the default host');
  const keyId = typeof config.settings.accessKeyId === 'string' && config.settings.accessKeyId ? ` keyId=${config.settings.accessKeyId}` : '';

  return `${config.provider} bucket=${config.bucket} at=${where}${keyId}`;
}
