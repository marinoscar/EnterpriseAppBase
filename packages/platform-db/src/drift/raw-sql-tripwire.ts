import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ManifestEntry } from '../lock/index.js';
import { RAW_SQL_INDEXES, type PackageRawSqlIndex } from './raw-sql-indexes.js';

/**
 * A raw-SQL index found by reading migration SQL: partial (`WHERE`) or keyed
 * on an expression, which Prisma's schema language cannot express.
 *
 * @stability experimental
 */
export interface ScannedIndex {
  /** The index name. */
  name: string;
  /** The table, unquoted and without a schema. */
  table: string;
  /** Whether it is a unique index. */
  unique: boolean;
  /** The key columns in order, or `null` when any key element is an expression. */
  columns: string[] | null;
  /** The migration id that first creates an index of this name. */
  createdIn: string;
}

/**
 * The class of a tripwire failure.
 *
 * - `UNLISTED_RAW_INDEX`: a migration creates a partial or expression index that `RAW_SQL_INDEXES` does not list.
 * - `LISTED_INDEX_NOT_FOUND`: a listed index is not created (or is dropped) by the migrations, or is no longer partial or expression.
 * - `LISTED_INDEX_MISMATCH`: the listed table, uniqueness or `createdIn` disagrees with the migrations.
 * - `FRAGMENT_DECLARES_RAW_INDEX`: a schema fragment declares `@@unique`, `@@index` or `@unique` under a listed index's name or on its key columns.
 *
 * @stability experimental
 */
export type TripwireProblemCode =
  | 'UNLISTED_RAW_INDEX'
  | 'LISTED_INDEX_NOT_FOUND'
  | 'LISTED_INDEX_MISMATCH'
  | 'FRAGMENT_DECLARES_RAW_INDEX';

/**
 * One tripwire failure.
 *
 * @stability experimental
 */
export interface TripwireProblem {
  /** The class of failure. */
  code: TripwireProblemCode;
  /** The index name. */
  name: string;
  /** A one-line explanation naming the migration or fragment and the fix. */
  message: string;
}

/** Removes `--` and block comments and splits on top-level semicolons; quotes are respected. */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i += 1;
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      i += 2;
      current += ' ';
    } else if (c === "'" || c === '"') {
      const quote = c;
      current += c;
      i += 1;
      while (i < n) {
        current += sql[i]!;
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            current += sql[i + 1]!;
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
    } else if (c === ';') {
      statements.push(current.trim());
      current = '';
      i += 1;
    } else {
      current += c;
      i += 1;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements.filter((s) => s !== '');
}

const IDENT = '(?:"[^"]+"|[A-Za-z_][\\w$]*)';
const CREATE_INDEX = new RegExp(
  `^CREATE\\s+(UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENT})\\s+ON\\s+(?:ONLY\\s+)?(${IDENT}(?:\\.${IDENT})?)\\s*(?:USING\\s+\\w+\\s*)?\\(`,
  'i',
);
const DROP_INDEX = /^DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(.+)$/is;
const RENAME_INDEX = new RegExp(`^ALTER\\s+INDEX\\s+(?:IF\\s+EXISTS\\s+)?(${IDENT}(?:\\.${IDENT})?)\\s+RENAME\\s+TO\\s+(${IDENT})$`, 'i');
const PLAIN_KEY = /^(?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s+(?:ASC|DESC|NULLS\s+(?:FIRST|LAST)|[A-Za-z_]\w*_ops))*$/i;

const unquote = (ident: string): string => (ident.startsWith('"') ? ident.slice(1, -1) : ident.toLowerCase());
const unqualify = (qualified: string): string => {
  const parts = qualified.match(new RegExp(IDENT, 'g')) ?? [qualified];
  return unquote(parts[parts.length - 1]!);
};

/** Splits on commas outside parentheses, brackets and quotes. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const c of text) {
    if (quote) {
      current += c;
      if (c === quote) quote = '';
    } else if (c === "'" || c === '"') {
      quote = c;
      current += c;
    } else if (c === '(' || c === '[') {
      depth += 1;
      current += c;
    } else if (c === ')' || c === ']') {
      depth -= 1;
      current += c;
    } else if (c === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** The text inside the parenthesis opened at `open`, and what follows its closing one. */
function balanced(text: string, open: number): { inner: string; rest: string } | undefined {
  let depth = 0;
  let quote = '';
  for (let i = open; i < text.length; i += 1) {
    const c = text[i]!;
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === "'" || c === '"') quote = c;
    else if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return { inner: text.slice(open + 1, i), rest: text.slice(i + 1) };
    }
  }
  return undefined;
}

