import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RegistryError } from '../../../src/core/index';
import { withTemporaryEntries } from '../../../src/core/registry/testing';
import {
  BUILTIN_EVENT_BUS_ADAPTERS,
  EVENT_BUS_ADAPTERS,
  InProcessEventBus,
  PostgresEventBus,
  eventBusAdapterRegistry,
  registerEventBusAdapter,
  type EventBusAdapterDef,
} from '../../../src/host/index';
import { selectEventBus, createEventBus } from '../../../src/host/event-bus/event-bus.factory';
import { parseEventBusAdapter } from '../../../src/host/event-bus/event-bus.config';
import { decideEventBus } from '../../../src/host/event-bus/doctor/event-bus.doctor-check';

const adapter = (id: string, create: EventBusAdapterDef['create'] = () => new InProcessEventBus()): EventBusAdapterDef => ({
  id,
  label: `Test ${id}`,
  create,
});

describe('eventBusAdapterRegistry (PP-14.2, #920)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('holds the two built-ins, registered through the public function, in the documented order', () => {
    expect(eventBusAdapterRegistry.name).toBe('host.event-bus-adapters');
    expect(eventBusAdapterRegistry.ids().slice(0, 2)).toEqual(['in-process', 'postgres']);
    expect(BUILTIN_EVENT_BUS_ADAPTERS).toEqual(['in-process', 'postgres']);
    expect(EVENT_BUS_ADAPTERS).toBe(BUILTIN_EVENT_BUS_ADAPTERS);
  });

  describe('registerEventBusAdapter', () => {
    it.each(['a', 'Redis', '1redis', 'redis_pub', 'x'.repeat(33), ''])('refuses the id %p', async (id) => {
      await withTemporaryEntries(eventBusAdapterRegistry, [], () => {
        expect(() => registerEventBusAdapter(adapter(id))).toThrow(RegistryError);
      });
    });

    it.each(['redis', 'nats-js', 'ab', 'a'.concat('b'.repeat(31))])('accepts the id %p', async (id) => {
      await withTemporaryEntries(eventBusAdapterRegistry, [], () => {
        expect(() => registerEventBusAdapter(adapter(id))).not.toThrow();
        expect(eventBusAdapterRegistry.has(id)).toBe(true);
      });
    });

    it('refuses a duplicate id and an adapter without a label or create', async () => {
      await withTemporaryEntries(eventBusAdapterRegistry, [], () => {
        expect(() => registerEventBusAdapter(adapter('postgres'))).toThrow(RegistryError);
        expect(() => registerEventBusAdapter({ ...adapter('no-label'), label: ' ' })).toThrow(/label/);
        expect(() => registerEventBusAdapter({ ...adapter('no-create'), create: undefined as never })).toThrow(/create/);
      });
    });
  });

  describe('createEventBus', () => {
    it('calls the registered adapter with its id, the config, a logger, the client and labelled metrics', () => {
      const bus = new InProcessEventBus();
      const create = jest.fn(() => bus);
      const config = new ConfigService({ redis: { url: 'x' } });
      const sql = { $executeRaw: jest.fn() };

      return withTemporaryEntries(eventBusAdapterRegistry, [adapter('ctx-bus', create)], async () => {
        const built = await createEventBus({ adapter: 'ctx-bus', recognised: true, configured: 'ctx-bus' }, sql, undefined, config);

        expect(built).toBe(bus);
        const ctx = (create.mock.calls[0] as unknown as [Record<string, unknown>])[0];
        expect(ctx).toMatchObject({ id: 'ctx-bus', config, prisma: sql });
        expect(ctx.logger).toBeInstanceOf(Logger);
        expect(typeof (ctx.metrics as { published: unknown }).published).toBe('function');
      });
    });

    it('throws for an unregistered id, naming it and listing the registered ones', () => {
      expect(() => createEventBus({ adapter: 'nope', recognised: true, configured: 'nope' }, undefined)).toThrow(
        /Unknown event bus adapter "nope".*Registered adapters: in-process, postgres/,
      );
    });

    it('lets the built-in postgres adapter refuse a missing client', () => {
      expect(() => createEventBus({ adapter: 'postgres', recognised: true, configured: 'postgres' }, undefined)).toThrow(/PLATFORM_PRISMA/);
      expect(createEventBus({ adapter: 'postgres', recognised: true, configured: 'postgres' }, { $executeRaw: jest.fn() })).toBeInstanceOf(PostgresEventBus);
    });
  });

  describe('selection', () => {
    it('recognises a registered id, case-insensitively', async () => {
      await withTemporaryEntries(eventBusAdapterRegistry, [adapter('redis')], () => {
        expect(parseEventBusAdapter(' Redis ')).toEqual({ adapter: 'redis', recognised: true, configured: 'Redis' });
        expect(selectEventBus('REDIS', { strict: true })).toMatchObject({ adapter: 'redis' });
      });
    });

    it('is strict on request and fail-safe otherwise', () => {
      expect(() => selectEventBus('nope', { strict: true })).toThrow(/Unknown event bus adapter "nope"/);
      expect(selectEventBus('nope')).toMatchObject({ adapter: 'in-process', recognised: false });
      expect(selectEventBus(undefined, { strict: true })).toMatchObject({ adapter: 'in-process', recognised: true });
    });
  });

  describe('the Doctor decision for an adapter the platform does not know', () => {
    const selection = { adapter: 'redis', recognised: true, configured: 'redis' };
    const health = { adapter: 'redis', connected: true, lastError: null, lastConnectedAt: null, publishFailures: 0, reconnects: 0 };

    it('passes when connected and warns, never fails, when not', () => {
      expect(decideEventBus(health, selection).status).toBe('pass');
      expect(decideEventBus({ ...health, connected: false, lastError: 'ECONNREFUSED' }, selection)).toMatchObject({
        status: 'warn',
        error: 'ECONNREFUSED',
      });
    });
  });
});
