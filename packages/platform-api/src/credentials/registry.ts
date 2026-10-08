// =============================================================================
// Credential purpose registries (issue #735, PP-8.8; replaces #387's array)
// =============================================================================
//
// Two static registries on the #675 primitive (`defineRegistry` from
// `@marinoscar/platform-api/core`: string ids, a duplicate id throws, frozen
// by `RegistryFreezeService` once the application has bootstrapped):
//
//   credential purposes       every SYSTEM or ORG purpose: what may be stored
//                             in `credentials` and `org_credentials`. A purpose
//                             is the cipher's sub-key domain (bare for the
//                             system tier, `org:<orgId>:<purpose>` for the org
//                             tier), so it is PERMANENT once rows exist.
//   user credential purposes  every kind of key a USER may bring themselves,
//                             with where the org's and the deployment's key for
//                             the same thing live and the order to fall back.
//
// Two slices or apps claiming the same purpose fail at import, during boot.
// A write to an unregistered purpose is refused by the store with a 500-class
// error (a typo in code must fail in tests, not at runtime for a user).
//
// Filled at import time by the owner's manifest (the reference app:
// `apps/api/src/platform/credentials/credential-purposes.manifest.ts`), never
// from `onModuleInit` (see core/registry/README.md).
//
// THE AI PROVIDER KEY IS NOT A USER PURPOSE. A user's own AI key lives in
// `user_ai_keys` (the AI slice), with its own reachability bookkeeping and
// resolver; declaring it here would create a second store for the same key.
// docs/specs/user-credentials.md explains it.
// =============================================================================

import { defineRegistry, type Registry } from '../core/index';
import { assertCredentialAddress, assertCredentialPurpose } from './credential-internals';

/**
 * A purpose id: like a registry id, but never `:` (the cipher's domain
 * separator) and never `/`.
 */
const PURPOSE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]*$/;

/**
 * The tiers a system or org purpose may be stored in: `system` is the
 * deployment store (`credentials`), `org` an organization's (`org_credentials`).
 *
 * @stability experimental
 */
export type CredentialTier = 'system' | 'org';

/**
 * One system or org credential purpose.
 *
 * @stability experimental
 */
export interface CredentialPurposeDef {
  /** The stored purpose and sub-key domain (`'smtp'`). No `:`; permanent once rows exist. */
  readonly purpose: string;
  /** Who declared it: a platform slice id (`'email'`) or an app owner (`'app'`). */
  readonly owner: string;
  /** Short, human description for logs and the Doctor ("SMTP password"). */
  readonly label: string;
  /** The tiers it may be stored in; at least one. */
  readonly tiers: readonly CredentialTier[];
}

/**
 * Where a credential lives in the deployment or an organization store.
 *
 * @stability experimental
 */
export interface SystemCredentialAddress {
  /** A registered purpose with the matching tier. */
  readonly purpose: string;
  /** The name within it (`'default'`). */
  readonly name: string;
}

/**
 * The org-tier counterpart's address; same shape as {@link SystemCredentialAddress}.
 *
 * @stability experimental
 */
export type OrgCredentialAddress = SystemCredentialAddress;

/**
 * A step of the resolver's fallback after the user's own key.
 *
 * @stability experimental
 */
export type CredentialFallbackTier = 'org' | 'system';

/**
 * One kind of key a user may supply themselves.
 *
 * @stability experimental
 */
export interface UserCredentialPurposeDef {
  /**
   * Stable identifier, stored on every row and bound into the cipher domain
   * `user:<userId>:<purpose>`, so renaming it strands every stored key. No `:`.
   */
  readonly purpose: string;
  /** Short user-facing name ("Webhook signing secret"). */
  readonly label: string;
  /** One or two sentences of user-facing copy: what the key is used for. */
  readonly description: string;
  /**
   * The deployment's own key for the same thing, or `null` when there is no
   * deployment-wide counterpart.
   */
  readonly system: SystemCredentialAddress | null;
  /**
   * The organization's key for the same thing, in `org_credentials`, or
   * `null`/absent when there is none.
   */
  readonly org?: OrgCredentialAddress | null;
  /**
   * Where the resolver looks after the user's own key, in order.
   *
   * @defaultValue `['system']` when `system` is set, `[]` otherwise (the
   *   behaviour before organizations existed).
   */
  readonly fallback?: readonly CredentialFallbackTier[];
}

