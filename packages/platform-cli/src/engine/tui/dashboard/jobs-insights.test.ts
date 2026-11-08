import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../errors.js';
import { fetchJobsInsights, jobsInsightsReducer, type JobsInsights, type JobsStats } from './jobs-insights.js';

const counts = { pending: 1, running: 2, succeeded: 3, failed: 4 };
const stats: JobsStats = { byStatus: counts, scheduled: 0, stuckRunning: 0, stuckThresholdMinutes: 3 };
const insights: JobsInsights = {
  windowDays: 7,
  history: { overall: { throughputPerMin: 0, p50Ms: null, p95Ms: null } },
  eta: [],
};

function forbidden(): ApiError {
  return new ApiError({
    status: 403,
    serverMessage: 'Forbidden',
    code: 'FORBIDDEN',
    details: undefined,
    method: 'GET',
    url: 'http://x/api/admin/jobs/stats',
    structured: true,
    rawBody: undefined,
  });
}

describe('jobsInsightsReducer', () => {
  it('replaces the previous sample with the next and clears a forbidden notice', () => {
    const first = jobsInsightsReducer.reduce(jobsInsightsReducer.initial(), { kind: 'ok', at: 't1', stats, insights });
    expect(first).toMatchObject({ updatedAt: 't1', forbidden: undefined });

    const denied = jobsInsightsReducer.reduce(first, { kind: 'forbidden', at: 't2', message: 'no' });
    // The last good sample is kept; the notice is added.
    expect(denied.stats).toBe(stats);
    expect(denied.forbidden).toBe('no');

    const again = jobsInsightsReducer.reduce(denied, { kind: 'ok', at: 't3', stats, insights });
    expect(again.forbidden).toBeUndefined();
  });

  it('is pure and validates raw frames', () => {
    const state = Object.freeze(jobsInsightsReducer.initial());
    const next = jobsInsightsReducer.reduce(state, { kind: 'ok', at: 't', stats, insights });
    expect(next).not.toBe(state);
    expect(state.stats).toBeUndefined();

    expect(jobsInsightsReducer.parseEvent({ kind: 'ok', at: 't', stats, insights })).toBeDefined();
    expect(jobsInsightsReducer.parseEvent({ kind: 'forbidden', at: 't', message: 'm' })).toBeDefined();
    expect(jobsInsightsReducer.parseEvent({ kind: 'ok' })).toBeUndefined();
    expect(jobsInsightsReducer.parseEvent(5)).toBeUndefined();
  });
});

describe('fetchJobsInsights', () => {
  const now = () => new Date('2026-01-01T00:00:05.000Z');

  it('reads stats and insights, passing the abort signal and the window', async () => {
    const get = vi.fn(async (path: string) => (path.endsWith('/stats') ? stats : insights));
    const controller = new AbortController();
    const result = await fetchJobsInsights({ get: get as never }, { windowDays: 14, now })(controller.signal);

    expect(result).toEqual({ kind: 'ok', at: '2026-01-01T00:00:05.000Z', stats, insights });
    expect(get).toHaveBeenCalledWith('/admin/jobs/stats', { signal: controller.signal });
    expect(get).toHaveBeenCalledWith('/admin/jobs/insights', { signal: controller.signal, query: { windowDays: 14 } });
  });

  it('turns a 403 into a notice instead of throwing', async () => {
    const result = await fetchJobsInsights(
      {
        get: (async () => {
          throw forbidden();
        }) as never,
      },
      { now },
    )(new AbortController().signal);
    expect(result.kind).toBe('forbidden');
    expect(result.kind === 'forbidden' && result.message).toContain('jobs:read');
  });

  it('lets any other failure through for the feed to report', async () => {
    await expect(
      fetchJobsInsights({
        get: (async () => {
          throw new Error('network down');
        }) as never,
      })(new AbortController().signal),
    ).rejects.toThrow('network down');
  });
});
