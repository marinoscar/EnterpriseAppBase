import { sha256Hex } from '../lock/index.js';

/**
 * Normalises migration SQL for matching a fork that edited comments or
 * whitespace: strips `--` line comments and block comments, collapses runs of
 * whitespace and lower-cases everything outside string literals and quoted
 * identifiers (so keywords compare equal while `"User"` stays distinct from
 * `"user"`).
 *
 * The result is only ever compared with another normalised text; it is never
 * written anywhere, because Prisma checksums the raw bytes.
 *
 * @param sql - The text of a `migration.sql`.
 * @returns The normalised text.
 * @stability experimental
 */
export function normaliseSql(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i += 1;
    } else if (c === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth += 1;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      out += ' ';
    } else if (c === "'" || c === '"') {
      // A literal or a quoted identifier: copied verbatim, doubled quotes are escapes.
      let j = i + 1;
      while (j < n) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) j += 2;
          else break;
        } else {
          j += 1;
        }
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === '$' && /^\$[A-Za-z_]*\$/.test(sql.slice(i, i + 64))) {
      // A dollar-quoted body (a DO block, a function): verbatim up to the matching tag.
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 64))![0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? n : end + tag.length;
      out += sql.slice(i, stop);
      i = stop;
    } else if (/\s/.test(c)) {
      out += ' ';
      i += 1;
    } else {
      out += c.toLowerCase();
      i += 1;
    }
  }
  return out.replace(/ {2,}/g, ' ').trim();
}

/**
 * SHA-256 of {@link normaliseSql}, the fingerprint the second matching pass compares.
 *
 * @param bytes - The raw `migration.sql` bytes.
 * @returns 64 lower-case hex characters.
 * @stability experimental
 */
export function normalisedSha256(bytes: Uint8Array): string {
  return sha256Hex(normaliseSql(Buffer.from(bytes).toString('utf8')));
}

/**
 * Normalises one statement of `prisma migrate diff` output for comparison with
 * a `deviations[].expectDiff` entry: removes `"public".` and collapses whitespace.
 *
 * @param statement - A statement.
 * @returns The normalised statement.
 * @stability experimental
 */
export function normaliseStatement(statement: string): string {
  return statement.replace(/"public"\./g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Splits the SQL `prisma migrate diff --script` prints into statements:
 * comment headings are dropped and each statement keeps its trailing `;`.
 *
 * @param script - The script text, banner lines already removed.
 * @returns The statements; empty for an empty migration.
 * @stability experimental
 */
export function splitStatements(script: string): string[] {
  const cleaned = script.replace(/^\s*-- This is an empty migration\.\s*$/m, '');
  return cleaned
    .split(/;[ \t]*\r?\n/)
    .map((chunk) => chunk.replace(/^(\s*--[^\n]*\n)+/g, '').trim())
    .filter((chunk) => chunk !== '' && !/^--[^\n]*$/.test(chunk))
    .map((chunk) => (chunk.endsWith(';') ? chunk : `${chunk};`));
}
