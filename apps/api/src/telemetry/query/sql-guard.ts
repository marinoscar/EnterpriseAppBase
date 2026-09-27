// =============================================================================
// SQL guard for ad-hoc telemetry queries (issue #535, epic #528)
// =============================================================================
//
// DEFENCE IN DEPTH, NOT THE CONTROL. Every explorer/assistant/export query runs
// as GreptimeDB's `readonly` user, which the server itself refuses INSERT,
// DROP, ALTER, SET and friends (spike #529). This guard exists for two
// reasons that user cannot cover:
//
//   1. ONE STATEMENT. The simple query protocol executes EVERY statement in a
//      multi-statement string (spike #529). `GreptimeClient` refuses the
//      result after the fact; this refuses the text before it is sent, so a
//      second statement never runs at all.
//   2. GOOD ERRORS. "Only SELECT, WITH, SHOW, DESCRIBE and EXPLAIN are
//      allowed" is a better answer to `DELETE FROM …` than the server's
//      "User is not authorized to perform this action".
//
// It is a small lexer, not a parser: it knows where single-quoted strings
// ('' escapes), double-quoted identifiers ("" escapes — telemetry columns are
// named like "span_attributes.http.route"), backtick identifiers, `--` line
// comments and `/* */` block comments begin and end, and nothing else. That
// is exactly enough to find a `;` or a comment that is really one, and to find
// the first keyword. GreptimeDB has no dollar quoting, so none is handled.
//
// Pure functions; no Nest, no I/O.
// =============================================================================

export type TelemetryStatementKind = 'select' | 'show' | 'describe' | 'explain';

export interface AnalyzedStatement {
  kind: TelemetryStatementKind;
  /** The statement with comments removed and trailing `;`/whitespace trimmed. */
  normalized: string;
}

/** Why a statement was refused. The message is shown to the user as-is. */
export class TelemetrySqlRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelemetrySqlRejectedError';
  }
}

const ALLOWED: Record<string, TelemetryStatementKind> = {
  SELECT: 'select',
  WITH: 'select',
  SHOW: 'show',
  DESCRIBE: 'describe',
  DESC: 'describe',
  EXPLAIN: 'explain',
};

const ALLOWED_TEXT = 'SELECT, WITH, SHOW, DESCRIBE and EXPLAIN';

/**
 * Removes comments outside quotes, keeping everything else byte-for-byte.
 * A comment is replaced by one space so `SELECT/**\/1` does not become
 * `SELECT1`. Throws on an unterminated string, identifier or block comment:
 * what follows it cannot be classified safely.
 */
export function stripSqlComments(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === "'" || ch === '"' || ch === '`') {
      const end = endOfQuoted(sql, i);
      out += sql.slice(i, end);
      i = end;
      continue;
    }

    if (ch === '-' && next === '-') {
      const newline = sql.indexOf('\n', i + 2);
      i = newline === -1 ? n : newline; // keep the newline itself
      out += ' ';
      continue;
    }

    if (ch === '/' && next === '*') {
      const close = sql.indexOf('*/', i + 2);
      if (close === -1) {
        throw new TelemetrySqlRejectedError('The query has an unterminated /* comment.');
      }
      i = close + 2;
      out += ' ';
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/**
 * Classifies one read-only statement, or throws `TelemetrySqlRejectedError`
 * with a message fit to show the user.
 */
export function analyzeStatement(sql: string): AnalyzedStatement {
  const stripped = stripSqlComments(sql);
  const normalized = trimTrailingTerminators(stripped);

  if (normalized === '') {
    throw new TelemetrySqlRejectedError('The query is empty.');
  }

  if (indexOfUnquoted(normalized, ';') !== -1) {
    throw new TelemetrySqlRejectedError('Only one SQL statement may be run at a time.');
  }

  // `(SELECT 1) UNION (SELECT 2)` — a leading parenthesis opens a query.
  const body = normalized.replace(/^[\s(]+/, '');
  const keyword = /^[A-Za-z_]+/.exec(body)?.[0]?.toUpperCase() ?? '';
  const kind = ALLOWED[keyword];

  if (!kind) {
    throw new TelemetrySqlRejectedError(
      keyword
        ? `${keyword} statements are not allowed. Telemetry queries are read-only: only ${ALLOWED_TEXT} are allowed.`
        : `The query must start with ${ALLOWED_TEXT}.`,
    );
  }

  if (kind === 'explain' && /^EXPLAIN\s+(\(|VERBOSE\s+)?ANALYZE\b/i.test(body)) {
    throw new TelemetrySqlRejectedError(
      'EXPLAIN ANALYZE is not allowed: it runs the whole query. Use EXPLAIN to see the plan.',
    );
  }

  return { kind, normalized };
}

/**
 * The statement to send. A SELECT/WITH is wrapped so the SERVER stops after
 * `limit` rows (pass `maxRows + 1` to detect truncation); SHOW, DESCRIBE and
 * EXPLAIN cannot be a subquery and are sent unchanged (their output is small
 * and the caller trims it).
 */
export function wrapWithLimit(statement: AnalyzedStatement, limit: number): string {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(`limit must be a positive integer, got ${limit}`);
  }

  if (statement.kind !== 'select') {
    return statement.normalized;
  }

  // The newline before `)` matters: a trailing `--` comment would otherwise
  // swallow it — comments are already stripped, but belt and braces.
  return `SELECT * FROM (${statement.normalized}\n) AS telemetry_q LIMIT ${limit}`;
}

// -----------------------------------------------------------------------------

/** Index just past the quoted run starting at `start` (a `'`, `"` or backtick). */
function endOfQuoted(sql: string, start: number): number {
  const quote = sql[start];
  let i = start + 1;

  while (i < sql.length) {
    if (sql[i] === quote) {
      // A doubled quote is an escaped one and does not close the run.
      if (sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }

  throw new TelemetrySqlRejectedError(
    quote === "'"
      ? 'The query has an unterminated string literal.'
      : 'The query has an unterminated quoted identifier.',
  );
}

function indexOfUnquoted(sql: string, target: string): number {
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    if (ch === "'" || ch === '"' || ch === '`') {
      i = endOfQuoted(sql, i);
      continue;
    }
    if (ch === target) return i;
    i += 1;
  }

  return -1;
}

/** Trims whitespace and any number of trailing `;` (with whitespace between). */
function trimTrailingTerminators(sql: string): string {
  return sql.replace(/[\s;]+$/, '').trim();
}
