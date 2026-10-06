import { Inject, Injectable, OnModuleInit } from '@nestjs/common';

import { DoctorCheck, DoctorCheckOutcome } from '@marinoscar/platform-api/doctor';
import { DoctorCheckRegistry } from '@marinoscar/platform-api/doctor';
import { EVENT_BUS_SELECTION, EventBusSelection } from '../event-bus.config';
import { EVENT_BUS, type EventBus, type EventBusHealth } from '../event-bus.interface';

const POOLER_REMEDY =
  'Check that POSTGRES_HOST/POSTGRES_PORT reach Postgres directly or through a session-mode pool: ' +
  'a transaction-mode pooler (PgBouncer in transaction mode, RDS Proxy) cannot carry LISTEN. ' +
  'Check the POSTGRES_* credentials and the API log for "Event bus listener". ' +
  'Live events are degraded meanwhile; notifications are still stored and jobs still poll.';

/**
 * Pure: what the bus's own snapshot says about cross-replica liveness.
 *
 * NEVER `fail`. Every consumer of the bus has a durable fallback (the table,
 * the poll), so the worst a broken bus does is make things slower — a `warn`.
 */
export function decideEventBus(health: EventBusHealth, selection: EventBusSelection): DoctorCheckOutcome {
  const data = {
    adapter: health.adapter,
    configured: selection.configured || null,
    connected: health.connected,
    lastConnectedAt: health.lastConnectedAt,
    publishFailures: health.publishFailures,
    reconnects: health.reconnects,
  };

  if (!selection.recognised) {
    return {
      status: 'warn',
      detail:
        `EVENT_BUS_ADAPTER "${selection.configured}" is not recognised; using single-process ` +
        'delivery, so live events do not cross API replicas',
      remedy: 'Set EVENT_BUS_ADAPTER to `postgres` (or `in-process` for exactly one API replica) and restart the API.',
      data,
    };
  }

  if (health.adapter === 'postgres') {
    if (health.connected) {
      return {
        status: 'pass',
        detail: `Postgres LISTEN/NOTIFY listener connected${
          health.lastConnectedAt ? ` since ${health.lastConnectedAt}` : ''
        }; live events reach every API replica`,
        data,
      };
    }

    return {
      status: 'warn',
      detail: 'The Postgres LISTEN/NOTIFY listener is disconnected; live events from other replicas are being missed',
      remedy: POOLER_REMEDY,
      ...(health.lastError ? { error: health.lastError } : {}),
      data,
    };
  }

  return {
    status: 'pass',
    detail:
      'In-process event bus: single-process delivery; set `EVENT_BUS_ADAPTER=postgres` before running ' +
      'more than one API replica',
    data,
  };
}

/**
 * `core` / `core.event-bus` — which event bus this process uses and whether it
 * is connected.
 *
 * READ-ONLY AND I/O-FREE: it reads `bus.health()`, a synchronous in-memory
 * snapshot. It never publishes a probe message (a publish would reach every
 * replica's subscribers) and never opens a connection.
 */
@Injectable()
export class EventBusDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'core.event-bus';
  readonly category = 'core';
  readonly label = 'Event bus';

  constructor(
    private readonly registry: DoctorCheckRegistry,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(EVENT_BUS_SELECTION) private readonly selection: EventBusSelection,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    return decideEventBus(this.bus.health(), this.selection);
  }
}
