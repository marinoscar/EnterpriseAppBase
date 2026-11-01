import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { HealthCheckError, HealthCheckService, TerminusModule } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';

import { RegistryError } from '../../../src/core/index';
import { withTemporaryEntries } from '../../../src/core/registry/testing';
import {
  DATABASE_HEALTH_INDICATOR_ID,
  DatabaseHealthIndicator,
  HEALTH_INDICATOR_DEFAULT_TIMEOUT_MS,
  HealthIndicatorRunner,
  healthIndicatorRegistry,
  registerHealthIndicator,
  type HealthIndicatorDef,
} from '../../../src/host/index';

const indicator = (overrides: Partial<HealthIndicatorDef> & { id: string }): HealthIndicatorDef => ({
  critical: false,
  check: () => ({ status: 'up' }),
  ...overrides,
});

describe('healthIndicatorRegistry (PP-14.13)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('holds the built-in database indicator, critical, registered through the public function', () => {
    expect(healthIndicatorRegistry.name).toBe('host.health-indicators');
    expect(healthIndicatorRegistry.ids()[0]).toBe(DATABASE_HEALTH_INDICATOR_ID);
    expect(healthIndicatorRegistry.get('database')?.critical).toBe(true);
  });

  describe('registerHealthIndicator', () => {
    it.each(['a', 'Redis', '1redis', 'red_is', 'x'.repeat(33), ''])('refuses the id %p', async (id) => {
      await withTemporaryEntries(healthIndicatorRegistry, [], () => {
        expect(() => registerHealthIndicator(indicator({ id }))).toThrow(RegistryError);
      });
    });

    it('refuses a duplicate id, a non-boolean critical, a missing check and a bad timeout', async () => {
      await withTemporaryEntries(healthIndicatorRegistry, [], () => {
        expect(() => registerHealthIndicator(indicator({ id: 'database' }))).toThrow(RegistryError);
        expect(() => registerHealthIndicator(indicator({ id: 'no-critical', critical: undefined as never }))).toThrow(/critical/);
        expect(() => registerHealthIndicator(indicator({ id: 'no-check', check: undefined as never }))).toThrow(/check/);
        for (const timeoutMs of [0, -1, 1.5, 30_001]) {
          expect(() => registerHealthIndicator(indicator({ id: 'bad-timeout', timeoutMs }))).toThrow(/timeoutMs/);
        }
        expect(() => registerHealthIndicator(indicator({ id: 'fine', timeoutMs: 30_000 }))).not.toThrow();
      });
    });
  });
});

