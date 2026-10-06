import type { EventBus, EventBusHealth } from '../../common/event-bus/event-bus.interface';
import { DoctorCheckRegistry } from '../../doctor/doctor-check.registry';
import type { PrincipalCache, PrincipalCacheStats } from '../principal-cache/principal-cache.service';
import { decidePrincipalCache, PrincipalCacheDoctorCheck } from './principal-cache.doctor-check';

const STATS: PrincipalCacheStats = { size: 3, hits: 40, misses: 5, invalidations: 2 };

function health(overrides: Partial<EventBusHealth> = {}): EventBusHealth {
  return {
    adapter: 'postgres',
    connected: true,
    lastError: null,
    lastConnectedAt: '2026-10-06T00:00:00.000Z',
    publishFailures: 0,
    reconnects: 0,
    ...overrides,
  };
}

describe('decidePrincipalCache (PP-1.12, #683)', () => {
  it('passes when enabled on a connected postgres bus, with the counters in data', () => {
    const outcome = decidePrincipalCache(30, STATS, health());
    expect(outcome.status).toBe('pass');
    expect(outcome.data).toMatchObject({ ttlSeconds: 30, size: 3, hits: 40, misses: 5, adapter: 'postgres' });
  });

  it('warns when enabled on an in-process bus, naming EVENT_BUS_ADAPTER=postgres', () => {
    const outcome = decidePrincipalCache(30, STATS, health({ adapter: 'in-process' }));
    expect(outcome.status).toBe('warn');
    expect(outcome.remedy).toContain('EVENT_BUS_ADAPTER=postgres');
    expect(outcome.detail).toContain('30s');
  });

  it('warns when the postgres listener is disconnected, carrying the last error', () => {
    const outcome = decidePrincipalCache(30, STATS, health({ connected: false, lastError: 'connection refused' }));
    expect(outcome.status).toBe('warn');
    expect(outcome.error).toBe('connection refused');
    expect(outcome.remedy).toContain('core.event-bus');
  });

  it('skips when the cache is disabled, whatever the bus', () => {
    for (const bus of [health(), health({ adapter: 'in-process' }), health({ connected: false })]) {
      const outcome = decidePrincipalCache(0, STATS, bus);
      expect(outcome.status).toBe('skip');
      expect(outcome.remedy).toBeUndefined();
    }
  });

  it('never fails', () => {
    for (const ttl of [0, 1, 30]) {
      for (const bus of [health(), health({ adapter: 'in-process' }), health({ connected: false })]) {
        expect(decidePrincipalCache(ttl, STATS, bus).status).not.toBe('fail');
      }
    }
  });
});

describe('PrincipalCacheDoctorCheck', () => {
  it('registers as auth.principal-cache and reads only in-memory snapshots', async () => {
    const registry = new DoctorCheckRegistry();
    const cache = {
      ttlMs: 30_000,
      stats: jest.fn(() => STATS),
      invalidate: jest.fn(),
      set: jest.fn(),
    } as unknown as PrincipalCache;
    const bus = {
      adapter: 'postgres',
      health: jest.fn(() => health()),
      publish: jest.fn(),
      subscribe: jest.fn(),
    } as unknown as EventBus;
    const check = new PrincipalCacheDoctorCheck(registry, cache, bus);

    check.onModuleInit();
    const outcome = await check.run();

    expect(check).toMatchObject({ id: 'auth.principal-cache', category: 'auth', label: 'JWT principal cache' });
    expect(registry.get('auth.principal-cache')).toBe(check);
    expect(outcome).toMatchObject({ status: 'pass', data: { ttlSeconds: 30 } });
    // Read-only: no invalidation, no write, no probe publish.
    expect(cache.invalidate).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
    expect(bus.subscribe).not.toHaveBeenCalled();
  });
});