interface Created extends ScannedIndex {
  raw: boolean;
}

/**
 * Reads the indexes that migration SQL leaves behind, in statement order:
 * `CREATE [UNIQUE] INDEX` adds one, `DROP INDEX` removes it, `ALTER INDEX ...
 * RENAME TO` renames it. Comments are ignored. An index is raw when it has a
 * `WHERE` clause or any key element that is an expression.
 *
 * @param migrations - `[id, sql]` pairs in history order.
 * @returns The raw-SQL indexes that survive the whole history, in creation order.
 * @stability experimental
 */
export function scanRawSqlIndexes(migrations: ReadonlyArray<readonly [string, string]>): ScannedIndex[] {
  const live = new Map<string, Created>();
  const firstCreated = new Map<string, string>();
  for (const [id, sql] of migrations) {
    for (const statement of splitStatements(sql)) {
      const create = CREATE_INDEX.exec(statement);
      if (create) {
        const name = unquote(create[2]!);
        const open = create[0].length - 1;
        const group = balanced(statement, open);
        if (!group) continue;
        const elements = splitTopLevel(group.inner);
        const plain = elements.every((e) => PLAIN_KEY.test(e));
        const partial = /\bWHERE\b/i.test(group.rest);
        if (!firstCreated.has(name)) firstCreated.set(name, id);
        live.set(name, {
          name,
          table: unqualify(create[3]!),
          unique: Boolean(create[1]),
          columns: plain ? elements.map((e) => unquote(e.split(/\s+/)[0]!)) : null,
          createdIn: firstCreated.get(name)!,
          raw: partial || !plain,
        });
        continue;
      }
      const drop = DROP_INDEX.exec(statement);
      if (drop) {
        for (const target of splitTopLevel(drop[1]!.replace(/\s+(CASCADE|RESTRICT)\s*$/i, ''))) live.delete(unqualify(target));
        continue;
      }
      const rename = RENAME_INDEX.exec(statement);
      if (rename) {
        const from = unqualify(rename[1]!);
        const to = unquote(rename[2]!);
        const found = live.get(from);
        if (found) {
          live.delete(from);
          live.set(to, { ...found, name: to });
        }
      }
    }
  }
  return [...live.values()]
    .filter((index) => index.raw)
    .map(({ raw: _raw, ...index }) => index);
}

/**
 * One `@@unique`, `@@index` or field-level `@unique` found in a fragment.
 *
 * @stability experimental
 */
export interface FragmentIndex {
  file: string;
  line: number;
  model: string;
  table: string;
  kind: '@@unique' | '@@index' | '@unique';
  /** Database column names in key order. */
  columns: string[];
  /** The database name given with `map:` or `name:`, when there is one. */
  names: string[];
}

const MODEL_HEADER = /^model\s+([A-Za-z_]\w*)\s*\{\s*$/;
const MAP_ATTR = /@map\(\s*"([^"]+)"\s*\)/;
const BLOCK_ATTR = /^@@(unique|index)\s*\((.*)\)\s*(?:\/\/.*)?$/;
const FIELD_LINE = /^([A-Za-z_]\w*)\s+[A-Za-z_]\w*(?:\([^)]*\))?(?:\[\])?\??(\s.*)?$/;

/**
 * Reads every model's index declarations out of `prisma format`-shaped schema
 * text: `@@unique`, `@@index` and single-field `@unique`, with Prisma field
 * names translated to database column names through `@map`.
 *
 * @param file - A label for messages.
 * @param text - The fragment's text.
 * @returns One entry per declaration.
 * @stability experimental
 */
