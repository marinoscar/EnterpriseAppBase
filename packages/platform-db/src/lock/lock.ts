import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { SEMVER_PATTERN } from './semver.js';

/** The lock file format version this release reads and writes. */
const LOCK_VERSION = 1 as const;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'expected 64 lower-case hex characters');
// Semver, prerelease allowed: a prerelease package (0.1.0-next.1) writes its own version into the lock.
const versionSchema = z.string().regex(SEMVER_PATTERN, 'expected a version such as 1.2.3 or 1.2.3-next.1');

const lockEntrySchema = z
  .object({
    originId: z.string().regex(/^platform:\d{4}_[a-z0-9][a-z0-9_]*$/, 'expected platform:NNNN_slug'),
    localDir: z
      .string()
      .min(1)
      .refine((v) => !/[\\/]/.test(v) && v !== '.' && v !== '..', 'must be a bare directory name'),
    sha256: sha256Schema,
    since: versionSchema,
    localSha256: sha256Schema.optional(),
    note: z.string().min(1).optional(),
  })
  .strict()
  .refine((e) => (e.localSha256 === undefined) === (e.note === undefined), {
    message: 'localSha256 and note are recorded together (a comment-only divergence must say why)',
  });

const lockSchema = z
  .object({
    lockVersion: z.literal(LOCK_VERSION),
    platformVersion: versionSchema,
    migrations: z.array(lockEntrySchema),
    deviations: z
      .array(z.object({ id: z.string().min(1), reason: z.string().min(1), expectDiff: z.array(z.string()) }).strict())
      .optional(),
    rawSqlIndexes: z.array(z.object({ name: z.string().min(1), definition: z.string().min(1) }).strict()).optional(),
  })
  .strict();

/**
 * One installed (or mapped) platform migration in the app's `platform.lock`.
 *
 * @stability experimental
 */
export interface LockEntry {
  /** `platform:` plus the package directory, for example `platform:0001_initial`. */
  originId: string;
  /** The app's directory name under `prisma/migrations`; it may differ from the package slug. */
  localDir: string;
  /** SHA-256 of the package file's bytes; equals Prisma's `_prisma_migrations.checksum` for a byte copy. */
  sha256: string;
  /** The platform version that introduced the migration for this app. */
  since: string;
  /** SHA-256 of the app's file, present only for a recorded comment-only divergence. */
  localSha256?: string;
  /** Why the app's file differs from the package's; present with `localSha256`. */
  note?: string;
}

/**
 * The app's declared alteration of a package-owned table (read by the baseline tooling).
 *
 * @stability experimental
 */
export interface LockDeviation {
  /** Stable id, `<app>:<name>`. */
  id: string;
  /** Why the app alters a package-owned table. */
  reason: string;
  /** The normalised statements `prisma migrate diff` is expected to print for it. */
  expectDiff: string[];
}

/**
 * A raw-SQL index the app owns, asserted by the drift test against `pg_indexes`.
 *
 * @stability experimental
 */
export interface RawSqlIndex {
  /** The index name. */
  name: string;
  /** `pg_indexes.indexdef` of the index. */
  definition: string;
}

/**
 * The contents of `prisma/platform.lock`: proof that the app's installed
 * migrations are byte-identical to the package's.
 *
 * @stability experimental
 */
export interface PlatformLock {
  /** The lock format version; a reader refuses a higher value. */
  lockVersion: 1;
  /** The package version the history was last synced to. */
  platformVersion: string;
  /** One entry per installed or mapped package migration, in package order. */
  migrations: LockEntry[];
  /** Declared alterations of package-owned tables. */
  deviations?: LockDeviation[];
  /** The app's own raw-SQL indexes. */
  rawSqlIndexes?: RawSqlIndex[];
}

/**
 * A lock file that failed validation, with the offending path.
 *
 * @stability experimental
 */
export class LockFormatError extends Error {
  /** @param message - What is wrong with the file. */
  constructor(message: string) {
    super(message);
    this.name = 'LockFormatError';
  }
}

function describeIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`).join('; ');
}

/**
 * Parses and validates the text of a `platform.lock`.
 *
 * @param text - The file contents.
 * @param source - A label for error messages (usually the path).
 * @returns The validated lock.
 * @throws LockFormatError when the JSON is invalid or does not match the schema, or the lock version is newer than this release reads.
 * @stability experimental
 */
export function parseLock(text: string, source = 'platform.lock'): PlatformLock {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new LockFormatError(`${source} is not valid JSON: ${(error as Error).message}`);
  }
  const version = (raw as { lockVersion?: unknown } | null)?.lockVersion;
  if (typeof version === 'number' && version > LOCK_VERSION) {
    throw new LockFormatError(
      `${source} has lockVersion ${version}; this release reads ${LOCK_VERSION}. Upgrade @marinoscar/platform-db.`,
    );
  }
  const parsed = lockSchema.safeParse(raw);
  if (!parsed.success) throw new LockFormatError(`${source} is invalid: ${describeIssues(parsed.error)}`);
  return parsed.data;
}

/**
 * Reads and validates a `platform.lock`.
 *
 * @param file - Path of the lock file.
 * @returns The validated lock.
 * @throws LockFormatError when the file is invalid (see {@link parseLock}).
 * @stability experimental
 */
export function readLock(file: string): PlatformLock {
  return parseLock(readFileSync(file, 'utf8'), file);
}

/**
 * An empty lock for an app that has installed nothing.
 *
 * @param platformVersion - The package version, default `0.0.0`.
 * @returns A lock with no migrations.
 * @stability experimental
 */
export function emptyLock(platformVersion = '0.0.0'): PlatformLock {
  return { lockVersion: LOCK_VERSION, platformVersion, migrations: [] };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/**
 * Serialises a lock (or any manifest-shaped JSON) deterministically: keys
 * sorted at every level, arrays in their given order, two-space indent, one
 * trailing newline. The same input always produces the same bytes, so diffs
 * stay stable.
 *
 * @param value - The lock, or any JSON value.
 * @returns The file contents.
 * @stability experimental
 */
export function serializeJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

/**
 * Serialises a lock for writing to `platform.lock`.
 *
 * @param lock - The lock.
 * @returns The file contents (see {@link serializeJson}).
 * @stability experimental
 */
export function serializeLock(lock: PlatformLock): string {
  return serializeJson(lock);
}
