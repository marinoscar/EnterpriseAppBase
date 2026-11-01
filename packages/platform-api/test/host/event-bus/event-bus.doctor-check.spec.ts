import { DoctorCheckRegistry } from '../../../src/doctor/index';
import type { EventBusSelection } from '../../../src/host/event-bus/event-bus.config';
import type { EventBus, EventBusHealth } from '../../../src/host/event-bus/event-bus.interface';
import { decideEventBus, EventBusDoctorCheck } from '../../../src/host/event-bus/doctor/event-bus.doctor-check';

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

const RECOGNISED: EventBusSelection = { adapter: 'postgres', recognised: true, configured: 'postgres' };

describe('decideEventBus (PP-1.11, #682)', () => {
  it('passes for a connected postgres listener', () => {
    const outcome = decideEventBus(health(), RECOGNISED);
    expect(outcome.status).toBe('pass');
    expect(outcome.detail).toContain('every API replica');
  });

  it('warns for a disconnected postgres listener, naming the pooler caveat and POSTGRES_*', () => {
    const outcome = decideEventBus(health({ connected: false, lastError: 'connection refused' }), RECOGNISED);
    expect(outcome.status).toBe('warn');
    expect(outcome.remedy).toContain('transaction-mode pooler');
    expect(outcome.remedy).toContain('POSTGRES_');
    expect(outcome.error).toBe('connection refused');
  });

  it('passes for in-process with a recognised value, and says what that means', () => {
    const outcome = decideEventBus(health({ adapter: 'in-process' }), {
      adapter: 'in-process',
      recognised: true,
      configured: '',
    });
    expect(outcome.status).toBe('pass');
    expect(outcome.detail).toContain('single-process delivery');
    expect(outcome.detail).toContain('EVENT_BUS_ADAPTER=postgres');
  });

  it('warns for an unrecognised EVENT_BUS_ADAPTER', () => {
    const outcome = decideEventBus(health({ adapter: 'in-process' }), {
      adapter: 'in-process',
      recognised: false,
      configured: 'redis',
    });
    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('"redis"');
    expect(outcome.remedy).toContain('EVENT_BUS_ADAPTER');
  });

  it('never fails', () => {
    for (const h of [health(), health({ connected: false }), health({ adapter: 'in-process' })]) {
      for (const recognised of [true, false]) {
        expect(decideEventBus(h, { ...RECOGNISED, recognised }).status).not.toBe('fail');
      }
    }
  });
});

describe('EventBusDoctorCheck', () => {
  it('registers itself as core.event-bus and reads only bus.health()', async () => {
    const registry = new DoctorCheckRegistry();
    const bus = {
      health: jest.fn(() => health()),
      publish: jest.fn(),
      subscribe: jest.fn(),
    } as unknown as EventBus;
    const check = new EventBusDoctorCheck(registry, bus, RECOGNISED);

    check.onModuleInit();
    const outcome = await check.run();

    expect(check).toMatchObject({ id: 'core.event-bus', category: 'core', label: 'Event bus' });
    expect(registry.get('core.event-bus')).toBe(check);
    expect(outcome.status).toBe('pass');
    // No I/O: no probe publish, no subscription.
    expect(bus.publish).not.toHaveBeenCalled();
    expect(bus.subscribe).not.toHaveBeenCalled();
  });
});
