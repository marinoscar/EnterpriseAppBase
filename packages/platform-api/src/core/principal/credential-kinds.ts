// =============================================================================
// The principal kind and credential kind registries (PP-14.14)
// =============================================================================
//
// Two small open vocabularies behind the closed unions of ADR 0001:
//
//   principal kind    who is calling, structurally: `user`, `node` (an app adds
//                     e.g. `service`)
//   credential kind   how the request authenticated: `session`, `device`, `pat`,
//                     `node` (an app adds e.g. `api-key`); each belongs to ONE
//                     principal kind
//
// The platform's own register through the same functions an app uses. The
// registries are the RUNTIME half; the compile-time half is the augmentable
// `PrincipalKinds` / `CredentialKinds` interfaces declared in `../index.ts`.
//
// ⚠ UNKNOWN MEANS DENIED. Registering a kind only makes its id known. The
// packaged guards and factories treat a kind that is not registered, or whose
// principal kind has no factory, as a refusal (`toPrincipal` of the identity
// slice throws, and `switchOrg` only ever accepts `session`). A credential kind
// never widens what any built-in kind may do: every built-in decision keys on
// the built-in ids, so a new kind starts with no privilege until the app's own
// guard grants it some.
//
// FRAMEWORK-FREE like the registry primitive.
// =============================================================================

import { defineRegistry, type Registry } from '../registry/registry';

/**
 * The pattern a principal kind or credential kind id matches: lower-case, 2 to
 * 32 characters, starting with a letter (`api-key`, `service`).
 *
 * @stability experimental
 */
export const KIND_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/**
 * One registered principal kind.
 *
 * @stability experimental
 * @example
 * ```ts
 * const kind: PrincipalKindDef = { id: 'service', description: 'An unattended integration acting for an organization.' };
 * ```
 */
export interface PrincipalKindDef {
  /** The kind id. See {@link KIND_ID_PATTERN}. */
  readonly id: string;
  /** One sentence: who this kind is. */
  readonly description: string;
}

/**
 * One registered credential kind.
 *
 * @stability experimental
 * @example
 * ```ts
 * const kind: CredentialKindDef = { id: 'api-key', principalKind: 'user', description: 'An `ak_` key a user minted for an integration.' };
 * ```
 */
export interface CredentialKindDef {
  /** The kind id. See {@link KIND_ID_PATTERN}. */
  readonly id: string;
  /** The id of a REGISTERED principal kind this credential authenticates as. */
  readonly principalKind: string;
  /** One sentence: what presents this credential and how it is issued. */
  readonly description: string;
}

function validateDescription(owner: string, id: string, description: unknown): void {
  if (typeof description !== 'string' || description.trim() === '') {
    throw new Error(`${owner} "${id}": description must be a non-empty string`);
  }
}

