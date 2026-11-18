import './builtin-event-bus-adapters';
import { eventBusAdapterRegistry } from './event-bus-adapter.registry';
import type { EventBusAdapterName } from './event-bus.interface';

// =============================================================================
// `EVENT_BUS_ADAPTER` (PP-1.11, issue #682)
// =============================================================================
//
// DEPLOYMENT TOPOLOGY, NOT A RUNTIME SETTING. Which bus a process uses decides
// how replicas talk to each other, so it must be known before any of them
// boots and must agree across all of them; an admin toggle that flipped one
// replica at a time would split the fleet. Read once, at module init, from
// `configuration.ts` (`eventBus.adapter`).
//
// FAILS SAFE TOWARDS `in-process`, the same direction as `JOBS_WORKER_MODE`: an
// unregistered value of the ENVIRONMENT VARIABLE logs ONE warning and runs the
// single-process bus. (The `eventBusAdapter` OPTION of `forRoot` is code, so a
// wrong id there is a programming error and fails the boot instead: see
// `selectEventBus`.) Losing
// cross-replica liveness is a degradation (every consumer has a durable
// fallback); refusing to boot over a typo would be an outage. The Doctor's
// `core.event-bus` check keeps the typo visible after the boot log scrolls away.
// =============================================================================

/**
 * The adapter when `EVENT_BUS_ADAPTER` is unset or unrecognised.
 *
 * @stability experimental
 */
export const DEFAULT_EVENT_BUS_ADAPTER: EventBusAdapterName = 'in-process';

/**
 * DI token for the parsed selection, read by the bus factory and the Doctor check.
 *
 * @stability experimental
 */
export const EVENT_BUS_SELECTION: unique symbol = Symbol.for('@marinoscar/platform/EVENT_BUS_SELECTION');

/**
 * The selection reported when the app bound a whole bus (`forRoot({ eventBus })`):
 * no adapter was looked up, so there is nothing to recognise or misconfigure.
 *
 * @stability experimental
 */
export const BOUND_EVENT_BUS_SELECTION: EventBusSelection = Object.freeze({
  adapter: 'bound',
  recognised: true,
  configured: 'eventBus binding',
});

/**
 * Which adapter this process runs, and what was configured.
 *
 * @stability experimental
 */
export interface EventBusSelection {
  /** The adapter in use. */
  adapter: EventBusAdapterName;
  /** False when the configured value was not a registered adapter (and `in-process` was used). */
  recognised: boolean;
  /** What was configured, trimmed. Empty when unset. Never secret material. */
  configured: string;
}

/**
 * The adapter for a configured value. Unset or blank is the default (and is
 * recognised); anything else must be the id of a REGISTERED adapter
 * (`eventBusAdapterRegistry`: the built-ins and whatever the app registered),
 * case-insensitively.
 *
 * @param raw - the configured value (`EVENT_BUS_ADAPTER`).
 * @returns the selection; never throws.
 * @stability experimental
 */
export function parseEventBusAdapter(raw: unknown): EventBusSelection {
  const configured = typeof raw === 'string' ? raw.trim() : '';

  if (configured === '') {
    return { adapter: DEFAULT_EVENT_BUS_ADAPTER, recognised: true, configured };
  }

  const value = configured.toLowerCase();

  return eventBusAdapterRegistry.has(value)
    ? { adapter: value, recognised: true, configured }
    : { adapter: DEFAULT_EVENT_BUS_ADAPTER, recognised: false, configured };
}
