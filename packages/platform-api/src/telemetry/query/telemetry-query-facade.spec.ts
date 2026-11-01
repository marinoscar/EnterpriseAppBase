import { TELEMETRY_ERROR_REASONS, TelemetryHttpError } from './telemetry-query.errors';
import {
  FACADE_DEFAULT_ROWS,
  FACADE_MAX_ROWS,
  FACADE_MAX_STATEMENTS,
  TelemetryFacadeLimitError,
  createQueryFacade,
} from './telemetry-query-facade';
import type { TelemetryQueryService } from './telemetry-query.service';
import { GREPTIME_SQL_DIALECT } from '../stores/greptime/greptime.dialect';

// =============================================================================
// The guarded query facade (PP-14.18)
// =============================================================================
//
// What an extension's code receives instead of a client. These tests pin what
// it can and cannot do.
// =============================================================================

function service(overrides: Partial<Record<'run', jest.Mock>> = {}) {
  const run =
    overrides.run ??
    jest.fn(async () => ({
      columns: [{ name: 'n', type: 'int8' }],
      rows: [['7']],
      rowCount: 1,
      truncated: false,
      elapsedMs: 2,
    }));
  return { run, queries: { run } as unknown as TelemetryQueryService };
}

describe('createQueryFacade', () => {
  it('has a query method, the quoting builders and the dialect, and nothing else', () => {
    const { queries } = service();
    const facade = createQueryFacade(queries, 'u1', { source: 'panel', dialect: GREPTIME_SQL_DIALECT });

    expect(Object.keys(facade).sort()).toEqual(['dialect', 'query', 'sql']);
    expect(Object.isFrozen(facade)).toBe(true);
    expect(Object.isFrozen(facade.sql)).toBe(true);
    // No way back to the service, the store, a pool or a connection.
    for (const hidden of ['run', 'store', 'client', 'pool', 'service', 'queries', 'settings', 'schema']) {
      expect(facade).not.toHaveProperty(hidden);
    }
  });

  it('runs a statement as the bound user and source, through the query service only', async () => {
    const { run, queries } = service();
    const facade = createQueryFacade(queries, 'u1', { source: 'panel', dialect: GREPTIME_SQL_DIALECT });

    const result = await facade.query('SELECT 1 AS n');

    expect(run).toHaveBeenCalledWith('u1', 'SELECT 1 AS n', expect.objectContaining({ source: 'panel', maxRows: FACADE_DEFAULT_ROWS }));
    expect(result).toEqual({ columns: [{ name: 'n', type: 'int8' }], rows: [['7']], rowCount: 1, truncated: false });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('passes the abort signal through', async () => {
    const { run, queries } = service();
    const controller = new AbortController();
    await createQueryFacade(queries, 'u1', { source: 'assistant', dialect: GREPTIME_SQL_DIALECT, signal: controller.signal }).query('SELECT 1');

    expect(run.mock.calls[0]![2].signal).toBe(controller.signal);
  });

  it.each([
    [undefined, FACADE_DEFAULT_ROWS],
    [5, 5],
    [0, 1],
    [-3, 1],
    [2.9, 2],
    [FACADE_MAX_ROWS + 500, FACADE_MAX_ROWS],
    [Number.NaN, FACADE_DEFAULT_ROWS],
    [Number.POSITIVE_INFINITY, FACADE_DEFAULT_ROWS],
  ])('clamps maxRows %p to %p', async (asked, used) => {
    const { run, queries } = service();
    await createQueryFacade(queries, 'u1', { source: 'panel', dialect: GREPTIME_SQL_DIALECT }).query('SELECT 1', { maxRows: asked });

    expect(run.mock.calls[0]![2].maxRows).toBe(used);
  });

  it('stops after its statement budget, counting a refused statement too', async () => {
    const refusal = new TelemetryHttpError(TELEMETRY_ERROR_REASONS.QUERY_REJECTED, 'Only SELECT.');
    const run = jest.fn(async () => {
      throw refusal;
    });
    const facade = createQueryFacade(service({ run }).queries, 'u1', { source: 'panel', dialect: GREPTIME_SQL_DIALECT });

    for (let i = 0; i < FACADE_MAX_STATEMENTS; i += 1) {
      await expect(facade.query('DROP TABLE x')).rejects.toBe(refusal);
    }
    await expect(facade.query('SELECT 1')).rejects.toBeInstanceOf(TelemetryFacadeLimitError);
    expect(run).toHaveBeenCalledTimes(FACADE_MAX_STATEMENTS);
  });

  it('honours a smaller statement budget and row ceiling', async () => {
    const { run, queries } = service();
    const facade = createQueryFacade(queries, 'u1', { source: 'assistant', dialect: GREPTIME_SQL_DIALECT, maxStatements: 1, maxRows: 10 });

    await facade.query('SELECT 1', { maxRows: 500 });
    expect(run.mock.calls[0]![2].maxRows).toBe(10);
    await expect(facade.query('SELECT 2')).rejects.toBeInstanceOf(TelemetryFacadeLimitError);
  });

  it('lets a write reach the query service, whose guard refuses it AND audits the attempt', async () => {
    // The facade does not pre-judge SQL: the single entry point (guard, cap, timeout, audit) does.
    const { run, queries } = service();
    await createQueryFacade(queries, 'u1', { source: 'panel', dialect: GREPTIME_SQL_DIALECT }).query('DELETE FROM opentelemetry_logs');

    expect(run).toHaveBeenCalledWith('u1', 'DELETE FROM opentelemetry_logs', expect.anything());
  });

  it.each(['', '   ', 42 as unknown as string])('refuses an empty or non-text statement %p without spending budget', async (sql) => {
    const { run, queries } = service();
    const facade = createQueryFacade(queries, 'u1', { source: 'panel', dialect: GREPTIME_SQL_DIALECT, maxStatements: 1 });

    await expect(facade.query(sql)).rejects.toMatchObject({ reason: TELEMETRY_ERROR_REASONS.QUERY_REJECTED });
    await facade.query('SELECT 1');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('refuses an over-long statement', async () => {
    const { run, queries } = service();
    const facade = createQueryFacade(queries, 'u1', { source: 'panel', dialect: GREPTIME_SQL_DIALECT });

    await expect(facade.query(`SELECT '${'x'.repeat(20_000)}'`)).rejects.toMatchObject({ reason: TELEMETRY_ERROR_REASONS.QUERY_REJECTED });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('the quoting builders', () => {
  const { sql } = createQueryFacade(service().queries, 'u1', { source: 'panel', dialect: GREPTIME_SQL_DIALECT });

  it('quote a value so it cannot end its literal', () => {
    expect(sql.literal("o'brien")).toBe("'o''brien'");
    expect(sql.literal("x'; DROP TABLE t; --")).toBe("'x''; DROP TABLE t; --'");
    expect(sql.ident('a"b')).toBe('"a""b"');
  });

  it('write a timestamp from a valid Date only', () => {
    expect(sql.timestamp(new Date('2026-01-02T03:04:05.000Z'))).toBe("'2026-01-02T03:04:05.000Z'");
    expect(() => sql.timestamp(new Date('nope'))).toThrow(RangeError);
    expect(() => sql.timestamp('2026-01-01' as unknown as Date)).toThrow(RangeError);
  });

  it('writes a window predicate', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-01T01:00:00.000Z');
    expect(sql.between('timestamp', from, to)).toBe(`"timestamp" >= '${from.toISOString()}' AND "timestamp" < '${to.toISOString()}'`);
  });
});
