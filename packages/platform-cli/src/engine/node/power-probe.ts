import { execFile } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { NodePower } from './node-api.js';

// =============================================================================
// Power / battery probe  (issue #1045)
// =============================================================================
//
// Reads whether the machine runs on AC or battery. Per-platform strategies,
// each reading one fixed source (sysfs, `pmset`, PowerShell/CIM) with `execFile`
// and fixed arguments (never a shell). Every read has a 2 s timeout, results are
// cached for 30 s (a watcher may force a fresh read), and NOTHING THROWS: a
// probe that cannot tell returns `undefined`, which the heartbeat omits.
//
// TEST-ONLY: when `PLATFORM_NODE_POWER_FIXTURE` names a JSON file, every read
// returns that file's `NodePower` instead (re-read each time, never cached), so
// an end-to-end test can flip the power state deterministically. Not a feature.
// =============================================================================

/** The power state; the same shape the contract's `nodePowerSchema` accepts. */
export type PowerState = NodePower;

/** The test-only fixture variable. */
export const POWER_FIXTURE_ENV = 'PLATFORM_NODE_POWER_FIXTURE';
/** How long one power command may run. */
export const POWER_PROBE_TIMEOUT_MS = 2000;
/** How long a read is reused. */
export const POWER_PROBE_CACHE_MS = 30_000;
/** Mirrors the contract's `timeRemainingSeconds` ceiling (7 days). */
export const MAX_POWER_TIME_REMAINING_SECONDS = 7 * 24 * 60 * 60;

/**
 * Reads the machine's power state.
 *
 * @stability experimental
 */
export interface PowerProbe {
  /** The power state, or `undefined` when unknown. NEVER REJECTS. `force` skips the cache. */
  read(options?: { force?: boolean }): Promise<PowerState | undefined>;
}

// -----------------------------------------------------------------------------
// Pure parsers
// -----------------------------------------------------------------------------

/** One entry of `/sys/class/power_supply`, files already read (trimmed). */
export interface PowerSupplyEntry {
  type?: string | undefined;
  online?: string | undefined;
  capacity?: string | undefined;
  status?: string | undefined;
  scope?: string | undefined;
  timeToEmptyNow?: string | undefined;
}

function percent(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : undefined;
}

function seconds(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(MAX_POWER_TIME_REMAINING_SECONDS, Math.round(value));
}

/** Linux: reduce the power supplies to a state. Peripherals (`scope: Device`) are ignored. */
export function parseLinuxPowerSupplies(entries: PowerSupplyEntry[]): PowerState | undefined {
  const own = entries.filter((e) => e.scope?.toLowerCase() !== 'device');
  const mains = own.filter((e) => /^(mains|usb)/i.test(e.type ?? ''));
  const battery = own.find((e) => (e.type ?? '').toLowerCase() === 'battery');
  const mainsOnline = mains.some((e) => e.online?.trim() === '1');

  if (battery === undefined) return mainsOnline ? { source: 'ac' } : undefined;

  const state: PowerState = { source: 'unknown' };
  const pct = percent(battery.capacity);
  if (pct !== undefined) state.batteryPercent = pct;
  const status = (battery.status ?? '').toLowerCase();
  if (status === 'charging') state.charging = true;
  else if (status === 'discharging' || status === 'full' || status === 'not charging') state.charging = false;

  if (mainsOnline || status === 'charging' || status === 'full') state.source = 'ac';
  else if (status === 'discharging') state.source = 'battery';
  else if (mains.length > 0) state.source = 'battery'; // mains present and offline

  const tte = battery.timeToEmptyNow === undefined ? undefined : Number(battery.timeToEmptyNow);
  if (state.source === 'battery') {
    const t = seconds(tte);
    if (t !== undefined && t > 0) state.timeRemainingSeconds = t;
  }
  return state;
}

/** macOS: parse `pmset -g batt`. */
export function parsePmsetBatt(output: string): PowerState | undefined {
  const header = /Now drawing from '([^']*)'/i.exec(output);
  if (header === null) return undefined;
  const label = (header[1] ?? '').toLowerCase();
  const source = label.includes('ac') ? 'ac' : label.includes('battery') || label.includes('ups') ? 'battery' : 'unknown';
  const state: PowerState = { source };

  const line = output.split('\n').find((l) => /\d+%/.test(l));
  if (line === undefined) return state;
  const pct = percent(/(\d+)%/.exec(line)?.[1]);
  if (pct !== undefined) state.batteryPercent = pct;
  if (/;\s*(charging|finishing charge)\b/i.test(line)) state.charging = true;
  else if (/;\s*(discharging|charged|ac attached)\b/i.test(line)) state.charging = false;
  const remaining = /(\d+):(\d{2})\s+remaining/.exec(line);
  if (remaining !== null && source === 'battery') {
    const t = seconds(Number(remaining[1]) * 3600 + Number(remaining[2]) * 60);
    if (t !== undefined && t > 0) state.timeRemainingSeconds = t;
  }
  return state;
}

/** Windows' "unknown" `EstimatedRunTime` (minutes). */
export const WIN_UNKNOWN_RUN_TIME = 71_582_788;

