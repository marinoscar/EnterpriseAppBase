// Activation metrics (issue #745): the SQL builder and the arithmetic.
import { withTemporaryEntries } from '../../src/core/index';
import {
  OnboardingMetricsService,
  activationMilestoneRegistry,
  buildOnboardingMetricsSql,
  onboardingStepRegistry,
} from '../../src/onboarding/index';
import { boolStep, fakeData } from './support';

const MILESTONE = {
  id: 'first_thing',
  label: 'First thing',
  windowDays: 7,
  firstReachedAtSql: '(SELECT MIN(t.created_at) FROM things t WHERE t.user_id = c.id)',
};
const NOW = new Date('2026-06-30T00:00:00.000Z');

describe('buildOnboardingMetricsSql', () => {
  it('builds one statement with the cohort as parameters and nothing per user in the output', () => {
    const query = buildOnboardingMetricsSql({ cohortStart: new Date('2026-06-01T00:00:00.000Z'), now: NOW, milestones: [], funnelSteps: [] });
    expect(query.values).toEqual([new Date('2026-06-01T00:00:00.000Z'), NOW]);
    expect(query.text).toContain('FROM users u');
    expect(query.text).toMatch(/SELECT count\(\*\)::int AS cohort_size FROM reached r$/);
    expect(query.text).not.toContain(';');
  });

  it('adds eligible, activated and median per milestone and a completed count per funnel step', () => {
    const query = buildOnboardingMetricsSql({
      cohortStart: NOW,
      now: NOW,
      milestones: [MILESTONE],
      funnelSteps: [boolStep('user.a', 'f', { funnelSql: 'EXISTS (SELECT 1)' })],
    });
    expect(query.text).toContain(`(${MILESTONE.firstReachedAtSql}) AS m0_at`);
    expect(query.text).toContain('make_interval(days => 7)');
    for (const column of ['m0_eligible', 'm0_activated', 'm0_median', 'f0_completed']) expect(query.text).toContain(`AS ${column}`);
    expect(query.text).toContain('FILTER (WHERE r.m0_at IS NOT NULL)');
    expect(query.columns).toEqual({ milestones: ['m0'], steps: ['f0'] });
  });
});

describe('OnboardingMetricsService', () => {
  it('reports cohort and funnel only without a milestone', () =>
    withTemporaryEntries(onboardingStepRegistry, [boolStep('user.a', 'f', { funnelSql: 'true' }), boolStep('user.nofunnel', 'f')], async () => {
      const data = fakeData({ queryAggregate: async () => [{ cohort_size: 4, f0_completed: 1 }] as never });
      const result = await new OnboardingMetricsService(data).metrics(30, NOW);
      expect(result).toEqual({
        windowDays: 30,
        cohortSize: 4,
        milestones: [],
        steps: [{ id: 'user.a', title: 'Title user.a', completed: 1, rate: 0.25 }],
      });
    }));

  it('reports rate and a one-decimal median with a milestone, and null on empty denominators', () =>
    withTemporaryEntries(activationMilestoneRegistry, [MILESTONE], async () => {
      const data = fakeData({
        queryAggregate: async () => [{ cohort_size: 10, m0_eligible: 4, m0_activated: 1, m0_median: 12.345 }] as never,
      });
      const result = await new OnboardingMetricsService(data).metrics(30, NOW);
      expect(result.milestones).toEqual([
        { id: 'first_thing', label: 'First thing', windowDays: 7, eligible: 4, activated: 1, activationRate: 0.25, medianHours: 12.3 },
      ]);

      const empty = await new OnboardingMetricsService(fakeData({ queryAggregate: async () => [{ cohort_size: 0 }] as never })).metrics(7, NOW);
      expect(empty.milestones[0]).toEqual(expect.objectContaining({ eligible: 0, activationRate: null, medianHours: null }));
    }));
});