/**
 * Every registered principal kind: `user`, `node`, then the app's. Frozen once
 * the application has bootstrapped.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const principalKindRegistry: Registry<PrincipalKindDef> = defineRegistry<PrincipalKindDef>({
  name: 'core.principal-kinds',
  idOf: (kind) => kind.id,
  idPattern: KIND_ID_PATTERN,
  validate: (kind) => validateDescription('principal kind', kind.id, kind.description),
});

/**
 * Every registered credential kind: `session`, `device`, `pat`, `node`, then the
 * app's. Frozen once the application has bootstrapped.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const credentialKindRegistry: Registry<CredentialKindDef> = defineRegistry<CredentialKindDef>({
  name: 'core.credential-kinds',
  idOf: (kind) => kind.id,
  idPattern: KIND_ID_PATTERN,
  validate: (kind) => {
    validateDescription('credential kind', kind.id, kind.description);
    if (typeof kind.principalKind !== 'string' || !principalKindRegistry.has(kind.principalKind)) {
      throw new Error(
        `credential kind "${kind.id}": principalKind ${JSON.stringify(kind.principalKind)} is not a registered principal kind ` +
          `(registered: ${principalKindRegistry.ids().join(', ')}). Register it with registerPrincipalKind() first.`,
      );
    }
  },
});

/**
 * Registers a principal kind. Call it at module load, before the application is
 * created; a duplicate id throws.
 *
 * @param kind - the id and a one-sentence description.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```ts
 * registerPrincipalKind({ id: 'service', description: 'An unattended integration.' });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerPrincipalKind(kind: PrincipalKindDef): void {
  principalKindRegistry.register(kind);
}

/**
 * Registers a credential kind for an app's own authentication scheme (an API
 * key, a webhook token). Its `principalKind` must already be registered. Call it
 * at module load; a duplicate id throws.
 *
 * Registering the kind lets `toPrincipal` and the app's guards recognise it.
 * It confers no permission: the app's guard decides what the credential may do.
 *
 * @param kind - the id, the principal kind it authenticates as and a description.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY` (including an unregistered `principalKind`), `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```ts
 * // apps/api/src/app-registrations/core.ts
 * registerCredentialKind({ id: 'api-key', principalKind: 'user', description: 'An `ak_` key a user minted.' });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerCredentialKind(kind: CredentialKindDef): void {
  credentialKindRegistry.register(kind);
}

/**
 * Whether `value` is a registered credential kind.
 *
 * @param value - anything; a non-string is never a kind.
 * @returns `true` for a registered id.
 *
 * @stability experimental
 */
export function isCredentialKind(value: unknown): value is string {
  return typeof value === 'string' && credentialKindRegistry.has(value);
}

/**
 * Thrown by {@link requireCredentialKind} for a kind nobody registered: the
 * caller must treat the credential as unauthenticated.
 *
 * @stability experimental
 */
export class UnknownCredentialKindError extends Error {
  /** The unregistered kind, as presented. */
  readonly kind: unknown;

  /**
   * @param kind - the unregistered kind.
   */
  constructor(kind: unknown) {
    super(
      `Unknown credential kind ${JSON.stringify(kind)}. Registered kinds: ${credentialKindRegistry.ids().join(', ')}. ` +
        'Register one with registerCredentialKind() at import time.',
    );
    this.name = 'UnknownCredentialKindError';
    this.kind = kind;
  }
}

/**
 * The definition of a registered credential kind: the DEFAULT-DENY lookup a
 * guard calls before it trusts a kind.
 *
 * @param kind - the kind presented.
 * @returns its definition.
 * @throws UnknownCredentialKindError when it is not registered.
 *
 * @stability experimental
 * @example
 * ```ts
 * const def = requireCredentialKind(request.credentialKind); // throws for an unregistered kind
 * ```
 */
export function requireCredentialKind(kind: unknown): CredentialKindDef {
  const def = typeof kind === 'string' ? credentialKindRegistry.get(kind) : undefined;
  if (def === undefined) throw new UnknownCredentialKindError(kind);
  return def;
}

const BUILTIN_PRINCIPAL_KINDS: readonly PrincipalKindDef[] = [
  { id: 'user', description: 'A human caller: a browser session, a device-flow token or a personal access token.' },
  { id: 'node', description: 'An unattended worker node authenticated with a `nod_` credential.' },
];

const BUILTIN_CREDENTIAL_KINDS: readonly CredentialKindDef[] = [
  { id: 'session', principalKind: 'user', description: 'A browser access JWT (no `did` claim).' },
  { id: 'device', principalKind: 'user', description: 'An access JWT issued by the device authorization flow (`did` claim).' },
  { id: 'pat', principalKind: 'user', description: 'A `pat_` personal access token.' },
  { id: 'node', principalKind: 'node', description: 'A `nod_` worker-node credential, confined to `/api/nodes`.' },
];

for (const kind of BUILTIN_PRINCIPAL_KINDS) registerPrincipalKind(kind);
for (const kind of BUILTIN_CREDENTIAL_KINDS) registerCredentialKind(kind);