/** Windows: parse the JSON of `Get-CimInstance Win32_Battery` (an object, an array, or empty). */
export function parseWindowsBattery(output: string): PowerState | undefined {
  const text = output.trim();
  // No battery (a desktop) prints nothing: it is on mains.
  if (text.length === 0) return { source: 'ac' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const rows = (Array.isArray(parsed) ? parsed : [parsed]).filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null);
  const row = rows[0];
  if (row === undefined) return { source: 'ac' };

  const status = Number(row['BatteryStatus']);
  const state: PowerState = { source: 'unknown' };
  if ([1, 4, 5].includes(status)) state.source = 'battery';
  else if ([2, 3, 6, 7, 8, 9, 11].includes(status)) state.source = 'ac';
  if ([6, 7, 8, 9].includes(status)) state.charging = true;
  else if ([1, 2, 3, 4, 5, 11].includes(status)) state.charging = false;
  const pct = percent(row['EstimatedChargeRemaining']);
  if (pct !== undefined) state.batteryPercent = pct;
  const run = Number(row['EstimatedRunTime']);
  if (state.source === 'battery' && Number.isFinite(run) && run > 0 && run !== WIN_UNKNOWN_RUN_TIME) {
    const t = seconds(run * 60);
    if (t !== undefined) state.timeRemainingSeconds = t;
  }
  return state;
}

// -----------------------------------------------------------------------------
// Strategies and the probe
// -----------------------------------------------------------------------------

/** The I/O a strategy needs. Injectable. */
export interface PowerProbeIo {
  platform: NodeJS.Platform;
  /** Run a program with fixed args; resolve stdout. Rejects on failure or timeout. */
  exec(file: string, args: string[], timeoutMs: number): Promise<string>;
  readdir(path: string): string[];
  /** File text, trimmed, or `undefined` when unreadable. */
  readFile(path: string): string | undefined;
  readEnv(name: string): string | undefined;
  now(): number;
}

const SYSFS = '/sys/class/power_supply';

function realIo(): PowerProbeIo {
  return {
    platform: process.platform,
    exec: (file, args, timeoutMs) =>
      new Promise((resolve, reject) => {
        execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout) => {
          if (error !== null) reject(error);
          else resolve(String(stdout));
        });
      }),
    readdir: (path) => readdirSync(path),
    readFile: (path) => {
      try {
        return readFileSync(path, 'utf8').trim();
      } catch {
        return undefined;
      }
    },
    readEnv: (name) => process.env[name],
    now: () => Date.now(),
  };
}

function readLinux(io: PowerProbeIo): PowerState | undefined {
  let names: string[];
  try {
    names = io.readdir(SYSFS);
  } catch {
    return undefined;
  }
  const entries = names.map((name): PowerSupplyEntry => {
    const dir = join(SYSFS, name);
    return {
      type: io.readFile(join(dir, 'type')),
      online: io.readFile(join(dir, 'online')),
      capacity: io.readFile(join(dir, 'capacity')),
      status: io.readFile(join(dir, 'status')),
      scope: io.readFile(join(dir, 'scope')),
      timeToEmptyNow: io.readFile(join(dir, 'time_to_empty_now')),
    };
  });
  return parseLinuxPowerSupplies(entries);
}

const WIN_COMMAND =
  'Get-CimInstance Win32_Battery | Select-Object BatteryStatus,EstimatedChargeRemaining,EstimatedRunTime | ConvertTo-Json -Compress';

async function readOnce(io: PowerProbeIo): Promise<PowerState | undefined> {
  switch (io.platform) {
    case 'linux':
      return readLinux(io);
    case 'darwin':
      return parsePmsetBatt(await io.exec('pmset', ['-g', 'batt'], POWER_PROBE_TIMEOUT_MS));
    case 'win32':
      return parseWindowsBattery(
        await io.exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_COMMAND], POWER_PROBE_TIMEOUT_MS),
      );
    default:
      return undefined;
  }
}

function readFixture(io: PowerProbeIo, path: string): PowerState | undefined {
  try {
    const text = io.readFile(path);
    if (text === undefined) return undefined;
    const raw = JSON.parse(text) as Record<string, unknown>;
    const source = raw['source'];
    if (source !== 'ac' && source !== 'battery' && source !== 'unknown') return undefined;
    const state: PowerState = { source };
    const pct = percent(raw['batteryPercent']);
    if (pct !== undefined) state.batteryPercent = pct;
    if (typeof raw['charging'] === 'boolean') state.charging = raw['charging'];
    if (typeof raw['lowPowerMode'] === 'boolean') state.lowPowerMode = raw['lowPowerMode'];
    const t = typeof raw['timeRemainingSeconds'] === 'number' ? seconds(raw['timeRemainingSeconds']) : undefined;
    if (t !== undefined) state.timeRemainingSeconds = t;
    return state;
  } catch {
    return undefined;
  }
}

/**
 * Build the platform's power probe.
 *
 * @param io - test seam.
 * @param cacheMs - how long a read is reused (default 30 s).
 * @stability experimental
 */
export function createPowerProbe(io: PowerProbeIo = realIo(), cacheMs: number = POWER_PROBE_CACHE_MS): PowerProbe {
  let cached: { at: number; value: PowerState | undefined } | undefined;
  let inFlight: Promise<PowerState | undefined> | undefined;

  return {
    async read(options) {
      try {
        const fixture = io.readEnv(POWER_FIXTURE_ENV);
        if (fixture !== undefined && fixture.length > 0) return readFixture(io, fixture);

        if (options?.force !== true && cached !== undefined && io.now() - cached.at < cacheMs) return cached.value;
        if (inFlight !== undefined) return await inFlight;
        inFlight = readOnce(io)
          .catch(() => undefined)
          .then((value) => {
            cached = { at: io.now(), value };
            return value;
          })
          .finally(() => {
            inFlight = undefined;
          });
        return await inFlight;
      } catch {
        return undefined;
      }
    },
  };
}
