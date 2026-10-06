// =============================================================================
// The storage key-prefix registry (issue #679, PP-1.7)
// =============================================================================
//
// `npm run storage:purge` (what `appctl deploy uninstall --purge-storage` runs
// inside the api image) deletes ONLY the object-storage prefixes the
// application declares. That list used to be a closed array in
// `storage-key-prefixes.ts`, so a fork that wrote a new prefix had to edit a
// platform file and an "exactly six" test, or its objects silently survived a
// purge. This registry opens it: a platform module declares its prefixes in
// `platform-storage-prefixes.ts`, an app declares its own in
// `app-registrations/storage-prefixes.ts`, and the manifest registers both.
//
// The validation below is the point of the file: it makes a prefix the purge
// would mishandle IMPOSSIBLE TO REGISTER, at import time, with a
// `RegistryError`:
//
//   - not matching `STORAGE_KEY_PREFIX_PATTERN` (no leading `/`, no `//`, one
//     trailing `/`): `node-outputs` without its slash would be listed as
//     `node-outputs` and match `node-outputs-old/` too; `node-outputs//` would
//     match nothing and report success.
//   - the same prefix twice, or one prefix starting with another: the purge
//     would count and delete the same objects twice, and the report would
//     overstate what the bucket held.
//
// ⚠ FRAMEWORK-FREE. Imports only the registry primitive, so it is safe to
// import from both sides of the storage boundary and from the standalone
// `storage/purge/storage-purge.main.ts`, exactly like `storage-key-prefixes.ts`.
// =============================================================================

import { Registry, RegistryError, defineRegistry } from '../common/registry';

/** One object-storage key prefix this application writes under. */
export interface StorageKeyPrefixDef {
  /** Stable name, kebab-case, e.g. `'uploads'`, `'database-backups'`. */
  readonly id: string;
  /** The prefix itself, e.g. `'uploads/'`; must match {@link STORAGE_KEY_PREFIX_PATTERN}. */
  readonly prefix: string;
  /** The owning module, e.g. `'storage'`, `'db-backup'`, `'nodes'`, `'ai'`, `'settings/profile-image'`. */
  readonly owner: string;
  /** What lives under the prefix, in one line. */
  readonly description: string;
}

/**
 * The shape every registered prefix must have: lowercase segments of letters,
 * digits and `-`, separated by single `/`, ending with exactly one `/`, never
 * starting with one.
 */
export const STORAGE_KEY_PREFIX_PATTERN = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*\/$/;

/** The id shape: kebab-case, so ids read the same in the purge report and in docs. */
const STORAGE_KEY_PREFIX_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Throws when `def` cannot be registered next to `others`; the message names the conflict. */
function assertRegistrable(def: StorageKeyPrefixDef, others: Iterable<StorageKeyPrefixDef>): void {
  if (typeof def.prefix !== 'string' || !STORAGE_KEY_PREFIX_PATTERN.test(def.prefix)) {
    throw new Error(
      `prefix ${JSON.stringify(def.prefix)} must match ${STORAGE_KEY_PREFIX_PATTERN} ` +
        "(lowercase segments, no leading '/', no '//', exactly one trailing '/')",
    );
  }
  if (typeof def.owner !== 'string' || def.owner.trim() === '') {
    throw new Error('owner is required');
  }
  if (typeof def.description !== 'string' || def.description.trim() === '') {
    throw new Error('description is required');
  }

  for (const other of others) {
    if (other.id === def.id) continue; // the duplicate-id rule reports this one
    if (other.prefix === def.prefix) {
      throw new Error(`prefix "${def.prefix}" is already registered by "${other.id}"`);
    }
    if (def.prefix.startsWith(other.prefix) || other.prefix.startsWith(def.prefix)) {
      throw new Error(
        `prefix "${def.prefix}" overlaps "${other.prefix}" (registered by "${other.id}"); ` +
          'the purge would count and delete the same objects twice',
      );
    }
  }
}

/**
 * Every object-storage key prefix this application writes under, in
 * registration order (platform entries first, then the app's). The only thing
 * a destructive path may enumerate; read it through `STORAGE_KEY_PREFIXES` in
 * `storage-key-prefix.view.ts`, which also loads the manifest.
 */
export const storageKeyPrefixRegistry: Registry<StorageKeyPrefixDef> = defineRegistry<StorageKeyPrefixDef>({
  name: 'storage-key-prefixes',
  idOf: (d) => d.id,
  idPattern: STORAGE_KEY_PREFIX_ID_PATTERN,
  // Checks against what is already registered. Overlaps INSIDE one batch are
  // checked by `registerStorageKeyPrefixes`, because `registerAll` runs
  // `validate` before any entry of the batch is added.
  validate: (d, registry) => assertRegistrable(d, registry.list()),
});

/**
 * Registers `defs`, all or nothing. Unlike a bare `registerAll`, it also
 * rejects two entries of the same batch that share or overlap a prefix.
 *
 * @throws RegistryError `INVALID_ENTRY` for a malformed, duplicate or
 *   overlapping prefix, `DUPLICATE_ID`, `INVALID_ID` or `FROZEN`; the registry
 *   is unchanged when it throws.
 */
export function registerStorageKeyPrefixes(defs: readonly StorageKeyPrefixDef[]): void {
  defs.forEach((def, index) => {
    try {
      assertRegistrable(def, defs.slice(0, index));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new RegistryError(
        'INVALID_ENTRY',
        storageKeyPrefixRegistry.name,
        `Invalid entry "${def.id}" in registry "${storageKeyPrefixRegistry.name}": ${reason}`,
        { id: typeof def.id === 'string' ? def.id : undefined, cause: err },
      );
    }
  });
  storageKeyPrefixRegistry.registerAll(defs);
}

/** Whether `key` lies under a registered prefix, i.e. whether a purge would reach it. */
export function isRegisteredStorageKey(key: string): boolean {
  return storageKeyPrefixRegistry.list().some((d) => key.startsWith(d.prefix));
}
