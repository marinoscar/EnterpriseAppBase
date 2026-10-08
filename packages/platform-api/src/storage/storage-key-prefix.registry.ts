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
// ⚠ FRAMEWORK-FREE. Imports only the registry primitive (and the tenancy
// mode), so it is safe to import from both sides of the storage boundary and
// from the standalone purge entry point.
//
// SCOPES AND THE KEY BUILDER (#736, PP-8.3). Every prefix now also says where
// a NEW key puts its tenant segment (`scope`), and `buildObjectKey` is the one
// place a writer builds a key: `uploads/<orgId>/…` (org), `avatars/<userId>/…`
// (user), `storage-config-test/…` (deployment). Root prefixes are unchanged,
// so the full purge (`allKeyPrefixes()`), this tripwire and every runbook keep
// working, and `orgKeyPrefixes(orgId)` gives org offboarding one listable
// prefix per org-scoped root. Existing rows keep their stored `storage_key`
// (legacy `uploads/<timestamp>/…` included): reads, downloads and deletes use
// the stored key and never rebuild it.
// =============================================================================

import { Registry, RegistryError, defineRegistry } from '../core/index';
import { currentTenancyMode } from '../identity/index';

/**
 * Where a NEW key under a prefix puts its tenant segment:
 *
 * - `'org'`: `<prefix><orgId>/<…parts>`. An organization's objects are one
 *   listable prefix, so offboarding (`orgKeyPrefixes`) never scans the bucket.
 * - `'user'`: `<prefix><userId>/<…parts>`, for objects that belong to a person
 *   rather than a tenant (avatars).
 * - `'deployment'`: `<prefix><…parts>`, for deployment-wide objects (probes,
 *   backups).
 *
 * @stability experimental
 */
export type KeyPrefixScope = 'deployment' | 'org' | 'user';

/**
 * Every {@link KeyPrefixScope}, in documentation order.
 *
 * @stability experimental
 */
export const KEY_PREFIX_SCOPES: readonly KeyPrefixScope[] = Object.freeze(['deployment', 'org', 'user']);

/**
 * One object-storage key prefix this application writes under.
 *
 * @stability experimental
 */
export interface StorageKeyPrefixDef {
  /** Stable name, kebab-case, e.g. `'uploads'`, `'database-backups'`. */
  readonly id: string;
  /** The prefix itself, e.g. `'uploads/'`; must match {@link STORAGE_KEY_PREFIX_PATTERN}. */
  readonly prefix: string;
  /** The owning module, e.g. `'storage'`, `'db-backup'`, `'nodes'`, `'ai'`, `'settings/profile-image'`. */
  readonly owner: string;
  /** What lives under the prefix, in one line. */
  readonly description: string;
  /**
   * Where new keys put the org or user segment ({@link KeyPrefixScope}).
   * Optional for the registrations written before #736; absent means
   * `'deployment'` (keys are built as `<prefix><…parts>`, as they always were).
   */
  readonly scope?: KeyPrefixScope;
}

/**
 * The story's name for {@link StorageKeyPrefixDef} (#736); the #679 name wins
 * and this is an alias of it.
 *
 * @stability experimental
 */
