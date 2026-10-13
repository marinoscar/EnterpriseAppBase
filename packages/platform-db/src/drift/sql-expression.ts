import { sha256Hex } from '../lock/index.js';

/**
 * Normalises a SQL expression so two spellings of the same policy compare
 * equal: runs of whitespace collapse to one space, the space inside `(` and
 * `)` and around `,` goes, and everything outside a string literal or a quoted
 * identifier is lower-cased. The text inside quotes is kept byte for byte.
 * Comments are not removed here: {@link scanRlsPolicies} reads statements that
 * already lost theirs.
 *
 * It is a drift marker, not a SQL parser: it never reorders or simplifies, so
 * `a AND b` and `b AND a` stay different, and so do `(x)` and `((x))`.
 *
 * @param expression - The text of a `USING (...)` or `WITH CHECK (...)` expression, without the outer parentheses.
 * @returns The normalised text.
 * @stability experimental
 */
export function normaliseSqlExpression(expression: string): string {
  let out = '';
  let quote = '';
  let pendingSpace = false;
  for (const c of expression) {
    if (quote) {
      out += c;
      if (c === quote) quote = '';
      continue;
    }
    if (/\s/.test(c)) {
      pendingSpace = out !== '';
      continue;
    }
    if (pendingSpace) {
      const last = out[out.length - 1];
      if (last !== '(' && last !== ',' && c !== ')' && c !== ',') out += ' ';
      pendingSpace = false;
    }
    if (c === "'" || c === '"') {
      quote = c;
      out += c;
    } else {
      out += c.toLowerCase();
    }
  }
  return out;
}

/**
 * The SHA-256 (lower-case hex) of {@link normaliseSqlExpression} of an
 * expression: the value a `platform.lock` `rlsPolicies` entry records as
 * `usingSha256` or `checkSha256`.
 *
 * @param expression - The text of a `USING (...)` or `WITH CHECK (...)` expression, without the outer parentheses.
 * @returns 64 lower-case hex characters.
 * @stability experimental
 */
export function sqlExpressionSha256(expression: string): string {
  return sha256Hex(normaliseSqlExpression(expression));
}
