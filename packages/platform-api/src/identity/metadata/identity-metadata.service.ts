// =============================================================================
// IdentityMetadataService: the repository helpers over users.metadata and
// organizations.metadata (PP-14.27)
// =============================================================================
//
// Every method validates against the REGISTERED namespace schema, on the way
// in and on the way out, and writes one namespace at a time:
//
//   - a write is a read-modify-write under `SELECT ... FOR UPDATE` in one
//     transaction, so two writers of different namespaces never lose an update;
//   - the whole document stays at most 16 KiB of compact JSON (the column's
//     CHECK is a 32 KiB backstop, see the migration);
//   - an object key named like a secret is refused, wherever it sits;
//   - the document is never returned whole: a caller names a namespace.
//
// The helpers decide nothing about WHO may read or write: authorisation is the
// calling route's, exactly as for any other service. `users` and
// `organizations` have no row-level security, so the platform client is used as is.
// =============================================================================

import { Inject, Injectable } from '@nestjs/common';
import { PLATFORM_PRISMA } from '../../core/index';
import type { IdentityPrisma, IdentityTx } from '../data/identity-db';
import {
  organizationMetadataRegistry,
  userMetadataRegistry,
  type MetadataNamespace,
  type MetadataNamespaceDef,
  type MetadataSubject,
} from './metadata-registry';
import { findSecretKeys } from './metadata-secret-guard';

/**
 * The most a row's whole metadata document may hold, in bytes of compact JSON
 * (`JSON.stringify`). The database CHECK allows twice this as a backstop.
 *
 * @stability experimental
 */
export const METADATA_MAX_BYTES = 16 * 1024;

/**
 * Why a metadata operation was refused. Stable: callers may switch on it.
 *
 * - `UNKNOWN_NAMESPACE`: nothing registered the namespace (or the handle belongs to the other subject).
 * - `INVALID_VALUE`: the value does not satisfy the namespace's schema.
 * - `SECRET_KEY`: the value holds an object key named like a secret.
 * - `TOO_LARGE`: the document would exceed {@link METADATA_MAX_BYTES}.
 * - `SUBJECT_NOT_FOUND`: no such user or organization.
 * - `STORED_VALUE_INVALID`: the stored value no longer satisfies the schema (the schema changed without migrating the data).
 *
 * @stability experimental
 */
export type MetadataErrorCode =
  | 'UNKNOWN_NAMESPACE'
  | 'INVALID_VALUE'
  | 'SECRET_KEY'
  | 'TOO_LARGE'
  | 'SUBJECT_NOT_FOUND'
  | 'STORED_VALUE_INVALID';

/**
 * The error every metadata operation throws.
 *
 * @stability experimental
 */
export class MetadataError extends Error {
  /** Machine-readable reason; see {@link MetadataErrorCode}. */
  readonly code: MetadataErrorCode;