describe('HealthIndicatorRunner (PP-14.13)', () => {
  let runner: HealthIndicatorRunner;
  let database: { isHealthy: jest.Mock };
  let health: HealthCheckService;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    database = { isHealthy: jest.fn().mockResolvedValue({ database: { status: 'up', responseTime: '2ms' } }) };
    const module = await Test.createTestingModule({
      imports: [TerminusModule],
      providers: [HealthIndicatorRunner, { provide: DatabaseHealthIndicator, useValue: database }],
    }).compile();
    runner = module.get(HealthIndicatorRunner);
    health = module.get(HealthCheckService);
  });
  afterEach(() => jest.restoreAllMocks());

  const probe = (scope: 'ready' | 'full') => health.check(runner.functions(scope));

  it('reports the database exactly as it always did, through the container', async () => {
    const result = await probe('ready');
    expect(result.status).toBe('ok');
    expect(result.info).toEqual({ database: { status: 'up', responseTime: '2ms' } });
    expect(database.isHealthy).toHaveBeenCalledWith('database');
  });

  it('reports a down database under the error map with its message, and answers 503', async () => {
    database.isHealthy.mockRejectedValue(
      new HealthCheckError('Database check failed', { database: { status: 'down', message: 'refused', responseTime: '1ms' } }),
    );
    await expect(probe('ready')).rejects.toMatchObject({
      status: 503,
      response: { status: 'error', error: { database: { status: 'down', message: 'refused', responseTime: '1ms' } } },
    });
  });

  it('runs every indicator for the full probe and only the critical ones for readiness', async () => {
    await withTemporaryEntries(
      healthIndicatorRegistry,
      [
        indicator({ id: 'queue', critical: true, check: () => ({ status: 'up', details: { depth: 3 } }) }),
        indicator({ id: 'extras', critical: false, check: () => ({ status: 'up', details: { region: 'eu' } }) }),
      ],
      async () => {
        const ready = await probe('ready');
        expect(Object.keys(ready.info ?? {})).toEqual(['database', 'queue']);
        const full = await probe('full');
        expect(Object.keys(full.info ?? {})).toEqual(['database', 'queue', 'extras']);
        expect(full.info?.queue).toEqual({ status: 'up', depth: 3 });
      },
    );
  });

  it('flips readiness when a critical indicator goes down, and leaves it alone for a non-critical one', async () => {
    let queueUp = true;
    let extrasUp = true;
    await withTemporaryEntries(
      healthIndicatorRegistry,
      [
        indicator({ id: 'queue', critical: true, check: () => ({ status: queueUp ? 'up' : 'down' }) }),
        indicator({ id: 'extras', critical: false, check: () => ({ status: extrasUp ? 'up' : 'down' }) }),
      ],
      async () => {
        await expect(probe('ready')).resolves.toMatchObject({ status: 'ok' });

        extrasUp = false;
        await expect(probe('ready')).resolves.toMatchObject({ status: 'ok' });
        await expect(probe('full')).rejects.toMatchObject({ status: 503, response: { error: { extras: { status: 'down' } } } });

        extrasUp = true;
        queueUp = false;
        await expect(probe('ready')).rejects.toMatchObject({ status: 503, response: { error: { queue: { status: 'down' } } } });
      },
    );
  });

  describe('the probes are public, so results are bounded', () => {
    const run = async (entry: HealthIndicatorDef) =>
      withTemporaryEntries(healthIndicatorRegistry, [entry], async () => {
        try {
          return { ok: true as const, result: await probe('full') };
        } catch (error) {
          return { ok: false as const, response: (error as { response: Record<string, any> }).response };
        }
      });

    it('never puts a thrown error text in the response, only a fixed message (the text is logged)', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn');
      const outcome = await run(
        indicator({
          id: 'leaky',
          check: () => {
            throw new Error('connect ECONNREFUSED postgres://admin:hunter2@db.internal:5432/app');
          },
        }),
      );
      expect(outcome.ok).toBe(false);
      const body = JSON.stringify(outcome.ok ? outcome.result : outcome.response);
      expect(body).not.toContain('hunter2');
      expect(body).not.toContain('ECONNREFUSED');
      expect((outcome as { response: any }).response.error.leaky).toEqual({ status: 'down', message: 'check failed' });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('leaky'));
    });

    it('drops credential-looking keys and non-primitive values, caps strings and key counts, and redacts URL passwords', async () => {
      const details: Record<string, unknown> = {
        apiKey: 'sk-live-1',
        accessToken: 't',
        password: 'p',
        Authorization: 'Bearer x',
        nested: { a: 1 },
        list: [1],
        nothing: null,
        infinite: Infinity,
        'bad key!': 1,
        status: 'down',
        url: 'redis://user:secret@cache.internal:6379',
        long: 'x'.repeat(500),
        kept: 7,
        flag: true,
      };
      for (let i = 0; i < 40; i += 1) details[`extra${i}`] = i;
      const outcome = await run(indicator({ id: 'bounded', check: () => ({ status: 'up', details: details as never }) }));
      expect(outcome.ok).toBe(true);
      const entry = (outcome as { result: any }).result.info.bounded as Record<string, unknown>;
      expect(entry.status).toBe('up');
      for (const dropped of ['apiKey', 'accessToken', 'password', 'Authorization', 'nested', 'list', 'nothing', 'infinite', 'bad key!']) {
        expect(entry).not.toHaveProperty(dropped);
      }
      expect(entry.url).toBe('redis://***@cache.internal:6379');
      expect((entry.long as string).length).toBe(200);
      expect(entry.kept).toBe(7);
      expect(entry.flag).toBe(true);
      expect(Object.keys(entry).length).toBeLessThanOrEqual(17);
      expect(JSON.stringify(entry)).not.toContain('secret');
    });

    it('reports a result that is neither up nor down as down', async () => {
      const outcome = await run(indicator({ id: 'odd', check: () => ({ status: 'maybe' }) as never }));
      expect(outcome.ok).toBe(false);
      expect((outcome as { response: any }).response.error.odd.status).toBe('down');
    });

    it('cuts an indicator off at its timeout and reports it down', async () => {
      const outcome = await run(indicator({ id: 'slow', timeoutMs: 20, check: () => new Promise(() => undefined) }));
      expect(outcome.ok).toBe(false);
      expect((outcome as { response: any }).response.error.slow).toEqual({ status: 'down', message: 'timed out after 20ms' });
    });

    it('has a bounded default timeout', () => {
      expect(HEALTH_INDICATOR_DEFAULT_TIMEOUT_MS).toBeLessThanOrEqual(5000);
    });

    it('lets the check reach an application provider through its context', async () => {
      const outcome = await run(
        indicator({ id: 'ctx', check: (context) => ({ status: 'up', details: { probe: context.get<typeof database>(DatabaseHealthIndicator) === database } }) }),
      );
      expect((outcome as { result: any }).result.info.ctx).toEqual({ status: 'up', probe: true });
    });
  });
});
