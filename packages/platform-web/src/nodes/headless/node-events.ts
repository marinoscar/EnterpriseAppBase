// =============================================================================
// Node events: how the Worker Nodes page words one (issue #1045)
// =============================================================================
//
// A node reports what it observed about itself on its heartbeat (a power
// change, a low battery, a wake from sleep, a low disk); the API stores each one
// and serves them at `GET /api/admin/nodes/:id/events`. These helpers turn one into
// text: a label for its type and a one-line summary of its attributes.
//
// The type is an OPEN dotted string: an app's node may report its own. A known
// type (`NODE_EVENT_TYPES`) reads by its label; an unknown one is still shown,
// humanized from its dotted name (`transcode.queue_full` -> "Transcode: queue
// full"), never hidden. Attributes are self-reported scalars; they are printed
// as plain text, bounded, and never turned into a verdict.
//
// Pure functions, no markup, so they live in the headless entry.
// =============================================================================

import { NODE_EVENT_TYPES } from '@marinoscar/platform-contract/nodes';

import { formatBytes } from '../internal/format-bytes.js';
import { formatDuration } from './format.js';
import type { WorkerNodeEvent } from './types.js';

/** The platform's own event types, as an operator reads them. */
const NODE_EVENT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  [NODE_EVENT_TYPES.POWER_SOURCE_CHANGED]: 'Power source changed',
  [NODE_EVENT_TYPES.BATTERY_LOW]: 'Battery low',
  [NODE_EVENT_TYPES.BATTERY_CRITICAL]: 'Battery critical',
  [NODE_EVENT_TYPES.BATTERY_RECOVERED]: 'Battery recovered',
  [NODE_EVENT_TYPES.SLEEP_RESUMED]: 'Resumed from sleep',
  [NODE_EVENT_TYPES.DISK_LOW]: 'Disk space low',
});

/**
 * Most attributes a summary of an unknown event prints.
 *
 * @stability experimental
 */
export const MAX_NODE_EVENT_SUMMARY_ATTRS = 4;

/** Longest attribute value a summary prints before an ellipsis. */
const MAX_ATTR_TEXT = 64;

function sentenceCase(text: string): string {
  const spaced = text.replace(/_/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * A dotted event type as words: the last segment is the event, the ones before
 * it its area (`transcode.queue_full` to "Transcode: queue full").
 *
 * @param type - the event's dotted type.
 * @returns the humanized text; the input itself when it has no segments.
 *
 * @stability experimental
 */
export function humanizeNodeEventType(type: string): string {
  const segments = type.split('.').filter((segment) => segment !== '');
  if (segments.length === 0) return type;
  if (segments.length === 1) return sentenceCase(segments[0]!);
  const last = segments[segments.length - 1]!;
  const area = segments.slice(0, -1).map(sentenceCase).join(' ');
  return `${area}: ${last.replace(/_/g, ' ')}`;
}

/**
 * How an event type reads: the platform's label for a `NODE_EVENT_TYPES` name,
 * else {@link humanizeNodeEventType}.
 *
 * @param type - the event's dotted type.
 * @returns the label.
 *
 * @stability experimental
 */
export function nodeEventLabel(type: string): string {
  return NODE_EVENT_LABELS[type] ?? humanizeNodeEventType(type);
}

type AttrValue = WorkerNodeEvent['attrs'][string];

function attrNumber(attrs: WorkerNodeEvent['attrs'], key: string): number | undefined {
  const value = attrs[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function percent(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

const POWER_SOURCE_WORDS: Readonly<Record<string, string>> = Object.freeze({ ac: 'AC', battery: 'Battery', unknown: 'Unknown' });

function powerSourceWord(value: AttrValue | undefined): string {
  if (typeof value !== 'string' || value === '') return '?';
  return POWER_SOURCE_WORDS[value] ?? value;
}

function plainAttr(value: AttrValue): string {
  const text = typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(value);
  return text.length > MAX_ATTR_TEXT ? `${text.slice(0, MAX_ATTR_TEXT - 1)}…` : text;
}

/**
 * One line that says what an event's attributes mean, or `null` when it has
 * none worth printing.
 *
 * Known types read as a sentence fragment ("AC → Battery (64%)", "12% (threshold
 * 20%)", "Asleep for 2h 03m", "4.5% free (1.2 GB)"); an unknown type, or a known
 * one missing the attributes its fragment needs, reads as `key: value` pairs, at
 * most {@link MAX_NODE_EVENT_SUMMARY_ATTRS} of them, sorted by key.
 *
 * @param event - the event (its `type` and `attrs`).
 * @returns the summary, or `null`.
 *
 * @stability experimental
 */
export function nodeEventSummary(event: Pick<WorkerNodeEvent, 'type' | 'attrs'>): string | null {
  const attrs = event.attrs && typeof event.attrs === 'object' ? event.attrs : {};
  const battery = attrNumber(attrs, 'batteryPercent');
  const threshold = attrNumber(attrs, 'threshold');

  switch (event.type) {
    case NODE_EVENT_TYPES.POWER_SOURCE_CHANGED:
      if (attrs.from !== undefined || attrs.to !== undefined) {
        const change = `${powerSourceWord(attrs.from)} → ${powerSourceWord(attrs.to)}`;
        return battery !== undefined ? `${change} (${percent(battery)})` : change;
      }
      break;
    case NODE_EVENT_TYPES.BATTERY_LOW:
    case NODE_EVENT_TYPES.BATTERY_CRITICAL:
    case NODE_EVENT_TYPES.BATTERY_RECOVERED:
      if (battery !== undefined) {
        return threshold !== undefined ? `${percent(battery)} (threshold ${percent(threshold)})` : percent(battery);
      }
      break;
    case NODE_EVENT_TYPES.SLEEP_RESUMED: {
      const gap = attrNumber(attrs, 'gapSeconds');
      if (gap !== undefined) return `Asleep for ${formatDuration(gap * 1000)}`;
      break;
    }
    case NODE_EVENT_TYPES.DISK_LOW: {
      const freePercent = attrNumber(attrs, 'freePercent');
      const freeBytes = attrNumber(attrs, 'freeBytes');
      if (freePercent !== undefined) {
        return freeBytes !== undefined ? `${percent(freePercent)} free (${formatBytes(freeBytes)})` : `${percent(freePercent)} free`;
      }
      if (freeBytes !== undefined) return `${formatBytes(freeBytes)} free`;
      break;
    }
    default:
      break;
  }

  const entries = Object.entries(attrs)
    .filter(([, value]) => typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return null;
  const shown = entries.slice(0, MAX_NODE_EVENT_SUMMARY_ATTRS).map(([key, value]) => `${key}: ${plainAttr(value)}`);
  const rest = entries.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} (+${rest} more)` : shown.join(', ');
}
