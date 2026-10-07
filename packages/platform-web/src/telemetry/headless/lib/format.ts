/**
 * Number, time and change formatting for the Telemetry Dashboard (#578).
 * Pure functions, so the tiles and tables stay presentation-only.
 */

/**
 * A tile value as a number, or `null` (`int8` may arrive as a string).
 *
 * @stability experimental
 */
export function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

const compact = (n: number, digits = 1) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits });

/**
 * A duration in milliseconds at a readable scale: `8.5 ms`, `120 ms`, `1.25 s`.
 *
 * @param ms - the duration in milliseconds.
 * @returns the value and its unit, separated by a space.
 *
 * @stability experimental
 */
export function formatDuration(ms: number): string {
  if (ms >= 1000) return `${compact(ms / 1000, 2)} s`;
  return `${compact(ms, ms < 10 ? 1 : 0)} ms`;
}

/**
 * A byte count in binary units: `512 B`, `1.5 KB`, `3.2 GB`.
 *
 * @param bytes - the count.
 * @returns the value and its unit, separated by a space.
 *
 * @stability experimental
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (Math.abs(value) >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${compact(value, unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/**
 * A duration in seconds at a readable scale: `42 s`, `12.5 min`, `3.2 h`,
 * `4.1 d` — a queue age of 5400 s reads better as 1.5 h.
 *
 * @stability experimental
 */
export function formatSeconds(seconds: number): string {
  const abs = Math.abs(seconds);
  if (abs < 1) return `${compact(seconds * 1000, 0)} ms`;
  if (abs < 60) return `${compact(seconds, abs < 10 ? 2 : 1)} s`;
  if (abs < 3600) return `${compact(seconds / 60, 1)} min`;
  if (abs < 48 * 3600) return `${compact(seconds / 3600, 1)} h`;
  return `${compact(seconds / 86_400, 1)} d`;
}

function split(text: string): { value: string; unit: string } {
  const at = text.indexOf(' ');
  return at < 0 ? { value: text, unit: '' } : { value: text.slice(0, at), unit: text.slice(at + 1) };
}

/**
 * `value` and its unit, split so a tile can style them apart. Covers the
 * summary's units (`req/min`, `%`, `ms`, `count`, `bytes`, `timestamp`) and
 * every metric unit of `/metrics` (#601): `bytes/s`, `per_s`, `per_min`,
 * `seconds`, `hours`, `days`, `cores`, `load`, `text` and `boolean`. An
 * unknown unit is shown as given.
 *
 * @stability experimental
 */
export function formatTileValue(
  value: number | string | null,
  unit: string,
  now: number = Date.now(),
): { value: string; unit: string } {
  if (unit === 'timestamp') {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return { value: '—', unit: '' };
    return { value: formatRelative(value, now), unit: '' };
  }
  if (unit === 'text') {
    return value === null || value === '' ? { value: '—', unit: '' } : { value: String(value), unit: '' };
  }
  const n = toNumber(value);
  if (n === null) return { value: '—', unit: '' };
  switch (unit) {
    case '%':
      return { value: compact(n, 2), unit: '%' };
    case 'ms': {
      const [amount, suffix] = formatDuration(n).split(' ');
      return { value: amount!, unit: suffix! };
    }
    case 'bytes': {
      const [amount, suffix] = formatBytes(n).split(' ');
      return { value: amount!, unit: suffix! };
    }
    case 'count':
      return { value: Math.round(n).toLocaleString(), unit: '' };
    case 'bytes/s': {
      const [amount, suffix] = formatBytes(n).split(' ');
      return { value: amount!, unit: `${suffix!}/s` };
    }
    case 'per_s':
      return { value: compact(n, 2), unit: '/s' };
    case 'per_min':
      return { value: compact(n, 2), unit: '/min' };
    case 'seconds':
      return split(formatSeconds(n));
    case 'hours':
      return n >= 48 ? { value: compact(n / 24, 1), unit: 'd' } : { value: compact(n, 1), unit: 'h' };
    case 'days':
      return { value: compact(n, 1), unit: Math.abs(n) === 1 ? 'day' : 'days' };
    case 'cores':
      return { value: compact(n, 2), unit: Math.abs(n) === 1 ? 'core' : 'cores' };
    case 'load':
      return { value: compact(n, 2), unit: '' };
    case 'boolean':
      return { value: n >= 1 ? 'Yes' : 'No', unit: '' };
    default:
      return { value: compact(n, 2), unit };
  }
}

/**
 * A tile value or table cell as one string (`—` for nothing), e.g. `35.6%`, `1.2 GB`, `Yes`.
 *
 * @stability experimental
 */
export function formatMetricValue(
  value: number | string | boolean | null | undefined,
  unit: string,
  now: number = Date.now(),
): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const formatted = formatTileValue(value, unit, now);
  if (!formatted.unit) return formatted.value;
  return formatted.unit === '%' || formatted.unit.startsWith('/')
    ? `${formatted.value}${formatted.unit}`
    : `${formatted.value} ${formatted.unit}`;
}

