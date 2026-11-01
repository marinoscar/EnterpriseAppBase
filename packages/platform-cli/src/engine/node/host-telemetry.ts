import { createHostVitalsSampler, type HostVitalsSampler } from './host-vitals.js';
import type { NodeEvent, NodeHostVitals, NodePower } from './node-api.js';
import { createPowerProbe, type PowerProbe } from './power-probe.js';
import { createPowerWatcher, type PowerWatcher } from './power-watcher.js';

/** What one collection yields. */
export interface HostTelemetrySnapshot {
  host: NodeHostVitals;
  power?: NodePower | undefined;
  /** Events newly observed by this collection. */
  events: NodeEvent[];
}

/**
 * The machine-level telemetry a heartbeat carries (host vitals, power, events),
 * bundled so the engine holds one object. See `host-vitals.ts`, `power-probe.ts`
 * and `power-watcher.ts`.
 *
 * @stability experimental
 */
export interface HostTelemetry {
  /** Sample everything and feed the watcher. NEVER REJECTS. */
  collect(input?: { disk?: { freeBytes?: number | undefined; totalBytes?: number | undefined } | undefined; fresh?: boolean }): Promise<HostTelemetrySnapshot>;
}

export interface HostTelemetryOptions {
  heartbeatMs: number;
  now?: (() => number) | undefined;
  sampler?: HostVitalsSampler | undefined;
  probe?: PowerProbe | undefined;
  watcher?: PowerWatcher | undefined;
}

/** @stability experimental */
export function createHostTelemetry(options: HostTelemetryOptions): HostTelemetry {
  const now = options.now ?? Date.now;
  const sampler = options.sampler ?? createHostVitalsSampler();
  const probe = options.probe ?? createPowerProbe();
  const watcher = options.watcher ?? createPowerWatcher({ heartbeatMs: options.heartbeatMs });

  return {
    async collect(input) {
      let host: NodeHostVitals = {};
      let power: NodePower | undefined;
      const events: NodeEvent[] = [];
      try {
        host = sampler.sample();
      } catch {
        // best-effort
      }
      try {
        power = await probe.read(input?.fresh === true ? { force: true } : undefined);
      } catch {
        power = undefined;
      }
      try {
        const at = now();
        events.push(...watcher.observe(power, at));
        events.push(...watcher.observeDisk(input?.disk?.freeBytes, input?.disk?.totalBytes, at));
      } catch {
        // best-effort
      }
      return { host, power, events };
    },
  };
}