export function scanFragmentIndexes(file: string, text: string): FragmentIndex[] {
  const found: FragmentIndex[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let model: { name: string; start: number; body: Array<{ text: string; line: number }> } | undefined;
  const flush = (): void => {
    if (!model) return;
    const columnOf = new Map<string, string>();
    let table = model.name;
    for (const { text: line } of model.body) {
      const t = line.trim();
      const attr = /^@@map\(\s*"([^"]+)"\s*\)/.exec(t);
      if (attr) table = attr[1]!;
      const field = FIELD_LINE.exec(t);
      if (field && !t.startsWith('@@') && !t.startsWith('//')) columnOf.set(field[1]!, MAP_ATTR.exec(field[2] ?? '')?.[1] ?? field[1]!);
    }
    const toColumn = (name: string): string => columnOf.get(name) ?? name;
    for (const { text: line, line: lineNo } of model.body) {
      const t = line.trim();
      const block = BLOCK_ATTR.exec(t);
      if (block) {
        const args = splitTopLevel(block[2]!);
        const list = /^\[(.*)\]$/s.exec(args[0] ?? '');
        if (!list) continue;
        const columns = splitTopLevel(list[1]!).map((e) => toColumn(e.replace(/\(.*$/s, '').trim()));
        const names = args.slice(1).flatMap((a) => {
          const m = /^(?:map|name)\s*:\s*"([^"]+)"$/.exec(a.trim());
          return m ? [m[1]!] : [];
        });
        found.push({ file, line: lineNo, model: model.name, table, kind: block[1] === 'unique' ? '@@unique' : '@@index', columns, names });
        continue;
      }
      const field = FIELD_LINE.exec(t);
      if (field && !t.startsWith('//') && /(^|\s)@unique\b/.test(field[2] ?? '')) {
        const given = /@unique\([^)]*map\s*:\s*"([^"]+)"/.exec(field[2] ?? '');
        found.push({ file, line: lineNo, model: model.name, table, kind: '@unique', columns: [toColumn(field[1]!)], names: given ? [given[1]!] : [] });
      }
    }
    model = undefined;
  };
  lines.forEach((text, i) => {
    if (!model) {
      const header = MODEL_HEADER.exec(text);
      if (header) model = { name: header[1]!, start: i + 1, body: [] };
    } else if (text === '}') {
      flush();
    } else {
      model.body.push({ text, line: i + 1 });
    }
  });
  return found;
}

/**
 * What {@link checkRawSqlIndexSources} reads.
 *
 * @stability experimental
 */
export interface TripwireInput {
  /** The package history, in order. */
  manifest: readonly Pick<ManifestEntry, 'id' | 'dir'>[];
  /** Reads a package migration's SQL by directory; `undefined` when it does not exist. */
  readMigration: (dir: string) => string | undefined;
  /** Every schema fragment: a label and its text. */
  fragments: ReadonlyArray<{ file: string; text: string }>;
  /** The list to hold the migrations to; default {@link RAW_SQL_INDEXES}. */
  listed?: ReadonlyArray<PackageRawSqlIndex>;
}

const sameColumns = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((c, i) => c === b[i]);

/**
 * The raw-SQL index tripwire, as a pure function. It fails when
 *
 * - a migration creates a partial or expression index that is not listed,
 * - a listed index is not created by the migrations (or no longer partial or expression), or its table, uniqueness or `createdIn` disagree,
 * - a schema fragment declares `@@unique`, `@@index` or `@unique` under a listed index's name, or on the same table and key columns.
 *
 * The last rule is the CLAUDE.md invariant in executable form: the indexes
 * are intentional schema drift, never "fixed" with `@@unique`.
 *
 * @param input - See {@link TripwireInput}.
 * @returns Every problem found, in a stable order; empty when the tripwire holds.
 * @stability experimental
 */
