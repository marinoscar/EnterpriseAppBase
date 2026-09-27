import {
  analyzeStatement,
  stripSqlComments,
  TelemetrySqlRejectedError,
  wrapWithLimit,
  type TelemetryStatementKind,
} from './sql-guard';

function rejection(sql: string): string {
  try {
    analyzeStatement(sql);
  } catch (error) {
    expect(error).toBeInstanceOf(TelemetrySqlRejectedError);
    return (error as Error).message;
  }
  throw new Error(`expected ${JSON.stringify(sql)} to be rejected`);
}

describe('sql-guard', () => {
  describe('analyzeStatement — accepted', () => {
    const cases: [string, TelemetryStatementKind, string][] = [
      ['SELECT 1', 'select', 'SELECT 1'],
      ['select 1', 'select', 'select 1'],
      ['  \n\tSeLeCt 1  ', 'select', 'SeLeCt 1'],
      ['SELECT 1;', 'select', 'SELECT 1'],
      ['SELECT 1 ;  ; \n', 'select', 'SELECT 1'],
      ['(SELECT 1)', 'select', '(SELECT 1)'],
      ['((select 1) UNION ALL (select 2))', 'select', '((select 1) UNION ALL (select 2))'],
      ['WITH x AS (SELECT 1) SELECT * FROM x', 'select', 'WITH x AS (SELECT 1) SELECT * FROM x'],
      ['with recursive x as (select 1) select * from x', 'select', 'with recursive x as (select 1) select * from x'],
      ['SHOW TABLES', 'show', 'SHOW TABLES'],
      ['show create table opentelemetry_logs', 'show', 'show create table opentelemetry_logs'],
      ['DESCRIBE opentelemetry_traces', 'describe', 'DESCRIBE opentelemetry_traces'],
      ['DESC TABLE t', 'describe', 'DESC TABLE t'],
      ['desc t', 'describe', 'desc t'],
      ['EXPLAIN SELECT * FROM t', 'explain', 'EXPLAIN SELECT * FROM t'],
      ['explain verbose select 1', 'explain', 'explain verbose select 1'],
      // Semicolons inside literals and quoted identifiers are not terminators.
      ["SELECT ';' AS semi", 'select', "SELECT ';' AS semi"],
      ["SELECT 'it''s; fine'", 'select', "SELECT 'it''s; fine'"],
      ['SELECT "a;b" FROM t', 'select', 'SELECT "a;b" FROM t'],
      ['SELECT "we""ird;" FROM t', 'select', 'SELECT "we""ird;" FROM t'],
      ['SELECT `a;b` FROM t', 'select', 'SELECT `a;b` FROM t'],
      // Comment markers inside literals are text, not comments.
      ["SELECT '--not a comment; DROP TABLE t'", 'select', "SELECT '--not a comment; DROP TABLE t'"],
      ["SELECT '/* nor this */'", 'select', "SELECT '/* nor this */'"],
      ['SELECT "span_attributes.http.route" FROM opentelemetry_traces', 'select', 'SELECT "span_attributes.http.route" FROM opentelemetry_traces'],
      // Comments are removed.
      ['-- leading\nSELECT 1', 'select', 'SELECT 1'],
      ['/* leading */ SELECT 1', 'select', 'SELECT 1'],
      ['SELECT 1 -- trailing; DROP TABLE t', 'select', 'SELECT 1'],
      ['SELECT 1; -- trailing comment', 'select', 'SELECT 1'],
      ['SELECT/**/1', 'select', 'SELECT 1'],
      ['SELECT 1 /* a ; b */ + 2', 'select', 'SELECT 1   + 2'],
    ];

    it.each(cases)('%j → %s', (sql, kind, normalized) => {
      expect(analyzeStatement(sql)).toEqual({ kind, normalized });
    });
  });

  describe('analyzeStatement — refused', () => {
    it.each([
      'INSERT INTO t VALUES (1)',
      'UPDATE t SET a = 1',
      'DELETE FROM t',
      'DROP TABLE t',
      'ALTER DATABASE public SET ttl = \'1d\'',
      'CREATE TABLE x (a INT)',
      'SET statement_timeout = 0',
      "COPY t TO '/tmp/x'",
      'ADMIN flush_table(\'t\')',
      'KILL 1',
      'TRUNCATE t',
      'drop table t',
    ])('%j as not read-only', (sql) => {
      const keyword = sql.split(/\s/)[0].toUpperCase();
      const message = rejection(sql);

      expect(message).toContain(`${keyword} statements are not allowed`);
      expect(message).toContain('SELECT, WITH, SHOW, DESCRIBE and EXPLAIN');
    });

    it.each([
      'SELECT 1; SELECT 2',
      'SELECT 1; DROP TABLE t',
      'SELECT 1;DROP TABLE t;',
      "SELECT 'a'; DELETE FROM t",
      // A comment does not hide a second statement: it is removed first.
      'SELECT 1 /* x */; DROP TABLE t',
      'SELECT 1 --x\n; DROP TABLE t',
      '/* ; */ SELECT 1; SELECT 2',
    ])('%j as more than one statement', (sql) => {
      expect(rejection(sql)).toBe('Only one SQL statement may be run at a time.');
    });

    it.each(['', '   ', ';', ' ; ; ', '-- only a comment', '/* only */', '--x\n;'])('%j as empty', (sql) => {
      expect(rejection(sql)).toBe('The query is empty.');
    });

    it.each([
      ["SELECT 'unterminated", 'unterminated string literal'],
      ['SELECT "unterminated', 'unterminated quoted identifier'],
      ['SELECT 1 /* unterminated', 'unterminated /* comment'],
      // A quote swallowing the rest must not let a `;` slip through unseen.
      ["SELECT 'x''; DROP TABLE t", 'unterminated string literal'],
    ])('%j as malformed (%s)', (sql, fragment) => {
      expect(rejection(sql)).toContain(fragment);
    });

    it('a statement that starts with no keyword', () => {
      expect(rejection('123')).toBe('The query must start with SELECT, WITH, SHOW, DESCRIBE and EXPLAIN.');
      expect(rejection('"t"')).toMatch(/must start with/);
    });

    it.each(['EXPLAIN ANALYZE SELECT 1', 'explain analyze select 1', 'EXPLAIN VERBOSE ANALYZE SELECT 1', 'EXPLAIN (ANALYZE) SELECT 1'])(
      '%j (it runs the query)',
      (sql) => {
        expect(rejection(sql)).toContain('EXPLAIN ANALYZE is not allowed');
      },
    );

    it('a keyword hidden behind a comment', () => {
      expect(rejection('/* SELECT */ DROP TABLE t')).toContain('DROP statements are not allowed');
      expect(rejection('-- SELECT\nDELETE FROM t')).toContain('DELETE statements are not allowed');
    });
  });

  describe('stripSqlComments', () => {
    it('keeps literals and identifiers verbatim', () => {
      expect(stripSqlComments(`SELECT '--', "/*", 'a''b' -- c\n`)).toBe(`SELECT '--', "/*", 'a''b'  \n`);
    });

    it('treats an unterminated line comment as running to the end', () => {
      expect(stripSqlComments('SELECT 1 -- x')).toBe('SELECT 1  ');
    });
  });

  describe('wrapWithLimit', () => {
    it('wraps a SELECT so the server stops at the limit', () => {
      expect(wrapWithLimit(analyzeStatement('SELECT * FROM t;'), 101)).toBe(
        'SELECT * FROM (SELECT * FROM t\n) AS telemetry_q LIMIT 101',
      );
    });

    it('wraps a WITH', () => {
      expect(wrapWithLimit(analyzeStatement('WITH x AS (SELECT 1) SELECT * FROM x'), 5)).toBe(
        'SELECT * FROM (WITH x AS (SELECT 1) SELECT * FROM x\n) AS telemetry_q LIMIT 5',
      );
    });

    it('wraps the comment-free text, never the original', () => {
      expect(wrapWithLimit(analyzeStatement('SELECT 1 -- note'), 2)).toBe(
        'SELECT * FROM (SELECT 1\n) AS telemetry_q LIMIT 2',
      );
    });

    it.each(['SHOW TABLES', 'DESCRIBE t', 'EXPLAIN SELECT 1'])('leaves %j unwrapped', (sql) => {
      expect(wrapWithLimit(analyzeStatement(sql), 10)).toBe(sql);
    });

    it.each([0, -1, 1.5, Number.NaN])('refuses a limit of %p', (limit) => {
      expect(() => wrapWithLimit(analyzeStatement('SELECT 1'), limit)).toThrow(RangeError);
    });
  });
});
