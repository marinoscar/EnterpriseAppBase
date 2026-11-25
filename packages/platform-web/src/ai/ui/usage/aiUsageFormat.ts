/**
 * Pure helpers shared by the admin AI Usage page and the user's "Usage"
 * section (issue #444, epic #420).
 */
import { addDaysToDateKey, isDateKey } from '@marinoscar/platform-contract/timezone';

import { formatDate } from '../../../core/index.js';
import type { AiUsageCost, AiUsageCounters, AiUsageReport, AiUsageSeriesEntry } from '../../headless/types.js';

const numberFormat = new Intl.NumberFormat('en-US');

/** `48000` → `48,000`. */
export function formatCount(value: number): string {
  return numberFormat.format(value);
}

/**
 * `failed / requests` as a percentage with one decimal, or an em dash when
 * nothing was requested — 0% would claim a success rate nobody measured.
 */
export function formatFailureRate(counters: Pick<AiUsageCounters, 'failed' | 'requests'>): string {
  if (counters.requests <= 0) return '—';
  return `${((counters.failed / counters.requests) * 100).toFixed(1)}%`;
}

/**
 * `2026-09-24` → `Sep 24`. The key is a calendar day already cut in the
 * report's zone (`report.timeZone`), not an instant, so it is formatted as the
 * day it names and never shifted by the viewer's zone (the key's own midnight
 * read in UTC is the same calendar day). Anything but a `YYYY-MM-DD` key is
 * returned as is.
 */
export function formatUsageDay(isoDate: string): string {
  const key = isoDate.slice(0, 10);
  if (!isDateKey(key)) return isoDate;
  return formatDate(`${key}T00:00:00Z`, { locale: 'en-US', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * A cost the deployment's pricing port reported (PP-14.17), as money: `$12.50`
 * for an ISO 4217 code, `12.50 credits` for any other label, an em dash when
 * there is none (no price for it, or mixed currencies).
 */
export function formatCost(cost: AiUsageCost | null | undefined): string {
  if (!cost) return '—';
  if (/^[A-Za-z]{3}$/.test(cost.currency)) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: cost.currency.toUpperCase(),
        maximumFractionDigits: cost.amount !== 0 && Math.abs(cost.amount) < 0.01 ? 4 : 2,
      }).format(cost.amount);
    } catch {
      // Not a currency the runtime knows: fall through to the plain form.
    }
  }
  return `${cost.amount.toFixed(2)} ${cost.currency}`;
}

/** `units` as `images: 4 · audioSeconds: 31.4`, or `null` when there are none. */
export function formatUnits(units: Record<string, number>): string | null {
  const entries = Object.entries(units ?? {}).filter(([, value]) => value > 0);
  if (entries.length === 0) return null;
  return entries.map(([key, value]) => `${key}: ${formatCount(value)}`).join(' · ');
}

/**
 * The `day` series, one entry per calendar day of the report's range.
 *
 * The keys are calendar days in the report's zone (`report.timeZone`). The
 * API may omit days with no activity; a time axis that skips them draws
 * two busy days as neighbours and hides the quiet stretch between them, so
 * the gaps are filled with zero entries here. Entries outside the range (a
 * backend that answers more than asked) are kept, in date order.
 */
export function fillDailySeries(report: AiUsageReport<string>): AiUsageSeriesEntry[] {
  const byKey = new Map(report.series.map((entry) => [entry.key, entry]));
  const sorted = () => [...report.series].sort((a, b) => a.key.localeCompare(b.key));
  // Calendar days of the report's zone: stepped as day keys, never as 24-hour
  // instants, so a 23- or 25-hour DST day cannot skip or repeat a key.
  const from = report.range.from.slice(0, 10);
  const to = report.range.to.slice(0, 10);
  if (!isDateKey(from) || !isDateKey(to) || to < from) return sorted();

  const days: AiUsageSeriesEntry[] = [];
  for (let key = from, n = 0; key <= to; key = addDaysToDateKey(key, 1), n += 1) {
    if (n > 366) return sorted();
    days.push(
      byKey.get(key) ?? {
        key,
        label: key,
        requests: 0,
        failed: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        units: {},
      },
    );
    byKey.delete(key);
  }
  return [...days, ...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}