/**
 * "5s ago", "3m ago", "2h ago", "4d ago"; "just now" under a second.
 *
 * @stability experimental
 */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '—';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 1) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * A readable absolute timestamp (local time, to the second).
 *
 * @stability experimental
 */
export function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  return new Date(then).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * A bucket's x-axis label: time of day, plus the date for multi-day spans.
 *
 * @stability experimental
 */
export function formatBucketLabel(iso: string, spanMs: number): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const date = new Date(then);
  if (spanMs > 24 * 60 * 60_000) {
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Which direction is bad for a tile: up for errors and latency, none for
 * traffic (more requests is neither good nor bad on its own).
 *
 * @stability experimental
 */
export type ChangeDirection = 'up-is-bad' | 'down-is-bad' | 'neutral';

const TILE_DIRECTIONS: Record<string, ChangeDirection> = {
  requestsPerMin: 'neutral',
  errorRatePct: 'up-is-bad',
  p95Ms: 'up-is-bad',
  errorLogs: 'up-is-bad',
  warnLogs: 'up-is-bad',
  unknownRoutes: 'up-is-bad',
  heapUsedBytes: 'up-is-bad',
  eventLoopDelayP99Ms: 'up-is-bad',
  // `/metrics` tiles (#601): utilization, ages, failures and stalls up is bad;
  // headroom (cache hits, healthy nodes, certificate days) down is bad.
  cpuUtilization: 'up-is-bad',
  memoryUtilization: 'up-is-bad',
  load1m: 'up-is-bad',
  filesystemUtilization: 'up-is-bad',
  dbConnectionUtilization: 'up-is-bad',
  dbCacheHitRatio: 'down-is-bad',
  dbRollbacks: 'up-is-bad',
  dbDeadlocks: 'up-is-bad',
  'queueDepth.pending': 'up-is-bad',
  oldestPendingAge: 'up-is-bad',
  jobFailureRatio: 'up-is-bad',
  jobDurationP95: 'up-is-bad',
  backupAge: 'up-is-bad',
  'nodesByHealth.healthy': 'down-is-bad',
  'nodesByHealth.stale': 'up-is-bad',
  'nodesByHealth.offline': 'up-is-bad',
  noEligibleNode: 'up-is-bad',
  httpDuration: 'up-is-bad',
  tlsDaysLeft: 'down-is-bad',
  exporterFailed: 'up-is-bad',
  exporterQueueUtilization: 'up-is-bad',
  receiverRefused: 'up-is-bad',
  greptimeWriteStalls: 'up-is-bad',
  scrapeTargetsDown: 'up-is-bad',
};

/**
 * Whether a rising value is bad, good or neither for the tile `key`.
 *
 * @param key - the tile's key.
 * @returns the tile's direction (`neutral` for an unknown key).
 *
 * @stability experimental
 */
export function tileDirection(key: string): ChangeDirection {
  return TILE_DIRECTIONS[key] ?? 'neutral';
}

/**
 * A tile's change against the previous window of equal length.
 *
 * @stability experimental
 */
export interface TileChange {
  /** Percent change, rounded; `null` when there is no comparable previous value. */
  pct: number | null;
  /** Which way the value moved. */
  trend: 'up' | 'down' | 'flat';
  /** How to colour it. */
  tone: 'good' | 'bad' | 'neutral';
}

/**
 * A tile's change against its previous value, toned by `direction`.
 *
 * @param value - the current value.
 * @param previous - the previous window's value.
 * @param direction - from {@link tileDirection}.
 * @returns the change, its trend and its tone.
 *
 * @stability experimental
 */
export function tileChange(
  value: number | string | null,
  previous: number | string | null,
  direction: ChangeDirection,
): TileChange {
  const current = toNumber(value);
  const before = toNumber(previous);
  if (current === null || before === null) return { pct: null, trend: 'flat', tone: 'neutral' };
  if (before === 0) {
    if (current === 0) return { pct: 0, trend: 'flat', tone: 'neutral' };
    return { pct: null, trend: 'up', tone: direction === 'up-is-bad' ? 'bad' : direction === 'down-is-bad' ? 'good' : 'neutral' };
  }
  const pct = Math.round(((current - before) / Math.abs(before)) * 1000) / 10;
  if (pct === 0) return { pct: 0, trend: 'flat', tone: 'neutral' };
  const trend = pct > 0 ? 'up' : 'down';
  let tone: TileChange['tone'] = 'neutral';
  if (direction === 'up-is-bad') tone = trend === 'up' ? 'bad' : 'good';
  if (direction === 'down-is-bad') tone = trend === 'down' ? 'bad' : 'good';
  return { pct, trend, tone };
}
