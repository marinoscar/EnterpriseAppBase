// =============================================================================
// Metadata namespace registries (PP-14.27)
// =============================================================================
//
// `users.metadata` and `organizations.metadata` hold one top-level key per
// REGISTERED namespace; the value under it is validated against that
// namespace's zod schema on every write and every read. Two static registries on
// the #675 primitive (`defineRegistry`): a duplicate namespace throws at import,
// and the registry freezes once the application has bootstrapped, so an app
// registers at import time from `app-registrations/identity.ts`, never from
// `onModuleInit`.
//
// A namespace is PERMANENT once rows hold it (it is the JSON key), like a job
// type or a settings key: renaming one strands every stored value.
// =============================================================================

import { z } from 'zod';
import { defineRegistry, type Registry } from '../../core/index';
import { inspectMetadataSchema } from './metadata-secret-guard';

/**
 * Which row a metadata document lives on.
 *
 * @stability experimental
 */
export type MetadataSubject = 'user' | 'organization';

/**
 * A namespace's declaration: the key under which an app keeps its fields, and
 * the zod schema that validates them.
 *
 * @stability experimental
 */
export interface MetadataNamespaceDef<T = unknown> {
  /**
   * The JSON key. Lower-case words joined by `.`, `-` or `_` (`preferences.coach`), at most 63 characters. Permanent once rows hold it. Namespaces of one app should share a prefix it owns, so two packages never collide.
   */
  readonly namespace: string;
  /**
   * The shape of the value. A closed object schema: no `z.any()`, `z.unknown()` or loose object anywhere, and no property named like a secret (`password`, `apiKey`, `token`, `webhookSecret`, ...). Secrets go in the encrypted credential store, never here.
   */
  readonly schema: z.ZodType<T>;
  /** One line for the Doctor and the docs: what the namespace is for. */
  readonly description?: string;
}

/**
 * The typed handle a registration returns; pass it to the service's methods and
 * the value type follows from the schema.
 *
 * @stability experimental
 */
export interface MetadataNamespace<T = unknown> extends MetadataNamespaceDef<T> {
  /** The row kind the namespace belongs to. */
  readonly subject: MetadataSubject;
}

/** The namespace pattern: lower-case words joined by `.`, `-` or `_`. */
export const METADATA_NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

const NAMESPACE_MAX_LENGTH = 63;

function validateDef(subject: MetadataSubject): (def: MetadataNamespaceDef) => void {
  const register = subject === 'user' ? 'registerUserMetadataSchema' : 'registerOrganizationMetadataSchema';
  return (def) => {
    if (typeof def.namespace !== 'string' || def.namespace.length > NAMESPACE_MAX_LENGTH) {
      throw new Error(`namespace must be at most ${NAMESPACE_MAX_LENGTH} characters`);
    }
    if (!(def.schema instanceof z.ZodType)) throw new Error(`${register}: schema must be a zod schema`);
    let findings;
    try {
      findings = inspectMetadataSchema(def.schema);
    } catch (error) {
      throw new Error(`schema cannot be introspected (${(error as Error).message}); use a plain object schema without z.lazy`);
    }
    if (findings.rootNotObject) throw new Error('schema must be an object schema (z.object({ ... })): a namespace holds named fields');
    if (findings.secretFields.length > 0) {
      throw new Error(
        `schema declares secret-named field(s) ${findings.secretFields.join(', ')}; metadata is not a secret store: keep the secret in the encrypted credential store (user_credentials / credentials) and, at most, a "hasKey" flag here`,
      );
    }
    if (findings.openShapes.length > 0) {
      throw new Error(`schema leaves part of its shape open (${findings.openShapes.join(', ')}); declare every field so the namespace can be reviewed (no z.any(), z.unknown(), z.date() or loose objects)`);
    }
  };
}

function makeRegistry(subject: MetadataSubject): Registry<MetadataNamespaceDef> {
  return defineRegistry<MetadataNamespaceDef>({
    name: subject === 'user' ? 'user-metadata-schemas' : 'organization-metadata-schemas',
    idOf: (def) => def.namespace,
    idPattern: METADATA_NAMESPACE_PATTERN,
    validate: validateDef(subject),
    describeDuplicate: (existing, incoming) =>
      `${subject} metadata namespace "${incoming.namespace}" is already registered${existing.description ? ` (${existing.description})` : ''}; choose another namespace, prefixed with the owner.`,
  });
}

/**
 * Every registered `users.metadata` namespace. Read it; register with
 * {@link registerUserMetadataSchema}.
 *
 * @stability experimental
 */
export const userMetadataRegistry: Registry<MetadataNamespaceDef> = makeRegistry('user');

/**
 * Every registered `organizations.metadata` namespace. Read it; register with
 * {@link registerOrganizationMetadataSchema}.
 *
 * @stability experimental
 */
export const organizationMetadataRegistry: Registry<MetadataNamespaceDef> = makeRegistry('organization');

/**
 * Declares a namespace of `users.metadata` and returns its typed handle. Call
 * it at import time, before the application bootstraps.
 *
 * The schema is validated now (closed object, no secret-named field) and on
 * every write and read. The platform exposes no route over the document: an
 * app that wants a namespace over HTTP writes the route (or contributes to the
 * current-user response) and returns what it chooses.
 *
 * @param def - The namespace and its schema.
 * @returns The handle, `{ subject: 'user', namespace, schema }`.
 * @throws RegistryError `INVALID_ID` for a malformed namespace, `INVALID_ENTRY` for a schema that is not a closed object schema or declares a secret-named field, `DUPLICATE_ID` for a namespace already registered, `FROZEN` after bootstrap.
 *
 * @example
 * ```ts
 * export const coachPreferences = registerUserMetadataSchema({
 *   namespace: 'preferences.coach',
 *   schema: z.object({ reminderHour: z.number().int().min(0).max(23), weeklyDigest: z.boolean() }),
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerUserMetadataSchema<T>(def: MetadataNamespaceDef<T>): MetadataNamespace<T> {
  userMetadataRegistry.register(def as MetadataNamespaceDef);
  return { ...def, subject: 'user' };
}

/**
 * Declares a namespace of `organizations.metadata` and returns its typed
 * handle; the same contract as {@link registerUserMetadataSchema}.
 *
 * @param def - The namespace and its schema.
 * @returns The handle, `{ subject: 'organization', namespace, schema }`.
 * @throws RegistryError as {@link registerUserMetadataSchema}.
 *
 * @example
 * ```ts
 * export const coachProgram = registerOrganizationMetadataSchema({
 *   namespace: 'program.coach',
 *   schema: z.object({ seats: z.number().int().positive() }),
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerOrganizationMetadataSchema<T>(def: MetadataNamespaceDef<T>): MetadataNamespace<T> {
  organizationMetadataRegistry.register(def as MetadataNamespaceDef);
  return { ...def, subject: 'organization' };
}
