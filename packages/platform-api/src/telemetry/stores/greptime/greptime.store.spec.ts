import type { ConfigService } from '@nestjs/config';
import type { PoolConfig } from 'pg';

import { TelemetryConnectionService } from '../../connection/telemetry-connection.service';
import { retentionStatement } from './greptime.retention';
import { GREPTIME_TELEMETRY_STORE } from './greptime.store';
import { GREPTIME_SQL_DIALECT } from './greptime.dialect';
import { GreptimeClient, type GreptimeConfig, type GreptimePool } from './greptime.client';
import { TelemetryQueryAbortedError, TelemetryQueryFailedError } from '../telemetry-store.errors';
import { telemetryStoreKind, type TelemetryStore } from '../telemetry-store';

// =============================================================================
// The built-in `greptime` store, as a TelemetryStore (PP-14.11)
// =============================================================================

const CONFIGURED: GreptimeConfig = {
  host: 'greptimedb',
  pgPort: 4003,
  database: 'public',
  readerUser: 'reader',
  readerPassword: 'reader-pw',
  adminUser: 'admin',
  adminPassword: 'admin-pw',
  available: true,
};

function connection(greptime: Partial<GreptimeConfig>): TelemetryConnectionService {
  const config = { get: jest.fn().mockReturnValue(greptime) } as unknown as ConfigService;

  return new TelemetryConnectionService(config, {} as never, {} as never);
}

class TestableClient extends GreptimeClient {
  readonly created: Array<{ connect: jest.Mock; end: jest.Mock }> = [];
  client = { query: jest.fn(), release: jest.fn() };

  protected override createPool(_config: PoolConfig): GreptimePool {
    const pool = { connect: jest.fn(async () => this.client), end: jest.fn(async () => undefined), on: jest.fn() };
    this.created.push(pool);
    return pool as unknown as GreptimePool;
  }
}

describe('GreptimeClient as the telemetry store', () => {
  it('is the store `greptime`, with the database the connection names', () => {
    const store: TelemetryStore = new TestableClient(connection(CONFIGURED));

    expect(store.id).toBe('greptime');
    expect(store.database).toBe('public');
    expect(store.isConfigured()).toBe(true);
  });

  describe('query', () => {
    it('runs the statement as the read-only login and returns fields and rows', async () => {
      const client = new TestableClient(connection(CONFIGURED));
      client.client.query.mockResolvedValue({ fields: [{ name: 'n', dataTypeID: 20 }], rows: [['3']] });

      const result = await client.query('SELECT count(*) AS n FROM t', [], { readOnly: true, timeoutMs: 1000 });

      expect(result).toEqual({ fields: [{ name: 'n', dataTypeID: 20 }], rows: [['3']] });
      expect(client.client.query).toHaveBeenCalledWith({ text: 'SELECT count(*) AS n FROM t', rowMode: 'array' });
    });

    it('goes through queryReader, so the reader login is the read-only control', async () => {
      const client = new TestableClient(connection(CONFIGURED));
      const reader = jest.spyOn(client, 'queryReader').mockResolvedValue({ fields: [], rows: [] });

      await client.query('SELECT 1', [], { readOnly: true, timeoutMs: 2500 });

      expect(reader).toHaveBeenCalledWith('SELECT 1', { timeoutMs: 2500, signal: undefined });
    });

    it('refuses bind parameters: the wire protocol has no placeholders', async () => {
      const client = new TestableClient(connection(CONFIGURED));

      await expect(client.query('SELECT $1', ['x'], { readOnly: true, timeoutMs: 1000 })).rejects.toBeInstanceOf(
        TelemetryQueryFailedError,
      );
      expect(client.created).toHaveLength(0);
    });

    it('rejects a signal that is already aborted', async () => {
      const client = new TestableClient(connection(CONFIGURED));
      const controller = new AbortController();
      controller.abort();

      await expect(
        client.query('SELECT 1', [], { readOnly: true, timeoutMs: 1000, signal: controller.signal }),
      ).rejects.toBeInstanceOf(TelemetryQueryAbortedError);
    });
  });

  describe('schema', () => {
    it('reads the tables and the columns of the configured database, quoted', async () => {
      const client = new TestableClient(connection({ ...CONFIGURED, database: "pub'lic" }));
      const reader = jest
        .spyOn(client, 'queryReader')
        .mockImplementation(async (sql: string) =>
          sql.includes('information_schema.tables')
            ? { fields: [], rows: [['b_table', '2'], ['a_table', null]] }
            : { fields: [], rows: [['a_table', 'ts', 'timestamp(9)', 'TIMESTAMP', '1'], ['b_table', 'v', 'double', 'FIELD', '1']] },
        );

      const schema = await client.schema({ timeoutMs: 4000 });

      expect(schema.tables.map((t) => t.name)).toEqual(['a_table', 'b_table']);
      expect(schema.tables[0].columns).toEqual([{ name: 'ts', type: 'timestamp(9)', semanticType: 'TIMESTAMP' }]);
      expect(reader).toHaveBeenCalledTimes(2);
      for (const [sql, options] of reader.mock.calls) {
        expect(sql).toContain("table_schema = 'pub''lic'");
        expect(options).toEqual({ timeoutMs: 4000 });
      }
    });
  });

  describe('retention', () => {
    it('is applicable only with the admin login configured', () => {
      expect(new TestableClient(connection(CONFIGURED)).retention?.isApplicable()).toBe(true);
      expect(new TestableClient(connection({ ...CONFIGURED, adminUser: '', adminPassword: '' })).retention?.isApplicable()).toBe(false);
    });

    it('applies the TTL with ALTER DATABASE on the admin login', async () => {
      const client = new TestableClient(connection(CONFIGURED));
      const admin = jest.spyOn(client, 'queryAdmin').mockResolvedValue({ fields: [], rows: [] });

      await client.retention!.apply(14, { timeoutMs: 30_000 });

      expect(admin).toHaveBeenCalledWith(`ALTER DATABASE public SET 'ttl'='14d'`, { timeoutMs: 30_000 });
    });

    it('reads the TTL in force, falling back to the reader without an admin login', async () => {
      const withAdmin = new TestableClient(connection(CONFIGURED));
      jest.spyOn(withAdmin, 'queryAdmin').mockResolvedValue({ fields: [], rows: [['public', "CREATE DATABASE public WITH(ttl = '7days')"]] });
      await expect(withAdmin.retention!.current({ timeoutMs: 5000 })).resolves.toEqual({ raw: '7days', days: 7 });

      const readerOnly = new TestableClient(connection({ ...CONFIGURED, adminUser: '', adminPassword: '' }));
      const admin = jest.spyOn(readerOnly, 'queryAdmin');
      jest.spyOn(readerOnly, 'queryReader').mockResolvedValue({ fields: [], rows: [['public', 'CREATE DATABASE public']] });
      await expect(readerOnly.retention!.current({ timeoutMs: 5000 })).resolves.toBeNull();
      expect(admin).not.toHaveBeenCalled();
    });

    it('keeps the statement text and its identifier rule', () => {
      expect(retentionStatement('public', 30)).toBe(`ALTER DATABASE public SET 'ttl'='30d'`);
      expect(() => retentionStatement('pub lic', 30)).toThrow(/non-plain database name/);
      expect(() => retentionStatement('public', 0)).toThrow(/invalid telemetry retention/);
    });
  });

  it('closes both pools', async () => {
    const client = new TestableClient(connection(CONFIGURED));
    client.client.query.mockResolvedValue({ fields: [], rows: [] });
    await client.query('SELECT 1', [], { readOnly: true, timeoutMs: 1000 });
    await client.queryAdmin('SELECT 1', { timeoutMs: 1000 });

    await client.close();

    expect(client.created.every((pool) => pool.end.mock.calls.length === 1)).toBe(true);
  });
});

