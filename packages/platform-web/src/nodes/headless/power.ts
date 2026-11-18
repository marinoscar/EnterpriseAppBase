// =============================================================================
// A node's power state, as the Worker Nodes page words it (issue #1045)
// =============================================================================
//
// A node on a laptop reports `vitals.power` (source, battery charge, charging);
// the fleet table shows a badge for it. This module is the badge's words and
// level, without markup: the UI draws the icon and the colour from the level,
// and the SAME sentence is its accessible label, so nothing rests on colour.
//
// Display only: a node on battery is not "unhealthy", and nothing here turns
// the reading into a health verdict (health is the API's, from the heartbeat).
// An `unknown` or absent source draws nothing: a desktop that cannot tell is not
// worth a badge on every row.
// =============================================================================

import type { NodePower } from './types.js';

/**
 * At or under this battery charge the badge reads in the warning colour.
 *
 * @stability experimental
 */
export const NODE_BATTERY_WARNING_PERCENT = 20;

/**
 * At or under this battery charge the badge reads in the error colour.
 *
 * @stability experimental
 */
export const NODE_BATTERY_CRITICAL_PERCENT = 10;

/**
 * A node's power state, ready to draw.
 *
 * @stability experimental
 */
export interface NodePowerDescription {
  /** Where power comes from (`unknown` is never described). */
  source: 'ac' | 'battery';
  /** Battery charge, rounded to a whole percent, or `null` when not reported. */
  percent: number | null;
  /** Whether the battery is charging, or `null` when not reported. */
  charging: boolean | null;
  /** `warning` at or under 20%, `error` at or under 10%, on battery only. */
  level: 'normal' | 'warning' | 'error';
  /** The short visible text: `42%`, `AC`. */
  text: string;
  /** The full sentence, the accessible label: "On battery, 42%, discharging". */
  label: string;
}

/**
 * The badge's words and level for a node's reported power, or `null` when
 * there is nothing to draw (no report, or source `unknown`).
 *
 * @param power - `lastVitals.power`, if any.
 * @returns the description, or `null`.
 *
 * @stability experimental
 */
export function describeNodePower(power: NodePower | null | undefined): NodePowerDescription | null {
  if (!power || typeof power !== 'object') return null;
  const percent =
    typeof power.batteryPercent === 'number' && Number.isFinite(power.batteryPercent)
      ? Math.round(Math.min(100, Math.max(0, power.batteryPercent)))
      : null;
  const charging = typeof power.charging === 'boolean' ? power.charging : null;

  if (power.source === 'ac') {
    const parts = ['On AC power'];
    if (percent !== null) parts.push(`battery ${percent}%`);
    if (charging === true) parts.push('charging');
    return { source: 'ac', percent, charging, level: 'normal', text: 'AC', label: parts.join(', ') };
  }
  if (power.source !== 'battery') return null;

  const level =
    percent !== null && percent <= NODE_BATTERY_CRITICAL_PERCENT
      ? 'error'
      : percent !== null && percent <= NODE_BATTERY_WARNING_PERCENT
        ? 'warning'
        : 'normal';
  const parts = ['On battery'];
  if (percent !== null) parts.push(`${percent}%`);
  if (charging !== null) parts.push(charging ? 'charging' : 'discharging');
  if (power.lowPowerMode === true) parts.push('low power mode');
  return {
    source: 'battery',
    percent,
    charging,
    level,
    text: percent !== null ? `${percent}%` : 'Battery',
    label: parts.join(', '),
  };
}
