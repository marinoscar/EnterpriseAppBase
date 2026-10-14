import { Injectable, OnModuleInit } from '@nestjs/common';

import type { IdentityEventBusHealth as EventBusHealth } from '../../ports';
import { DoctorCheck, DoctorCheckOutcome } from '../../../doctor/index';
import { DoctorCheckRegistry } from '../../../doctor/index';
import { PrincipalCache, type PrincipalCacheStats } from '../principal-cache/principal-cache.service';

/**
 * Pure: what the principal cache's TTL, its counters and the bus's snapshot
 * say about how fast a role change or deactivation reaches every replica.
 *
 * NEVER `fail`: whatever the bus does, a stale principal lives at most the
 * TTL, and every replica that made a change drops its own entry at once.
 */
export function decidePrincipalCache(
  ttlSeconds: number,
  stats: PrincipalCacheStats,
  bus: EventBusHealth,
): DoctorCheckOutcome {
  const data = {
    ttlSeconds,
    size: stats.size,
    hits: stats.hits,
    misses: stats.misses,
    invalidations: stats.invalidations,
    adapter: bus.adapter,
  };

  if (ttlSeconds <= 0) {
    return {
      status: 'skip',
      detail:
        'The JWT principal cache is off (AUTH_PRINCIPAL_CACHE_TTL_SECONDS=0): every request reads the ' +
        'user, roles and permissions from the database',
      data,
    };
  }

  if (bus.adapter === 'in-process') {
    return {
      status: 'warn',
      detail:
        `Principals are cached for up to ${ttlSeconds}s on an in-process event bus: correct for exactly ` +
        'one API replica, but with more than one, a role change or deactivation reaches the other ' +
        `replicas only when their entry expires (up to ${ttlSeconds}s)`,
      remedy:
        'Set EVENT_BUS_ADAPTER=postgres and restart every API replica so invalidations cross replicas, ' +
        'or set AUTH_PRINCIPAL_CACHE_TTL_SECONDS=0 to turn the cache off.',
      data,
    };
  }

  if (!bus.connected) {
    return {
      status: 'warn',
      detail:
        'The event bus listener is disconnected, so invalidations from other replicas are being missed; ' +
        `a role change or deactivation made elsewhere takes up to ${ttlSeconds}s to reach this replica`,
      remedy:
        'See the `core.event-bus` check for why the listener is down. Lower ' +
        'AUTH_PRINCIPAL_CACHE_TTL_SECONDS (0 disables the cache) to tighten the bound meanwhile.',
      ...(bus.lastError ? { error: bus.lastError } : {}),
      data,
    };
  }

  return {
    status: 'pass',
    detail:
      `Principals are cached for up to ${ttlSeconds}s and invalidated across replicas on the ` +
      `${bus.adapter} event bus; changes reach the next request`,
    data,
  };
}

/** `auth` / `auth.principal-cache` — the JWT principal cache's TTL and propagation (PP-1.12, #683). */
@Injectable()
export class PrincipalCacheDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'auth.principal-cache';
  readonly category = 'auth';
  readonly label = 'JWT principal cache';

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly cache: PrincipalCache,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  // Read-only: two in-memory snapshots (the cache's and its bus's), no I/O, no probe publish.
  async run(): Promise<DoctorCheckOutcome> {
    return decidePrincipalCache(this.cache.ttlMs / 1000, this.cache.stats(), this.cache.busHealth());
  }
}