export function checkRawSqlIndexSources(input: TripwireInput): TripwireProblem[] {
  const listed = input.listed ?? RAW_SQL_INDEXES;
  const problems: TripwireProblem[] = [];
  const migrations: Array<[string, string]> = [];
  for (const entry of input.manifest) {
    const sql = input.readMigration(entry.dir);
    if (sql === undefined) {
      problems.push({ code: 'LISTED_INDEX_NOT_FOUND', name: entry.id, message: `${entry.id}: migrations/${entry.dir}/migration.sql does not exist, so it cannot be scanned` });
      continue;
    }
    migrations.push([entry.id, sql]);
  }
  const found = scanRawSqlIndexes(migrations);
  const byName = new Map(found.map((index) => [index.name, index]));
  const listedNames = new Set(listed.map((index) => index.name));

  for (const index of found) {
    if (!listedNames.has(index.name)) {
      problems.push({
        code: 'UNLISTED_RAW_INDEX',
        name: index.name,
        message: `${index.name}: ${index.createdIn} creates a partial or expression index on ${index.table} that RAW_SQL_INDEXES does not list; add it to raw-sql-indexes.json with its reason and document it`,
      });
    }
  }
  for (const index of listed) {
    const actual = byName.get(index.name);
    if (!actual) {
      problems.push({
        code: 'LISTED_INDEX_NOT_FOUND',
        name: index.name,
        message: `${index.name}: listed in RAW_SQL_INDEXES but no migration leaves a partial or expression index of that name`,
      });
      continue;
    }
    const differences: string[] = [];
    if (actual.table !== index.table) differences.push(`table ${actual.table} (listed ${index.table})`);
    if (actual.unique !== index.unique) differences.push(`unique=${actual.unique} (listed ${index.unique})`);
    if (actual.createdIn !== index.createdIn) differences.push(`created in ${actual.createdIn} (listed ${index.createdIn})`);
    if (differences.length) {
      problems.push({ code: 'LISTED_INDEX_MISMATCH', name: index.name, message: `${index.name}: the migrations say ${differences.join(', ')}` });
    }
  }

  for (const fragment of input.fragments) {
    for (const declared of scanFragmentIndexes(fragment.file, fragment.text)) {
      for (const index of listed) {
        const sameName = declared.names.includes(index.name);
        const keyColumns = sameName ? undefined : columnsOfDefinition(index.definition);
        const sameKey = !sameName && declared.table === index.table && keyColumns !== undefined && sameColumns(declared.columns, keyColumns);
        if (sameName || sameKey) {
          problems.push({
            code: 'FRAGMENT_DECLARES_RAW_INDEX',
            name: index.name,
            message: `${fragment.file}:${declared.line}: ${declared.model} declares ${declared.kind} on (${declared.columns.join(', ')}) which is the raw-SQL index ${index.name}; Prisma builds a full index there, not the partial one. Remove it (intentional drift, see ${index.doc})`,
          });
        }
      }
    }
  }
  return problems;
}

/** The key columns of a listed index definition, or `undefined` when a key element is an expression. */
function columnsOfDefinition(definition: string): string[] | undefined {
  const open = definition.search(/\sUSING\s+\w+\s*\(/i);
  if (open < 0) return undefined;
  const group = balanced(definition, definition.indexOf('(', open));
  if (!group) return undefined;
  const elements = splitTopLevel(group.inner);
  if (!elements.every((e) => PLAIN_KEY.test(e))) return undefined;
  return elements.map((e) => unquote(e.split(/\s+/)[0]!));
}

/** Every `.prisma` file under a directory, sorted, as `{ file, text }`. */
function readFragments(dir: string): Array<{ file: string; text: string }> {
  if (!existsSync(dir)) return [];
  const out: Array<{ file: string; text: string }> = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.prisma')) out.push({ file: path, text: readFileSync(path, 'utf8') });
    }
  };
  walk(dir);
  return out;
}

/**
 * What {@link assertRawSqlIndexes} reads from disk.
 *
 * @stability experimental
 */
export interface AssertRawSqlIndexesOptions {
  /** The package history (`migrations/manifest.json`, parsed). */
  manifest: readonly Pick<ManifestEntry, 'id' | 'dir'>[];
  /** The package's `migrations/` directory. */
  migrationsDir: string;
  /** The schema fragments directory (`schema/`); a missing directory means none. */
  fragmentsDir: string;
  /** The list to hold the migrations to; default {@link RAW_SQL_INDEXES}. */
  listed?: ReadonlyArray<PackageRawSqlIndex>;
}

/**
 * Runs the raw-SQL index tripwire against the files on disk: the package's
 * migrations (every manifest entry) and schema fragments. This is the entry
 * the conformance suite and an app's CI call; see {@link checkRawSqlIndexSources}
 * for the rules.
 *
 * @param options - See {@link AssertRawSqlIndexesOptions}.
 * @throws Error listing every problem when the tripwire is tripped.
 * @stability experimental
 */
export function assertRawSqlIndexes(options: AssertRawSqlIndexesOptions): void {
  const problems = checkRawSqlIndexSources({
    manifest: options.manifest,
    readMigration: (dir) => {
      const file = join(options.migrationsDir, dir, 'migration.sql');
      return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
    },
    fragments: readFragments(options.fragmentsDir),
    listed: options.listed,
  });
  if (problems.length > 0) {
    throw new Error(`the raw-SQL index tripwire failed (${problems.length}):\n${problems.map((p) => `  ${p.code}  ${p.message}`).join('\n')}`);
  }
}
