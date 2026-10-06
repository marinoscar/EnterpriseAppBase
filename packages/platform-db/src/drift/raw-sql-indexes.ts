import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { RawSqlIndex } from '../lock/index.js';

const packageIndexSchema = z
  .object({
    name: z.string().min(1),
    definition: z.string().min(1),
    reason: z.string().min(1),
    createdBy: z.string().min(1),
  })
  .strict();

const packageListSchema = z.object({ indexes: z.array(packageIndexSchema) }).strict();

/**
 * A raw-SQL index the package ships, with why it exists.
 *
 * @stability experimental
 */
export interface PackageRawSqlIndex extends RawSqlIndex {
  /** One line: why Prisma cannot express it and what it enforces. */
  reason: string;
  /** The migration directory that creates it. */
  createdBy: string;
}

/**
 * A row of `pg_indexes`: an index name and its `indexdef`.
 *
 * @stability experimental
 */
export interface IndexRow {
  /** The index name. */
  name: string;
  /** `pg_indexes.indexdef`. */
  definition: string;
}

/**
 * Reads the package's `raw-sql-indexes.json`: partial and expression indexes
 * that exist only in migration SQL because Prisma cannot express them.
 *
 * @param file - Path of the JSON file.
 * @returns The indexes, in file order.
 * @throws Error when the file is not valid.
 * @stability experimental
 */
export function readPackageRawSqlIndexes(file: string): PackageRawSqlIndex[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`);
  }
  const parsed = packageListSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${file} is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return parsed.data.indexes;
}

/**
 * The class of a raw-SQL index failure.
 *
 * - `INDEX_MISSING`: the index is not in `pg_indexes`.
 * - `INDEX_DEFINITION_DIFFERS`: the index exists with another definition (for example a unique index re-created without its `WHERE` clause).
 *
 * @stability experimental
 */
export type RawIndexProblemCode = 'INDEX_MISSING' | 'INDEX_DEFINITION_DIFFERS';

/**
 * One raw-SQL index that is missing or changed.
 *
 * @stability experimental
 */
export interface RawIndexProblem {
  /** The class of failure. */
  code: RawIndexProblemCode;
  /** The index name. */
  name: string;
  /** A one-line explanation. */
  message: string;
}

/**
 * Collapses whitespace so a definition compares equal across formatting.
 *
 * @param definition - `pg_indexes.indexdef`.
 * @returns The definition with runs of whitespace as one space, trimmed.
 * @stability experimental
 */
export function normaliseIndexDefinition(definition: string): string {
  return definition.replace(/\s+/g, ' ').trim();
}

/**
 * The positive assertion of the drift test: every expected raw-SQL index
 * exists in the database with the recorded definition. `prisma migrate diff`
 * ignores partial and expression indexes in both directions, so a dropped or
 * weakened one is invisible to it; this is what catches that. It is an
 * assertion, not a filter over diff output.
 *
 * @param expected - The package's list plus the app's (`platform.lock` `rawSqlIndexes`).
 * @param live - `name` and `indexdef` rows of `pg_indexes`.
 * @returns Every missing or changed index.
 * @stability experimental
 */
export function checkRawSqlIndexes(
  expected: readonly RawSqlIndex[],
  live: readonly IndexRow[],
): RawIndexProblem[] {
  const byName = new Map(live.map((row) => [row.name, row.definition]));
  const problems: RawIndexProblem[] = [];
  for (const index of expected) {
    const actual = byName.get(index.name);
    if (actual === undefined) {
      problems.push({ code: 'INDEX_MISSING', name: index.name, message: `${index.name}: not in pg_indexes` });
    } else if (normaliseIndexDefinition(actual) !== normaliseIndexDefinition(index.definition)) {
      problems.push({
        code: 'INDEX_DEFINITION_DIFFERS',
        name: index.name,
        message: `${index.name}: the live definition differs\n  expected: ${normaliseIndexDefinition(index.definition)}\n  actual:   ${normaliseIndexDefinition(actual)}`,
      });
    }
  }
  return problems;
}

/**
 * Whether an `indexdef` is a raw-SQL index: partial (` WHERE `) or keyed on an
 * expression (a parenthesised or function key). Used by the tripwire that
 * derives the list from the catalogue so an unlisted raw-SQL index fails the
 * build.
 *
 * @param definition - `pg_indexes.indexdef`.
 * @returns True for a partial or expression index.
 * @stability experimental
 */
export function isRawSqlIndex(definition: string): boolean {
  return / WHERE /.test(definition) || / USING \w+ \([^()]*\(/.test(definition);
}
