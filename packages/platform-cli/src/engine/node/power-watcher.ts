import type { NodeEvent } from './node-api.js';
import type { PowerState } from './power-probe.js';

// =============================================================================
// Power / sleep / disk event watcher  (issue #1045)
// =============================================================================
//
// Turns successive observations into edge-triggered events. Pure state machine:
// the caller supplies the wall clock, so tests need no timers. The FIRST
// observation is a baseline and emits nothing (a node starting on a low battery
// does not announce it, but will announce its recovery).
// =============================================================================

/** Event type names (mirror the contract's `NODE_EVENT_TYPES`). */
const T = {
  source: 'power.source_changed',
  low: 'power.battery_low',
  critical: 'power.battery_critical',
  recovered: 'power.battery_recovered',
  sleep: 'node.sleep_resumed',
  disk: 'node.disk_low',
} as const;

/** Percentage points above a threshold a battery must climb to re-arm. */
export const BATTERY_HYSTERESIS = 5;
/** Disk-free fraction below which `node.disk_low` fires. */
export const DISK_LOW_FRACTION = 0.05;
/** Disk-free fraction above which it re-arms. */
export const DISK_RECOVER_FRACTION = 0.1;

export interface PowerWatcherOptions {
  lowPercent?: number | undefined;
  criticalPercent?: number | undefined;
  /** The heartbeat cadence; a wall-clock gap over 3x this is a sleep. */
  heartbeatMs: number;
}

/**
 * @stability experimental
 */
export interface PowerWatcher {
  /** Feed one power observation (`undefined` when unknown) taken at `wallClockNow` (epoch ms). */
  observe(power: PowerState | undefined, wallClockNow: number): NodeEvent[];
  /** Feed the state directory's free/total bytes. */
  observeDisk(freeBytes: number | undefined, totalBytes: number | undefined, wallClockNow: number): NodeEvent[];
}

/**
 * Build a watcher.
 *
 * @stability experimental
 */
export function createPowerWatcher(options: PowerWatcherOptions): PowerWatcher {
  const lowPercent = options.lowPercent ?? 20;
  const criticalPercent = options.criticalPercent ?? 10;
  const sleepGapMs = 3 * options.heartbeatMs;

  let lastAt: number | undefined;
  let lastSource: PowerState['source'] | undefined;
  let lowLatched = false;
  let criticalLatched = false;
  let baselined = false;
  let diskLatched = false;

  const iso = (ms: number): string => new Date(ms).toISOString();

  return {
    observe(power, now) {
      const events: NodeEvent[] = [];
      const previousAt = lastAt;
      lastAt = now;
      if (previousAt !== undefined && now - previousAt > sleepGapMs) {
        events.push({ type: T.sleep, severity: 'info', at: iso(now), attrs: { gapSeconds: Math.round((now - previousAt) / 1000) } });
      }
      if (power === undefined) return events;

      const pct = power.batteryPercent;
      const first = !baselined;
      baselined = true;

      if (!first) {
        if (lastSource !== undefined && lastSource !== power.source && power.source !== 'unknown' && lastSource !== 'unknown') {
          events.push({
            type: T.source,
            severity: power.source === 'battery' ? 'warning' : 'info',
            at: iso(now),
            attrs: { from: lastSource, to: power.source, ...(pct !== undefined ? { batteryPercent: pct } : {}) },
          });
        }
      }
      if (power.source !== 'unknown') lastSource = power.source;
      else lastSource ??= 'unknown';

      if (pct !== undefined) {
        const onBattery = power.source === 'battery';
        if (first) {
          lowLatched = onBattery && pct < lowPercent;
          criticalLatched = onBattery && pct < criticalPercent;
        } else {
          if (onBattery && pct < criticalPercent && !criticalLatched) {
            criticalLatched = true;
            lowLatched = true;
            events.push({ type: T.critical, severity: 'critical', at: iso(now), attrs: { batteryPercent: pct, threshold: criticalPercent } });
          } else if (onBattery && pct < lowPercent && !lowLatched) {
            lowLatched = true;
            events.push({ type: T.low, severity: 'warning', at: iso(now), attrs: { batteryPercent: pct, threshold: lowPercent } });
          }
          if (criticalLatched && pct >= criticalPercent + BATTERY_HYSTERESIS) criticalLatched = false;
          if (lowLatched && pct >= lowPercent + BATTERY_HYSTERESIS) {
            lowLatched = false;
            criticalLatched = false;
            events.push({ type: T.recovered, severity: 'info', at: iso(now), attrs: { batteryPercent: pct } });
          }
        }
      }
      return events;
    },

    observeDisk(freeBytes, totalBytes, now) {
      if (freeBytes === undefined || totalBytes === undefined || !(totalBytes > 0)) return [];
      const fraction = freeBytes / totalBytes;
      if (!diskLatched && fraction < DISK_LOW_FRACTION) {
        diskLatched = true;
        return [
          {
            type: T.disk,
            severity: 'warning',
            at: iso(now),
            attrs: { freePercent: Math.round(fraction * 1000) / 10, freeBytes: Math.round(freeBytes) },
          },
        ];
      }
      if (diskLatched && fraction >= DISK_RECOVER_FRACTION) diskLatched = false;
      return [];
    },
  };
}