/**
 * The `name` a user's credential is stored under when a purpose has one key.
 *
 * @stability experimental
 */
export const DEFAULT_USER_CREDENTIAL_NAME = 'default';

function assertNonEmpty(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required`);
}

/**
 * Every system and org credential purpose. Read it; register with
 * {@link registerCredentialPurpose}.
 *
 * @stability experimental
 */
export const credentialPurposeRegistry: Registry<CredentialPurposeDef> = defineRegistry<CredentialPurposeDef>({
  name: 'credential-purposes',
  idOf: (def) => def.purpose,
  idPattern: PURPOSE_ID_PATTERN,
  validate: (def) => {
    assertCredentialPurpose(def.purpose);
    assertNonEmpty(def.owner, 'owner');
    assertNonEmpty(def.label, 'label');
    if (!Array.isArray(def.tiers) || def.tiers.length === 0) throw new Error('tiers must name at least one of system, org');
    for (const tier of def.tiers) {
      if (tier !== 'system' && tier !== 'org') throw new Error(`unknown tier "${String(tier)}"`);
    }
    if (new Set(def.tiers).size !== def.tiers.length) throw new Error('tiers must not repeat');
  },
  describeDuplicate: (existing, incoming) =>
    `Credential purpose "${incoming.purpose}" is already registered by "${existing.owner}"; "${incoming.owner}" cannot claim it too.`,
});

/**
 * Declares a system or org credential purpose. Call it at import time from
 * the owner's manifest, before the application bootstraps.
 *
 * @param def - the purpose, its owner, a label and the tiers it is stored in.
 * @throws RegistryError `DUPLICATE_ID` when another owner already claimed the
 *   purpose, `INVALID_ID` / `INVALID_ENTRY` for a malformed one, `FROZEN`
 *   after bootstrap.
 *
 * @example
 * ```ts
 * registerCredentialPurpose({ purpose: 'smtp', owner: 'email', label: 'SMTP password', tiers: ['system'] });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerCredentialPurpose(def: CredentialPurposeDef): void {
  credentialPurposeRegistry.register(def);
}

/**
 * Every kind of key a user may bring. Read it (the resolver reads it through
 * the `USER_CREDENTIAL_PURPOSE_REGISTRY` token); register with
 * {@link registerUserCredentialPurpose}.
 *
 * @stability experimental
 */
export const userCredentialPurposeRegistry: Registry<UserCredentialPurposeDef> = defineRegistry<UserCredentialPurposeDef>({
  name: 'user-credential-purposes',
  idOf: (def) => def.purpose,
  idPattern: PURPOSE_ID_PATTERN,
  validate: (def) => validateUserCredentialPurpose(def),
});

/**
 * Declares a kind of key a user may bring themselves. Call it at import time
 * from the owner's manifest, before the application bootstraps.
 *
 * @param def - the purpose, its copy, its system and org counterparts and the
 *   fallback order.
 * @throws RegistryError `DUPLICATE_ID` for a purpose already declared,
 *   `INVALID_ENTRY` for a malformed one, `FROZEN` after bootstrap.
 *
 * @example
 * ```ts
 * registerUserCredentialPurpose({
 *   purpose: 'webhook_signing_key',
 *   label: 'Webhook signing secret',
 *   description: 'Signs the webhooks sent on your behalf.',
 *   system: null,
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerUserCredentialPurpose(def: UserCredentialPurposeDef): void {
  userCredentialPurposeRegistry.register(def);
}

/**
 * The resolver's fallback order for a purpose: its `fallback`, or the default
 * (`['system']` when it has a system counterpart, `[]` otherwise).
 *
 * @param def - a user credential purpose.
 * @returns the tiers consulted after the user's own key, in order.
 *
 * @stability experimental
 */
export function fallbackOf(def: UserCredentialPurposeDef): readonly CredentialFallbackTier[] {
  return def.fallback ?? (def.system ? ['system'] : []);
}

/**
 * Checks one user credential purpose on its own (identifiers, copy, the two
 * addresses and the fallback order). The cross-registry check (each address
 * names a registered purpose of the right tier) runs when the resolver is
 * constructed and in the conformance suite.
 *
 * @param def - the entry.
 * @throws Error naming the problem.
 */
function validateUserCredentialPurpose(def: UserCredentialPurposeDef): void {
  assertCredentialPurpose(def.purpose);
  assertNonEmpty(def.label, 'label');
  assertNonEmpty(def.description, 'description');
  if (def.system) assertCredentialAddress(def.system.purpose, def.system.name);
  if (def.org) assertCredentialAddress(def.org.purpose, def.org.name);
  if (def.fallback !== undefined) {
    if (!Array.isArray(def.fallback)) throw new Error('fallback must be an array');
    if (new Set(def.fallback).size !== def.fallback.length) throw new Error('fallback must not repeat a tier');
    for (const tier of def.fallback) {
      if (tier === 'org' && !def.org) throw new Error('fallback names "org" but the purpose has no org address');
      if (tier === 'system' && !def.system) throw new Error('fallback names "system" but the purpose has no system address');
      if (tier !== 'org' && tier !== 'system') throw new Error(`unknown fallback tier "${String(tier)}"`);
    }
  }
}

/**
 * Look up one purpose in a registry snapshot; `undefined` when it is not
 * declared.
 *
 * @param registry - the purposes, as the `USER_CREDENTIAL_PURPOSE_REGISTRY` token provides them.
 * @param purpose - the purpose to find.
 * @returns the entry, or `undefined`.
 *
 * @stability experimental
 */
export function findUserCredentialPurpose(
  registry: readonly UserCredentialPurposeDef[],
  purpose: string,
): UserCredentialPurposeDef | undefined {
  return registry.find((def) => def.purpose === purpose);
}

/**
 * The problems that make a user credential purpose point nowhere: a system or
 * org address that names no registered purpose of that tier.
 *
 * @param defs - the user credential purposes.
 * @param purposes - the system and org purposes (default: the registry).
 * @returns one message per problem; empty when every address resolves.
 *
 * @stability experimental
 */
export function danglingCredentialAddresses(
  defs: readonly UserCredentialPurposeDef[],
  purposes: Pick<Registry<CredentialPurposeDef>, 'get'> = credentialPurposeRegistry,
): string[] {
  const problems: string[] = [];
  const check = (def: UserCredentialPurposeDef, address: SystemCredentialAddress | null | undefined, tier: CredentialTier) => {
    if (!address) return;
    const target = purposes.get(address.purpose);
    if (!target) {
      problems.push(`user credential purpose "${def.purpose}": its ${tier} address names "${address.purpose}", which is not a registered credential purpose`);
    } else if (!target.tiers.includes(tier)) {
      problems.push(`user credential purpose "${def.purpose}": its ${tier} address names "${address.purpose}", which is not registered for the ${tier} tier`);
    }
  };
  for (const def of defs) {
    check(def, def.system, 'system');
    check(def, def.org, 'org');
  }
  return problems;
}

/**
 * The registered system/org purpose that may be written in `tier`, or a
 * message saying why not. Used by the stores' write paths.
 *
 * @internal
 */
export function writablePurposeProblem(purpose: string, tier: CredentialTier): string | null {
  const def = credentialPurposeRegistry.get(purpose);
  if (!def) return `Credential purpose "${purpose}" is not registered (registerCredentialPurpose).`;
  if (!def.tiers.includes(tier)) return `Credential purpose "${purpose}" is not registered for the ${tier} tier.`;
  return null;
}