describe('the registered definition', () => {
  it('builds the client with the runtime connection and the GreptimeDB dialect', async () => {
    const built = await GREPTIME_TELEMETRY_STORE.build({
      logger: undefined as never,
      connection: connection(CONFIGURED),
      settings: {},
      secret: async () => null,
    });

    expect(built.store).toBeInstanceOf(GreptimeClient);
    expect(built.dialect).toBe(GREPTIME_SQL_DIALECT);
    expect(telemetryStoreKind.get('greptime').label).toBe('GreptimeDB');
  });
});

describe('GREPTIME_SQL_DIALECT', () => {
  const d = GREPTIME_SQL_DIALECT;

  it('names the metric tables\' columns', () => {
    expect(d.timestampColumn).toBe('greptime_timestamp');
    expect(d.valueColumn).toBe('greptime_value');
  });

  it('renders the seven constructs exactly as the dashboard SQL always spelled them', () => {
    expect(d.timeBucket('"timestamp"', 60)).toBe(`date_bin(INTERVAL '60 seconds', "timestamp")`);
    expect(d.percentile(0.95, '"duration_nano"')).toBe('approx_percentile_cont(0.95) WITHIN GROUP (ORDER BY "duration_nano")');
    expect(d.regexpReplaceAll('"p"', "/([0-9]+)(/|$)", '/:id$2')).toBe(`regexp_replace("p", '/([0-9]+)(/|$)', '/:id$2', 'g')`);
    expect(d.jsonString('resource_attributes', 'service.name')).toBe(`json_get_string(resource_attributes, '["service.name"]')`);
    expect(d.containsIgnoreCase('body', 'a\\%b')).toBe(`body ILIKE '%a\\%b%' ESCAPE '\\'`);
    expect(d.castText('"timestamp"')).toBe('CAST("timestamp" AS STRING)');
    expect(d.limit(11)).toBe('LIMIT 11');
  });

  it('only buckets by a size the dashboard offers', () => {
    expect(() => d.timeBucket('"timestamp"', 7)).toThrow(RangeError);
  });
});
