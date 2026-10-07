import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { SEMVER_PATTERN } from './semver.js';

const manifestEntrySchema = z
  .object({
    id: z.string().regex(/^\d{4}_[a-z0-9][a-z0-9_]*$/, 'expected NNNN_slug'),
    dir: z.string().regex(/^\d{4}_[a-z0-9][a-z0-9_]*$/, 'expected NNNN_slug'),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, 'expected 64 lower-case hex characters'),
    since: z.string().regex(SEMVER_PATTERN, 'expected a version such as 1.2.3 or 1.2.3-next.1'),
    slice: z.string().min(1),
    requires: z.array(z.string().min(1)),
    touches: z.array(z.string().min(1)).optional(),
  })
  .strict();

const manifestSchema = z.array(manifestEntrySchema);

/**
 * One migration of the package's linear, immutable history
 * (`migrations/manifest.json`).
 *
 * @stability experimental
 */
export interface ManifestEntry {
  /** `NNNN_slug`; the origin id of the migration is `platform:` plus this. */
  id: string;
  /** The directory under the package's `migrations/` folder holding `migration.sql`. */
  dir: string;
  /** SHA-256 of the package's `migration.sql` bytes. */
  sha256: string;
  /** The platform version that introduced the migration. */
  since: string;
  /** The slice that owns the migration. */
  slice: string;
  /** Slice ids that must appear in earlier entries. */
  requires: string[];
  /** Other slices whose tables the migration also changes; omitted when it touches none. */
  touches?: string[];
}

/**
 * A manifest file that failed validation.
 *
 * @stability experimental
 */
export class ManifestFormatError extends Error {
  /** @param message - What is wrong with the manifest. */
  constructor(message: string) {
    super(message);
    this.name = 'ManifestFormatError';
  }
}

/**
 * Parses and validates the text of `manifest.json`: a JSON array of entries
 * with unique ids and a strictly ascending four-digit sequence.
 *
 * @param text - The file contents.
 * @param source - A label for error messages (usually the path).
 * @returns The validated entries, in file order.
 * @throws ManifestFormatError when the JSON or an entry is invalid, an id repeats or the sequence is not strictly ascending.
 * @stability experimental
 */
export function parseManifest(text: string, source = 'manifest.json'): ManifestEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ManifestFormatError(`${source} is not valid JSON: ${(error as Error).message}`);
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new ManifestFormatError(`${source} is invalid: ${detail}`);
  }
  const seen = new Set<string>();
  let previous = 0;
  for (const entry of parsed.data) {
    if (entry.dir !== entry.id) throw new ManifestFormatError(`${source}: entry ${entry.id} has dir ${entry.dir}; they must match`);
    if (seen.has(entry.id)) throw new ManifestFormatError(`${source}: duplicate migration id ${entry.id}`);
    seen.add(entry.id);
    const sequence = Number(entry.id.slice(0, 4));
    if (sequence <= previous) {
      throw new ManifestFormatError(`${source}: ${entry.id} is out of sequence (the history is linear and strictly ascending)`);
    }
    previous = sequence;
  }
  return parsed.data;
}

/**
 * Reads and validates a package `manifest.json`.
 *
 * @param file - Path of the manifest.
 * @returns The validated entries.
 * @throws ManifestFormatError when the manifest is invalid (see {@link parseManifest}).
 * @stability experimental
 */
export function readManifest(file: string): ManifestEntry[] {
  return parseManifest(readFileSync(file, 'utf8'), file);
}

/**
 * The origin id of a package migration: `platform:` plus its id.
 *
 * @param entry - A manifest entry (or anything with its `id`).
 * @returns For example `platform:0001_initial`.
 * @stability experimental
 */
export function originIdOf(entry: Pick<ManifestEntry, 'id'>): string {
  return `platform:${entry.id}`;
}
