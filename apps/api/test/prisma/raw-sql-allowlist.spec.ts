// =============================================================================
// Tripwire: raw SQL only in allowlisted files (issue #688, PP-1.9)
// =============================================================================
//
// The API has no linter, so the spec's "rule against unscoped raw SQL" is this
// test. It scans every non-spec `*.ts` under apps/api/src, blanks out
// comments and string literals (several files mention `$queryRaw` in prose),
// and finds `$queryRaw`, `$queryRawUnsafe`, `$executeRaw` and
// `$executeRawUnsafe`. A file using raw SQL must be in raw-sql-allowlist.ts
// with a reason; an allowlisted file that stopped using it must be removed,
// so the list stays tight.
// =============================================================================

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { RAW_SQL_ALLOWLIST } from './raw-sql-allowlist';

const SRC = join(__dirname, '..', '..', 'src');

const RAW_SQL = /\$(?:queryRaw|executeRaw)(?:Unsafe)?\b/g;

/**
 * Replaces the contents of comments and of `'...'`/`"..."` strings with
 * spaces, keeping line breaks. Template literals are kept: a raw call is a tag
 * written before one, never inside it.
 */
export function blankCommentsAndStrings(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (ch === '`') {
      // Copied through, so a quote inside a template never starts a string.
      let j = i + 1;
      while (j < source.length && source[j] !== '`') j += source[j] === '\\' ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== ch && source[j] !== '\n') {
        j += source[j] === '\\' ? 2 : 1;
      }
      out += ' '.repeat(Math.min(j + 1, source.length) - i);
      i = j + 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** The raw SQL methods a source file uses, outside comments and strings. */
export function rawSqlUses(source: string): string[] {
  return [...new Set(blankCommentsAndStrings(source).match(RAW_SQL) ?? [])].sort();
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

/** Every file under `root` using raw SQL, as `relative/path.ts` → methods. */
export function findRawSqlFiles(root: string = SRC): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles(root)) {
    const uses = rawSqlUses(readFileSync(file, 'utf8'));
    if (uses.length > 0) found.set(relative(root, file).split(sep).join('/'), uses);
  }
  return found;
}

/** One message per unlisted file and per stale allowlist entry. */
export function checkRawSqlAllowlist(found: ReadonlyMap<string, string[]>, allowlist: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  for (const [file, uses] of found) {
    if (!(file in allowlist)) {
      problems.push(
        `apps/api/src/${file} uses ${uses.join(', ')}: add it to raw-sql-allowlist.ts with a reason, and make sure it never runs with request-derived ids unscoped.`,
      );
    }
  }
  for (const [file, reason] of Object.entries(allowlist)) {
    if (!found.has(file)) {
      problems.push(`apps/api/src/${file} is in raw-sql-allowlist.ts but no longer uses raw SQL: remove the entry.`);
    }
    if (reason.trim() === '') problems.push(`apps/api/src/${file}: the allowlist entry needs a reason.`);
  }
  return problems;
}

describe('raw SQL allowlist', () => {
  it('passes on today’s code', () => {
    expect(checkRawSqlAllowlist(findRawSqlFiles(), RAW_SQL_ALLOWLIST)).toEqual([]);
  });

  it('fails for a new unlisted raw call', () => {
    const found = new Map([...findRawSqlFiles(), ['users/users.service.ts', ['$queryRawUnsafe']]]);
    expect(checkRawSqlAllowlist(found, RAW_SQL_ALLOWLIST)).toEqual([
      'apps/api/src/users/users.service.ts uses $queryRawUnsafe: add it to raw-sql-allowlist.ts with a reason, and make sure it never runs with request-derived ids unscoped.',
    ]);
  });

  it('fails for a stale allowlist entry', () => {
    const allowlist = { ...RAW_SQL_ALLOWLIST, 'users/users.service.ts': 'Was raw once.' };
    expect(checkRawSqlAllowlist(findRawSqlFiles(), allowlist)).toEqual([
      'apps/api/src/users/users.service.ts is in raw-sql-allowlist.ts but no longer uses raw SQL: remove the entry.',
    ]);
  });

  it('fails for an entry without a reason', () => {
    const [file] = Object.keys(RAW_SQL_ALLOWLIST);
    expect(checkRawSqlAllowlist(findRawSqlFiles(), { ...RAW_SQL_ALLOWLIST, [file]: ' ' })).toEqual([
      `apps/api/src/${file}: the allowlist entry needs a reason.`,
    ]);
  });

  describe('detection', () => {
    it.each([
      ['a tagged template', 'await this.prisma.$queryRaw`SELECT 1`;', ['$queryRaw']],
      ['a typed call', 'prisma.$queryRaw<Row[]>(Prisma.sql`SELECT 1`)', ['$queryRaw']],
      ['the unsafe variants', 'db.$executeRawUnsafe(sql); db.$queryRawUnsafe(sql);', ['$executeRawUnsafe', '$queryRawUnsafe']],
      ['an executeRaw', 'tx.$executeRaw`UPDATE t SET x = 1`', ['$executeRaw']],
    ])('finds %s', (_label, source, uses) => {
      expect(rawSqlUses(source)).toEqual(uses);
    });

    it.each([
      ['a line comment', '// uses $queryRaw here'],
      ['a block comment', '/* $executeRaw\n is not used */ const x = 1;'],
      ['a doc comment', '/**\n * `$queryRaw<{ v: string }[]>` or a pg client\n */'],
      ['a string literal', "type C = Pick<PrismaService, '$queryRaw'>;"],
      ['a double-quoted string', 'const s = "$executeRawUnsafe";'],
      ['a longer identifier', 'const $queryRawish = 1;'],
    ])('ignores %s', (_label, source) => {
      expect(rawSqlUses(source)).toEqual([]);
    });

    it('does not treat a quote inside a template literal as a string', () => {
      expect(rawSqlUses("const m = `it's`; await db.$queryRaw`SELECT 1`;")).toEqual(['$queryRaw']);
    });

    it('keeps line breaks, so a block comment does not swallow code after it', () => {
      expect(blankCommentsAndStrings('/* a\nb */x')).toBe('    \n    x');
    });
  });
});
