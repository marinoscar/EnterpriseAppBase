// =============================================================================
// Alerts in words (issue #1047): labels for severities, states, comparators,
// aggregations and kinds, and the summary's totals. Pure; no React.
// =============================================================================

import { ALERT_KIND_IDS } from '@marinoscar/platform-contract/alerts';
import type {
  AlertAggregation,
  AlertComparator,
  AlertIncidentState,
  AlertSeverity,
  AlertSummary,
} from '@marinoscar/platform-contract/alerts';

/**
 * A status tone, mapped to an MUI colour by the UI. The words carry the
 * meaning; the tone only reinforces it.
 *
 * @stability experimental
 */
export type AlertTone = 'error' | 'warning' | 'info' | 'success' | 'default';

/**
 * Each severity in words.
 *
 * @stability experimental
 */
export const ALERT_SEVERITY_LABELS: Readonly<Record<AlertSeverity, string>> = Object.freeze({
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
});

/**
 * The tone of each severity.
 *
 * @stability experimental
 */
export const ALERT_SEVERITY_TONES: Readonly<Record<AlertSeverity, AlertTone>> = Object.freeze({
  critical: 'error',
  warning: 'warning',
  info: 'info',
});

/**
 * Each incident state in words.
 *
 * @stability experimental
 */
export const ALERT_STATE_LABELS: Readonly<Record<AlertIncidentState, string>> = Object.freeze({
  pending: 'Pending',
  firing: 'Firing',
  resolved: 'Resolved',
});

/**
 * The tone of each incident state.
 *
 * @stability experimental
 */
export const ALERT_STATE_TONES: Readonly<Record<AlertIncidentState, AlertTone>> = Object.freeze({
  pending: 'warning',
  firing: 'error',
  resolved: 'success',
});

/**
 * Each comparator in words and as a symbol.
 *
 * @stability experimental
 */
export const ALERT_COMPARATOR_LABELS: Readonly<Record<AlertComparator, string>> = Object.freeze({
  gt: 'greater than (>)',
  gte: 'at least (≥)',
  lt: 'less than (<)',
  lte: 'at most (≤)',
  eq: 'equal to (=)',
  neq: 'not equal to (≠)',
});

/**
 * Each aggregation in words.
 *
 * @stability experimental
 */
export const ALERT_AGGREGATION_LABELS: Readonly<Record<AlertAggregation, string>> = Object.freeze({
  avg: 'Average',
  max: 'Maximum',
  min: 'Minimum',
  sum: 'Sum',
  last: 'Last value',
  rate: 'Rate per minute',
});

const BUILTIN_KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  [ALERT_KIND_IDS.METRIC_THRESHOLD]: 'Metric threshold',
  [ALERT_KIND_IDS.NODE_EVENT]: 'Node event',
  [ALERT_KIND_IDS.VERDICT]: 'Dashboard verdict',
  [ALERT_KIND_IDS.NODE_OFFLINE]: 'Node offline',
  [ALERT_KIND_IDS.TELEMETRY_UNAVAILABLE]: 'Telemetry unavailable',
});

/**
 * A kind id in words: the label `GET /kinds` gave, else the built-in label,
 * else the id itself.
 *
 * @param kind - the kind id.
 * @param kinds - the registered kinds, when loaded.
 * @returns the label.
 *
 * @stability experimental
 */
export function alertKindLabel(kind: string, kinds: ReadonlyArray<{ id: string; label: string }> = []): string {
  return kinds.find((entry) => entry.id === kind)?.label ?? BUILTIN_KIND_LABELS[kind] ?? kind;
}

/**
 * The firing count of a summary, in total.
 *
 * @param summary - `GET /admin/alerts/summary`.
 * @returns critical + warning + info.
 *
 * @stability experimental
 */
export function alertFiringTotal(summary: Pick<AlertSummary, 'firing'> | null | undefined): number {
  if (!summary) return 0;
  return summary.firing.critical + summary.firing.warning + summary.firing.info;
}

/**
 * The most serious severity that has a firing incident, or `null`.
 *
 * @param summary - `GET /admin/alerts/summary`.
 * @returns the severity.
 *
 * @stability experimental
 */
export function alertTopSeverity(summary: Pick<AlertSummary, 'firing'> | null | undefined): AlertSeverity | null {
  if (!summary) return null;
  if (summary.firing.critical > 0) return 'critical';
  if (summary.firing.warning > 0) return 'warning';
  if (summary.firing.info > 0) return 'info';
  return null;
}

/**
 * An incident's labels as `key=value` text, in key order; `''` for none.
 *
 * @param labels - the labels.
 * @returns the text.
 *
 * @stability experimental
 */
export function formatAlertLabels(labels: Readonly<Record<string, string>>): string {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}=${labels[key]}`)
    .join(', ');
}

/**
 * A duration in seconds as short words (`90` is `1 min 30 s`, `3600` is `1 h`).
 *
 * @param seconds - whole seconds.
 * @returns the text.
 *
 * @stability experimental
 */
export function formatAlertSeconds(seconds: number): string {
  if (seconds <= 0) return '0 s';
  const parts: string[] = [];
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (days) parts.push(`${days} d`);
  if (hours) parts.push(`${hours} h`);
  if (minutes) parts.push(`${minutes} min`);
  if (rest) parts.push(`${rest} s`);
  return parts.join(' ');
}
