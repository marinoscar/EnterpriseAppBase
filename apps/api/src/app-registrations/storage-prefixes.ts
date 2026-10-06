import type { StorageKeyPrefixDef } from '../storage/storage-key-prefix.registry';

/**
 * This app's own object-storage key prefixes (issue #679). Upstream keeps this
 * array empty forever.
 *
 * Declare every prefix a writer of this app uses, or `npm run storage:purge`
 * (`appctl deploy uninstall --purge-storage`) leaves its objects in the bucket.
 * Name the writer's constant `*_KEY_PREFIX`: the tripwire in
 * `storage/storage-key-prefixes.spec.ts` scans `apps/api/src` for such
 * constants and fails on a value no registered prefix covers. A prefix must
 * end with exactly one `/` and must not overlap another registered prefix.
 */
export const APP_STORAGE_KEY_PREFIXES: readonly StorageKeyPrefixDef[] = [
  // { id: 'exports', prefix: 'exports/', owner: 'health-export', description: 'User data exports, purged after seven days' },
];
