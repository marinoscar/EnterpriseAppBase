// =============================================================================
// The jobs slice's formatting helpers (issue #854)
// =============================================================================
//
// Moved from the reference app's `pages/Admin/jobsTable.tsx`, where the Job
// Insights page, the worker-fleet tables and the app's own backup and About
// pages already shared them: one formatter for the same milliseconds, so a
// page never reads "1500ms" beside one reading "1.5 s" for the same number.
// Pure functions, no markup, so they live in the headless entry.
// =============================================================================

/**
 * A duration, in the largest unit that still says something: `850 ms`,
 * `1.5 s`, `4m 05s`, `2h 03m`, `3d 4h`.
 *
 * `null` (and `undefined`, and a non-finite number) renders as an em dash
 * rather than "0 ms": the API's nullable durations mean "no succeeded jobs to
 * measure", and printing a zero would state a measurement that was never taken.
 *
 * @param ms - the duration in milliseconds.
 * @returns the formatted duration, or an em dash.
 *
 * @stability experimental
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;

  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)} s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${String(remainingMinutes).padStart(2, '0')}m`;

  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/**
 * A timestamp in the viewer's locale, or an em dash when the API sent `null`.
 *
 * @param value - an ISO 8601 timestamp, or `null`.
 * @returns the localized date and time, or an em dash.
 *
 * @stability experimental
 */
export function formatDateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : '—';
}

/**
 * The first 8 characters of a UUID: enough to tell two rows apart by eye.
 *
 * @param id - the id.
 * @returns its first 8 characters.
 *
 * @stability experimental
 */
export function shortId(id: string): string {
  return id.slice(0, 8);
}
