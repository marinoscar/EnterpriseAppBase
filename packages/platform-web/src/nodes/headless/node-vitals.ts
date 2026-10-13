// =============================================================================
// App-defined node vitals: how the fleet page words a number a node reports
// =============================================================================
//
// A node's heartbeat can carry `vitals.extra`, a bounded bag of `key -> number`
// that an executor or the node's app fills (`@marinoscar/platform-contract/nodes`:
// at most 16 keys, each a lower-case dotted identifier). The API stores it; this
// registry tells the vitals dialog what each key MEANS: a label an operator can
// read ("Transcode frames per second") and a unit, so `29.97` is not a bare
// number. An UNREGISTERED key is still shown, by its key and as a plain number:
// a node must never report something the page hides.
//
// Display only, like every vital: nothing here schedules on a self-reported
// number, and a number is never turned into a verdict.
//
// A module-level registry in the headless entry (the same shape as
// `registerFeatureNotice`): register at module scope, before the page renders.
// =============================================================================

import { NODE_VITALS_EXTRA_KEY_PATTERN } from '@marinoscar/platform-contract/nodes';

import { formatBytes } from '../internal/format-bytes.js';
import { formatDuration } from './format.js';

/**
 * The units a registered vital can be formatted in. Any other string is shown
 * after the number as typed (`'frames/s'`).
 *
 * @stability experimental
 */
export type NodeVitalUnit = 'count' | 'percent' | 'bytes' | 'milliseconds' | 'seconds' | (string & {});

/**
 * How one `vitals.extra` key reads on the fleet page.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export interface NodeVitalDef {
  /** The key a node sends in `vitals.extra`. Matches `NODE_VITALS_EXTRA_KEY_PATTERN`. */
  key: string;
  /** What an operator reads ("Transcode frames per second"). */
  label: string;
  /** How to word the number; see {@link NodeVitalUnit}. */
  unit: NodeVitalUnit;
}

const vitals = new Map<string, NodeVitalDef>();

/**
 * Registers (or, for an existing key, replaces) how an app-defined node vital
 * reads in the vitals dialog. Call it at module scope, before the page renders.
 *
 * @param def - the key, its label and its unit.
 * @throws Error when the key does not match `NODE_VITALS_EXTRA_KEY_PATTERN` or the label or unit is blank.
 *
 * @example
 * ```ts
 * registerNodeVital({ key: 'transcode.fps', label: 'Transcode frames per second', unit: 'frames/s' });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerNodeVital(def: NodeVitalDef): void {
  if (typeof def.key !== 'string' || !NODE_VITALS_EXTRA_KEY_PATTERN.test(def.key)) {
    throw new Error(`registerNodeVital: "${String(def.key)}" is not a vital key (${NODE_VITALS_EXTRA_KEY_PATTERN}).`);
  }
  for (const field of ['label', 'unit'] as const) {
    if (typeof def[field] !== 'string' || def[field].trim() === '') throw new Error(`registerNodeVital: ${field} is required`);
  }
  vitals.set(def.key, Object.freeze({ key: def.key, label: def.label, unit: def.unit }));
}

/**
 * The registration for `key`, or `undefined`.
 *
 * @param key - a `vitals.extra` key.
 * @returns the definition.
 *
 * @stability experimental
 */
export function nodeVitalFor(key: string): NodeVitalDef | undefined {
  return vitals.get(key);
}

/**
 * Every registered vital, in registration order.
 *
 * @returns the definitions.
 *
 * @stability experimental
 */
export function registeredNodeVitals(): NodeVitalDef[] {
  return [...vitals.values()];
}

function plain(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * One reported number in its registered unit: `87%`, `1.5 GB`, `29.97 frames/s`.
 * Total: a non-finite value reads as an em dash, an unregistered key as the bare
 * number.
 *
 * @param value - the reported number.
 * @param def - the key's registration, if any.
 * @returns the text to print.
 *
 * @stability experimental
 */
export function formatNodeVital(value: number, def: NodeVitalDef | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (def === undefined) return plain(value);
  switch (def.unit) {
    case 'count':
      return Math.round(value).toLocaleString();
    case 'percent':
      return `${plain(value)}%`;
    case 'bytes':
      return formatBytes(value);
    case 'milliseconds':
      return formatDuration(value);
    case 'seconds':
      return formatDuration(value * 1000);
    default:
      return `${plain(value)} ${def.unit}`;
  }
}

/**
 * The `vitals.extra` of a snapshot as rows to print: registered keys first (in
 * registration order), then the rest by key. At most 16, because the API refuses
 * more; a snapshot read from an older row is bounded here as well, and only
 * finite numbers survive.
 *
 * @param extra - the snapshot's `extra`, if any.
 * @returns label and text per key; empty when there is nothing to show.
 *
 * @stability experimental
 */
export function nodeVitalRows(extra: Record<string, number> | undefined): Array<{ key: string; label: string; text: string }> {
  if (extra === undefined || extra === null || typeof extra !== 'object') return [];
  const entries = Object.entries(extra).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)).slice(0, 16);
  const order = [...vitals.keys()];
  const rank = (key: string) => {
    const at = order.indexOf(key);
    return at === -1 ? Number.MAX_SAFE_INTEGER : at;
  };
  entries.sort(([a], [b]) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));

  return entries.map(([key, value]) => {
    const def = vitals.get(key);
    return { key, label: def?.label ?? key, text: formatNodeVital(value, def) };
  });
}
