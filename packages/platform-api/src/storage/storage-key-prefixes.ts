// =============================================================================
// Every key prefix this application writes into object storage (issue #404)
// =============================================================================
//
// THE ONE REASON THIS FILE EXISTS. `appctl deploy uninstall --purge-storage`
// deletes objects, and it must build its targets from a list the APPLICATION
// owns rather than one somebody transcribed into the CLI. The portable deploy
// specification records what happens otherwise: a transcribed list said
// `backups/` where the real constant was `database-backups/`, and the purge
// would have reported COMPLETE while leaving every database backup in the
// bucket. Nothing failed, nothing warned; the operator was simply told a
// falsehood about their own data.
//
// So the rule is structural, not procedural: purge targets are built ONLY from
// `STORAGE_KEY_PREFIXES`, the frozen view of the storage key-prefix registry
// (`storage-key-prefix.view.ts`; registry in `storage-key-prefix.registry.ts`,
// issue #679). The constants below are the platform's entries
// (`platform-storage-prefixes.ts` registers them); an app registers its own in
// `app-registrations/storage-prefixes.ts`, never here.
// `storage-key-prefixes.spec.ts` asserts each entry is the prefix its writer
// actually uses, and scans `apps/api/src` for every `*_KEY_PREFIX` constant: a
// new writer that invents a prefix nobody registered trips that test. A purge
// that filtered a full bucket listing instead of using the list would not,
// which is why it must not.
//
// WHY IT LIVES HERE AND NOT IN `packages/shared`. That package is committed as
// plain CommonJS with a hand-written `index.d.ts` and no build step, so a
// constant there costs a second declaration to keep in sync. Worse, it would
// move the list AWAY from the code that writes the keys -- and the property
// this whole file exists for is that adding a writer in `apps/api` must trip
// the test. Distance from the writers is the failure mode, not a neutral
// packaging choice.
//
// (#736: no longer a no-import leaf. It imports the registry, to declare the
// slice's registrations next to the constants, and the nodes slice's
// constant. Neither imports a Nest module, so the cycle concern below holds.)
//
// A NO-IMPORT LEAF, exactly like `storage-credential.constants.ts` beside it
// and for the reason its header gives: several modules on both sides of the
// storage boundary need this, and a file that imports nothing is safe to
// import from either without inviting a cycle under `emitDecoratorMetadata`.
// That is also why `STORAGE_KEY_PREFIXES` is NOT here: the view loads the
// manifest, which imports this file through `platform-storage-prefixes.ts`. A
// load test in the spec proves this file still requires nothing.
//
// ⚠ TRAILING SLASHES ARE NORMALISED HERE, AND THAT IS NOT COSMETIC. The
// writers disagree: `BACKUP_KEY_PREFIX` carries one, `NODE_OUTPUT_KEY_PREFIX`
// does not (it is joined as `${PREFIX}/${id}`), and `uploads/` was a bare
// template literal in two places with no constant at all. A purge built from
// the raw values would ask for `node-outputs//`, match nothing, and report
// success -- the same silent falsehood in a new costume.
// =============================================================================

import { NODE_OUTPUT_KEY_PREFIX } from '../nodes/index';
import { registerStorageKeyPrefixes, storageKeyPrefixRegistry, type StorageKeyPrefixDef } from './storage-key-prefix.registry';

/**
 * Files uploaded through the storage objects API. ORG scope since #736: new
 * keys are `uploads/<orgId>/<timestamp>/<uuid><ext>`; rows written before keep
 * `uploads/<timestamp>/<uuid><ext>`.
 *
 * @stability stable
 */
export const UPLOADS_KEY_PREFIX = 'uploads/';

/**
 * Per-user profile images. USER scope: individual objects live under
 * `avatars/<userId>/` (an avatar belongs to a person, not a tenant).
 *
 * @stability stable
 */
export const AVATARS_KEY_PREFIX = 'avatars/';

/**
 * Artifacts a worker node uploaded for a job it executed
 * (`node-outputs/<jobId>/<uuid>`). The nodes slice owns the writer and its
 * slash-less constant (`NODE_OUTPUT_KEY_PREFIX`, joined as
 * `${PREFIX}/${id}`); the slice cannot depend on storage, so storage
 * registers the prefix for it, normalised to one trailing slash.
 *
 * @stability stable
 */
export const NODE_OUTPUTS_KEY_PREFIX = `${NODE_OUTPUT_KEY_PREFIX}/`;

/**
 * Probe objects written by the storage connection test. DEPLOYMENT scope.
 *
 * ⚠ Easy to leave off the registry and wrong to: the test deletes its probe
 * on a best-effort basis, so these DO linger after a failed round trip. A
 * purge that skipped this prefix would leave exactly the objects an operator
 * never knew they had.
 *
 * @stability stable
 */
export const STORAGE_TEST_KEY_PREFIX = 'storage-config-test/';

/**
 * The storage slice's own prefix registrations, in the platform's historical
 * purge order (`uploads`, `avatars`, `node-outputs`, `storage-config-test`).
 * `StorageModule.forRoot()` registers them (a no-op for an entry the app's
 * manifest already registered identically, which is how the reference app
 * keeps `database-backups` and `ai-outputs` between them).
 *
 * @stability experimental
 */
export const STORAGE_SLICE_KEY_PREFIXES: readonly StorageKeyPrefixDef[] = Object.freeze(
  [
    {
      id: 'uploads',
      prefix: UPLOADS_KEY_PREFIX,
      owner: 'storage',
      scope: 'org' as const,
      description: 'Files uploaded through the storage objects API, under uploads/<orgId>/ (legacy rows: uploads/<timestamp>/).',
    },
    {
      id: 'avatars',
      prefix: AVATARS_KEY_PREFIX,
      owner: 'storage/profile-image',
      scope: 'user' as const,
      description: 'Per-user profile images, under avatars/<userId>/.',
    },
    {
      id: 'node-outputs',
      prefix: NODE_OUTPUTS_KEY_PREFIX,
      owner: 'nodes',
      scope: 'deployment' as const,
      description: 'Artifacts a worker node uploaded for a job it executed, under node-outputs/<jobId>/.',
    },
    {
      id: 'storage-config-test',
      prefix: STORAGE_TEST_KEY_PREFIX,
      owner: 'storage/config',
      scope: 'deployment' as const,
      description: 'Probe objects the storage connection test writes; they linger after a failed round trip.',
    },
  ].map((def) => Object.freeze(def)),
);

/**
 * Registers {@link STORAGE_SLICE_KEY_PREFIXES}. Idempotent; called by
 * `StorageModule.forRoot()`.
 *
 * @stability experimental
 */
export function registerStorageSliceKeyPrefixes(): void {
  registerStorageKeyPrefixes(STORAGE_SLICE_KEY_PREFIXES);
}

/**
 * {@link registerStorageSliceKeyPrefixes} unless every slice prefix is
 * registered already or the registry is frozen: what a service that builds
 * keys calls from its constructor, so it works when it is constructed without
 * `StorageModule.forRoot()` (a spec, a script).
 *
 * @internal
 *
 * @stability experimental
 */
export function ensureStorageSliceKeyPrefixes(): void {
  if (STORAGE_SLICE_KEY_PREFIXES.every((def) => storageKeyPrefixRegistry.has(def.id))) return;
  if (storageKeyPrefixRegistry.frozen) return;
  registerStorageSliceKeyPrefixes();
}