  /**
   * @param code - Why the operation was refused.
   * @param message - What is wrong and how to fix it.
   * @param options - The underlying error, when there is one.
   */
  constructor(code: MetadataErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MetadataError';
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Document = Record<string, unknown>;

/** Locks the subject's row and returns its document; `undefined` when there is no such row. */
async function lockDocument(tx: IdentityTx, subject: MetadataSubject, id: string): Promise<Document | undefined> {
  const rows =
    subject === 'user'
      ? await tx.$queryRaw<Array<{ metadata: Document }>>`SELECT "metadata" FROM "users" WHERE "id" = ${id}::uuid FOR UPDATE`
      : await tx.$queryRaw<Array<{ metadata: Document }>>`SELECT "metadata" FROM "organizations" WHERE "id" = ${id}::uuid FOR UPDATE`;
  return rows[0]?.metadata;
}

async function writeDocument(tx: IdentityTx, subject: MetadataSubject, id: string, document: Document): Promise<void> {
  const json = JSON.stringify(document);
  if (subject === 'user') await tx.$executeRaw`UPDATE "users" SET "metadata" = ${json}::jsonb WHERE "id" = ${id}::uuid`;
  else await tx.$executeRaw`UPDATE "organizations" SET "metadata" = ${json}::jsonb WHERE "id" = ${id}::uuid`;
}

/**
 * Reads and writes the namespaced metadata of users and organizations. Inject
 * it anywhere (`IdentityModule` is global).
 *
 * @example
 * ```ts
 * @Injectable()
 * class CoachPreferencesService {
 *   constructor(private readonly metadata: IdentityMetadataService) {}
 *   get(userId: string) { return this.metadata.getUserMetadata(userId, coachPreferences); }
 * }
 * ```
 *
 * @stability experimental
 */
@Injectable()
export class IdentityMetadataService {
  /** @param prisma - The app's client, from the core port `PLATFORM_PRISMA`. */
  constructor(@Inject(PLATFORM_PRISMA) private readonly prisma: IdentityPrisma) {}

  /**
   * The value of one namespace of a user's metadata.
   *
   * @param userId - The user's id.
   * @param namespace - A registered namespace, or the handle `registerUserMetadataSchema` returned (which types the result).
   * @returns The validated value, or `undefined` when the user has none under it.
   * @throws MetadataError `UNKNOWN_NAMESPACE`, `SUBJECT_NOT_FOUND`, `STORED_VALUE_INVALID`.
   */
  getUserMetadata<T = unknown>(userId: string, namespace: string | MetadataNamespace<T>): Promise<T | undefined> {
    return this.read<T>('user', userId, namespace);
  }

  /**
   * Replaces one namespace of a user's metadata.
   *
   * @param userId - The user's id.
   * @param namespace - A registered namespace or its handle.
   * @param value - The new value; validated against the namespace's schema.
   * @returns The stored value (the schema's output, so transforms and stripping apply).
   * @throws MetadataError `UNKNOWN_NAMESPACE`, `INVALID_VALUE`, `SECRET_KEY`, `TOO_LARGE`, `SUBJECT_NOT_FOUND`.
   */
  setUserMetadata<T = unknown>(userId: string, namespace: string | MetadataNamespace<T>, value: unknown): Promise<T> {
    return this.write<T>('user', userId, namespace, () => value);
  }

  /**
   * Changes one namespace of a user's metadata from its current value, under a
   * row lock: the read and the write are one step.
   *
   * @param userId - The user's id.
   * @param namespace - A registered namespace or its handle.
   * @param change - Receives the current value (`undefined` when none) and returns the new one.
   * @returns The stored value.
   * @throws MetadataError as {@link IdentityMetadataService.setUserMetadata}, plus `STORED_VALUE_INVALID`.
   */
  updateUserMetadata<T = unknown>(userId: string, namespace: string | MetadataNamespace<T>, change: (current: T | undefined) => unknown): Promise<T> {
    return this.write<T>('user', userId, namespace, change);
  }

  /**
   * Removes one namespace from a user's metadata. A no-op when it is absent.
   *
   * @param userId - The user's id.
   * @param namespace - A registered namespace or its handle.
   * @throws MetadataError `UNKNOWN_NAMESPACE`, `SUBJECT_NOT_FOUND`.
   */
  deleteUserMetadata(userId: string, namespace: string | MetadataNamespace): Promise<void> {
    return this.remove('user', userId, namespace);
  }

  /**
   * The value of one namespace of an organization's metadata.
   *
   * @param orgId - The organization's id.
   * @param namespace - A registered namespace, or the handle `registerOrganizationMetadataSchema` returned.
   * @returns The validated value, or `undefined` when the organization has none under it.
   * @throws MetadataError `UNKNOWN_NAMESPACE`, `SUBJECT_NOT_FOUND`, `STORED_VALUE_INVALID`.
   */
  getOrganizationMetadata<T = unknown>(orgId: string, namespace: string | MetadataNamespace<T>): Promise<T | undefined> {
    return this.read<T>('organization', orgId, namespace);
  }

  /**
   * Replaces one namespace of an organization's metadata.
   *
   * @param orgId - The organization's id.
   * @param namespace - A registered namespace or its handle.
   * @param value - The new value; validated against the namespace's schema.
   * @returns The stored value.
   * @throws MetadataError `UNKNOWN_NAMESPACE`, `INVALID_VALUE`, `SECRET_KEY`, `TOO_LARGE`, `SUBJECT_NOT_FOUND`.
   */
  setOrganizationMetadata<T = unknown>(orgId: string, namespace: string | MetadataNamespace<T>, value: unknown): Promise<T> {
    return this.write<T>('organization', orgId, namespace, () => value);
  }

  /**
   * Changes one namespace of an organization's metadata from its current
   * value, under a row lock.
   *
   * @param orgId - The organization's id.
   * @param namespace - A registered namespace or its handle.
   * @param change - Receives the current value (`undefined` when none) and returns the new one.
   * @returns The stored value.
   * @throws MetadataError as {@link IdentityMetadataService.setOrganizationMetadata}, plus `STORED_VALUE_INVALID`.
   */
  updateOrganizationMetadata<T = unknown>(orgId: string, namespace: string | MetadataNamespace<T>, change: (current: T | undefined) => unknown): Promise<T> {
    return this.write<T>('organization', orgId, namespace, change);
  }

  /**
   * Removes one namespace from an organization's metadata. A no-op when it is absent.
   *
   * @param orgId - The organization's id.
   * @param namespace - A registered namespace or its handle.
   * @throws MetadataError `UNKNOWN_NAMESPACE`, `SUBJECT_NOT_FOUND`.
   */
  deleteOrganizationMetadata(orgId: string, namespace: string | MetadataNamespace): Promise<void> {
    return this.remove('organization', orgId, namespace);
  }

  // ---- internals ------------------------------------------------------------------------

  private definition(subject: MetadataSubject, namespace: string | MetadataNamespace): MetadataNamespaceDef {
    const name = typeof namespace === 'string' ? namespace : namespace.namespace;
    const registry = subject === 'user' ? userMetadataRegistry : organizationMetadataRegistry;
    const found = registry.get(name);
    const register = subject === 'user' ? 'registerUserMetadataSchema' : 'registerOrganizationMetadataSchema';
    if (!found || (typeof namespace !== 'string' && namespace.subject !== subject)) {
      throw new MetadataError('UNKNOWN_NAMESPACE', `no ${subject} metadata namespace "${name}" is registered; call ${register}({ namespace, schema }) at import time`);
    }
    return found;
  }

  private assertId(subject: MetadataSubject, id: string): void {
    if (typeof id !== 'string' || !UUID.test(id)) throw new MetadataError('SUBJECT_NOT_FOUND', `no ${subject} with id "${String(id)}"`);
  }

  private parseStored<T>(def: MetadataNamespaceDef, stored: unknown): T {
    const parsed = def.schema.safeParse(stored);
    if (!parsed.success) {
      throw new MetadataError(
        'STORED_VALUE_INVALID',
        `the stored value of metadata namespace "${def.namespace}" no longer satisfies its schema (${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}); migrate the data when the schema changes`,
        { cause: parsed.error },
      );
    }
    return parsed.data as T;
  }

  private async read<T>(subject: MetadataSubject, id: string, namespace: string | MetadataNamespace): Promise<T | undefined> {
    const def = this.definition(subject, namespace);
    this.assertId(subject, id);
    const rows =
      subject === 'user'
        ? await this.prisma.$queryRaw<Array<{ value: unknown }>>`SELECT "metadata" -> ${def.namespace}::text AS "value" FROM "users" WHERE "id" = ${id}::uuid`
        : await this.prisma.$queryRaw<Array<{ value: unknown }>>`SELECT "metadata" -> ${def.namespace}::text AS "value" FROM "organizations" WHERE "id" = ${id}::uuid`;
    if (rows.length === 0) throw new MetadataError('SUBJECT_NOT_FOUND', `no ${subject} with id "${id}"`);
    const stored = rows[0]!.value;
    return stored === null || stored === undefined ? undefined : this.parseStored<T>(def, stored);
  }

  private async write<T>(subject: MetadataSubject, id: string, namespace: string | MetadataNamespace, change: (current: T | undefined) => unknown): Promise<T> {
    const def = this.definition(subject, namespace);
    this.assertId(subject, id);
    return this.prisma.$transaction(async (tx) => {
      const document = await lockDocument(tx, subject, id);
      if (document === undefined) throw new MetadataError('SUBJECT_NOT_FOUND', `no ${subject} with id "${id}"`);
      const current = document[def.namespace];
      const next = change(current === undefined || current === null ? undefined : this.parseStored<T>(def, current));
      const parsed = def.schema.safeParse(next);
      if (!parsed.success) {
        throw new MetadataError(
          'INVALID_VALUE',
          `the value for metadata namespace "${def.namespace}" is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`,
          { cause: parsed.error },
        );
      }
      const secrets = findSecretKeys(parsed.data);
      if (secrets.length > 0) {
        throw new MetadataError('SECRET_KEY', `metadata is not a secret store: the value for "${def.namespace}" holds secret-named key(s) ${secrets.join(', ')}; keep secrets in the encrypted credential store`);
      }
      const merged: Document = { ...document, [def.namespace]: parsed.data };
      const size = Buffer.byteLength(JSON.stringify(merged), 'utf8');
      if (size > METADATA_MAX_BYTES) {
        throw new MetadataError('TOO_LARGE', `the ${subject} metadata document would be ${size} bytes, over the ${METADATA_MAX_BYTES} byte limit; keep large data in its own table`);
      }
      await writeDocument(tx, subject, id, merged);
      return parsed.data as T;
    });
  }

  private async remove(subject: MetadataSubject, id: string, namespace: string | MetadataNamespace): Promise<void> {
    const def = this.definition(subject, namespace);
    this.assertId(subject, id);
    await this.prisma.$transaction(async (tx) => {
      const document = await lockDocument(tx, subject, id);
      if (document === undefined) throw new MetadataError('SUBJECT_NOT_FOUND', `no ${subject} with id "${id}"`);
      if (!(def.namespace in document)) return;
      const { [def.namespace]: _removed, ...rest } = document;
      await writeDocument(tx, subject, id, rest);
    });
  }
}