export type KeyPrefixDef = StorageKeyPrefixDef;

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
  if (def.scope !== undefined && !KEY_PREFIX_SCOPES.includes(def.scope)) {
    throw new Error(`scope ${JSON.stringify(def.scope)} must be one of ${KEY_PREFIX_SCOPES.join(', ')}`);
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
 * a destructive path may enumerate: read it through {@link allKeyPrefixes}.
 *
 * @stability experimental
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
 * An entry ALREADY REGISTERED with the identical definition (same id, prefix,
 * owner, description and scope) is skipped rather than refused, so a slice's
 * own `forRoot()` can register its prefixes after an app's manifest already
 * did, in the app's order. A different definition under a registered id is
 * still `DUPLICATE_ID`.
 *
 * @param defs - the prefixes, in purge order.
 * @extensionPoint registry
 * @stability experimental
 *
 * @throws RegistryError `INVALID_ENTRY` for a malformed, duplicate or
 *   overlapping prefix, `DUPLICATE_ID`, `INVALID_ID` or `FROZEN`; the registry
 *   is unchanged when it throws.
 */
export function registerStorageKeyPrefixes(defs: readonly StorageKeyPrefixDef[]): void {
  defs = defs.filter((def) => !isAlreadyRegistered(def));
  if (defs.length === 0) return;
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

/** Whether `def` is registered already, with exactly this definition. */
function isAlreadyRegistered(def: StorageKeyPrefixDef): boolean {
  const existing = storageKeyPrefixRegistry.get(def.id);
  return (
    existing !== undefined &&
    existing.prefix === def.prefix &&
    existing.owner === def.owner &&
    existing.description === def.description &&
    (existing.scope ?? 'deployment') === (def.scope ?? 'deployment')
  );
}

/**
 * Registers one prefix: {@link registerStorageKeyPrefixes} with one entry.
 *
 * @param def - the prefix.
 * @throws RegistryError as {@link registerStorageKeyPrefixes} does.
 *
 * @example
 * ```ts
 * registerKeyPrefix({ id: 'exports', prefix: 'exports/', owner: 'health-export', scope: 'org', description: 'User data exports.' });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerKeyPrefix(def: StorageKeyPrefixDef): void {
  registerStorageKeyPrefixes([def]);
}

/**
 * Whether `key` lies under a registered prefix, i.e. whether a purge would reach it.
 *
 * @param key - an object key.
 * @returns `true` when a registered root prefix covers it.
 *
 * @stability experimental
 */
export function isRegisteredStorageKey(key: string): boolean {
  return storageKeyPrefixRegistry.list().some((d) => key.startsWith(d.prefix));
}

/**
 * Every registered root prefix, in registration order: what a FULL purge
 * enumerates (`runStoragePurge`). Covers legacy and org-segmented keys alike,
 * since both sit under the same root.
 *
 * @returns a frozen array, built now from the registry of the running process.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function allKeyPrefixes(): readonly string[] {
  return Object.freeze(storageKeyPrefixRegistry.list().map((d) => d.prefix));
}

/**
 * Every `<prefix><orgId>/` of the org-scoped prefixes: what org offboarding
 * enumerates. ⚠ Not sufficient alone: objects written before #736 have no org
 * segment (`uploads/<timestamp>/…`), so offboarding ALSO deletes the stored
 * keys of `storage_objects WHERE org_id = $1`.
 *
 * @param orgId - the organization id.
 * @returns a frozen array, in registration order.
 * @throws Error when `orgId` is empty or not one path segment.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function orgKeyPrefixes(orgId: string): readonly string[] {
  assertSegment('orgId', orgId);
  return Object.freeze(
    storageKeyPrefixRegistry
      .list()
      .filter((d) => d.scope === 'org')
      .map((d) => `${d.prefix}${orgId}/`),
  );
}

/**
 * Who a key is built for: the organization (org-scoped prefixes), the user
 * (user-scoped prefixes) and, in single-organization mode, the default
 * organization the request scope resolved.
 *
 * @stability experimental
 */
export interface ObjectKeyContext {
  /** The organization: `principal.activeOrgId` or a job payload's `orgId`, never request input. */
  readonly orgId?: string;
  /** The user the object belongs to (user-scoped prefixes). */
  readonly userId?: string;
  /**
   * The default organization, as the request scope knows it. Used for an
   * org-scoped key without `orgId` ONLY in single-organization mode
   * (`TENANCY_MODE=single`); ignored in multi mode, where a missing `orgId`
   * is a programming error.
   */
  readonly defaultOrgId?: string;
}

/** A path segment the builder accepts: no `/`, not empty, not `.`/`..`. */
function assertPart(part: string): void {
  if (typeof part !== 'string' || part === '' || part.includes('/') || part === '.' || part === '..') {
    throw new Error(`buildObjectKey(): invalid key part ${JSON.stringify(part)} (non-empty, no '/', not '.' or '..')`);
  }
}

/**
 * The tenant segment: one non-empty path segment (no `/`, not `.`/`..`). Not
 * checked as a UUID here: the organization comes from the principal (the guard
 * validated it against the user's memberships) or a job payload, and row-level
 * security rejects any other on the row itself.
 */
function assertSegment(name: string, value: string | undefined): asserts value is string {
  if (typeof value !== 'string' || value === '' || value.includes('/') || value === '.' || value === '..') {
    throw new Error(`${name} must be one non-empty path segment (got ${JSON.stringify(value)})`);
  }
}

/**
 * Builds a NEW object key under a registered prefix:
 *
 * - org scope: `<prefix><orgId>/<…parts>`;
 * - user scope: `<prefix><userId>/<…parts>`;
 * - deployment scope: `<prefix><…parts>`.
 *
 * Never used to find an existing object: a row's stored `storage_key` is the
 * truth (legacy keys have no org segment).
 *
 * @param id - the registered prefix id (`'uploads'`).
 * @param ctx - the organization and user; see {@link ObjectKeyContext}.
 * @param parts - the remaining path segments (`'<timestamp>'`, `'<uuid>.pdf'`); at least one.
 * @returns the key.
 * @throws Error when `id` is not registered, a part is malformed, a user-scoped key
 *   has no `userId`, or an org-scoped key has no `orgId` (outside single-org mode
 *   with a `defaultOrgId`).
 *
 * @example
 * ```ts
 * buildObjectKey('uploads', { orgId }, String(Date.now()), `${randomUUID()}.pdf`);
 * // 'uploads/<orgId>/1733000000000/<uuid>.pdf'
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function buildObjectKey(id: string, ctx: ObjectKeyContext, ...parts: string[]): string {
  const def = storageKeyPrefixRegistry.get(id);
  if (def === undefined) {
    throw new Error(`buildObjectKey(): no key prefix "${id}" is registered`);
  }
  if (parts.length === 0) {
    throw new Error(`buildObjectKey(): a key under "${def.prefix}" needs at least one part`);
  }
  parts.forEach(assertPart);

  const scope = def.scope ?? 'deployment';
  if (scope === 'deployment') return `${def.prefix}${parts.join('/')}`;

  if (scope === 'user') {
    assertSegment(`buildObjectKey("${id}"): userId`, ctx.userId);
    return `${def.prefix}${ctx.userId}/${parts.join('/')}`;
  }

  let orgId = ctx.orgId;
  if (orgId === undefined && currentTenancyMode() === 'single' && ctx.defaultOrgId !== undefined) {
    orgId = ctx.defaultOrgId;
  }
  if (orgId === undefined) {
    throw new Error(
      `buildObjectKey("${id}"): an org-scoped key needs ctx.orgId ` +
        '(only single-organization mode may fall back to the default organization of the request scope)',
    );
  }
  assertSegment(`buildObjectKey("${id}"): orgId`, orgId);
  return `${def.prefix}${orgId}/${parts.join('/')}`;
}
