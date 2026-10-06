import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { DoctorCheckRegistry } from '../../doctor/doctor-check.registry';
import { PrismaService } from '../../prisma/prisma.service';
import { EVENT_BUS_SELECTION } from './event-bus.config';
import { EVENT_BUS, type EventBus } from './event-bus.interface';
import { createEventBus, EventBusModule } from './event-bus.module';
import { InProcessEventBus } from './in-process-event-bus';
import { PostgresEventBus } from './postgres-event-bus';

describe('EventBusModule (PP-1.11, #682)', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  async function boot(adapter: string | undefined) {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ eventBus: { adapter } })] }),
        EventBusModule,
      ],
    })
      .useMocker((token) => {
        if (token === PrismaService) return { $executeRaw: jest.fn() };
        if (token === DoctorCheckRegistry) return new DoctorCheckRegistry();
        return undefined;
      })
      .compile();
    return moduleRef;
  }

  it('provides the in-process bus by default', async () => {
    const moduleRef = await boot(undefined);
    expect(moduleRef.get<EventBus>(EVENT_BUS)).toBeInstanceOf(InProcessEventBus);
    expect(moduleRef.get(EVENT_BUS_SELECTION)).toMatchObject({ adapter: 'in-process', recognised: true });
    await moduleRef.close();
  });

  it('falls back to in-process with one warning for an unrecognised value', async () => {
    const moduleRef = await boot('redis');
    expect(moduleRef.get<EventBus>(EVENT_BUS)).toBeInstanceOf(InProcessEventBus);
    expect(moduleRef.get(EVENT_BUS_SELECTION)).toMatchObject({ recognised: false, configured: 'redis' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('EVENT_BUS_ADAPTER');
    await moduleRef.close();
  });

  it('builds the Postgres adapter for postgres', () => {
    const bus = createEventBus(
      { adapter: 'postgres', recognised: true, configured: 'postgres' },
      { $executeRaw: jest.fn() } as unknown as PrismaService,
    );
    expect(bus).toBeInstanceOf(PostgresEventBus);
    expect(bus.health().connected).toBe(false);
  });
});
