// Moved from the reference app (apps/web/src/__tests__/pages/Admin/JobInsightsPage.test.tsx,
// issue #854): the per-type merge of the window's distribution and the
// all-time totals, a pure function of the Job Insights page.

import { describe, expect, it } from 'vitest';

import type { JobInsights } from '../../src/jobs/headless/index.js';
import { buildTypeInsightRows } from '../../src/jobs/ui/JobInsightsPage.js';

function insights(overrides: Partial<JobInsights> = {}): JobInsights {
  return {
    windowDays: 7,
    generatedAt: '2026-01-08T00:00:00.000Z',
    concurrency: 4,
    live: {
      total: 50,
      byStatus: { pending: 6, running: 2, succeeded: 40, failed: 2 },
      byType: [],
      scheduled: 3,
      rateLimited: 1,
      retried: 5,
    },
    history: {
      windowStart: '2026-01-01T00:00:00.000Z',
      throughputSince: '2026-01-07T23:00:00.000Z',
      overall: { samples: 40, avgMs: 2000, p50Ms: 1500, p95Ms: 9000, throughputPerMin: 0.67 },
      byType: [
        { type: 'image.thumbnail', label: 'Thumbnail', samples: 38, avgMs: 1800, p50Ms: 1500, p95Ms: 8000, throughputPerMin: 0.63 },
      ],
    },
    eta: [],
    lifetime: [
      { type: 'image.thumbnail', label: 'Thumbnail', succeeded: 900, failed: 12, total: 912, avgMs: 1900, durationSamples: 880 },
    ],
    ...overrides,
  };
}

describe('buildTypeInsightRows', () => {
  it('merges history and lifetime into one row per type', () => {
    const rows = buildTypeInsightRows(insights());

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'image.thumbnail',
      samples: 38,
      lifetimeTotal: 912,
      lifetimeSucceeded: 900,
    });
  });

  it('keeps a type that has lifetime totals but no runs inside the window', () => {
    // Its percentiles are null (the window has nothing to sort), but dropping
    // the row would hide a job type from a page whose whole purpose is
    // per-type comparison.
    const rows = buildTypeInsightRows(insights({ history: { ...insights().history, byType: [] } }));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.samples).toBe(0);
    expect(rows[0]!.p95Ms).toBeNull();
    expect(rows[0]!.lifetimeTotal).toBe(912);
  });

  it('keeps a type new in this window that has no lifetime rollup yet', () => {
    const rows = buildTypeInsightRows(insights({ lifetime: [] }));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.samples).toBe(38);
    expect(rows[0]!.lifetimeTotal).toBe(0);
  });
});
