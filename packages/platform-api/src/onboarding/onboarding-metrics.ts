// =============================================================================
// Activation metrics (issue #745, PP-9.3): one read-only aggregate statement
// =============================================================================
//
// EvoPath's `OnboardingMetricsService`, generalised: the milestone and the
// funnel come from the registries instead of being written into the SQL.
//
//   * cohort     users with created_at in [now - days, now]
//   * eligible   cohort users created at least `windowDays` ago (per milestone)
//   * activated  eligible users who reached the milestone within `windowDays`
//   * median     hours from sign-up to the milestone, over cohort users who
//                reached it (eligible or not), never counting a missing one as 0
//   * funnel     per user step with `funnelSql`, cohort users with it done now
//
// AGGREGATES ONLY: the statement returns one row of counts; no id, no email,
// no per-user value ever leaves the database. Every value is a positional
// parameter; the only SQL text spliced in is the developer-authored
// `firstReachedAtSql` / `funnelSql` of registered entries (refused at
// registration if it contains `;`) and validated integers.
// =============================================================================

import type { OnboardingMetricsResponse } from '@marinoscar/platform-contract/onboarding';
import { Inject, Injectable } from '@nestjs/common';

import { activationMilestoneRegistry, onboardingStepRegistry } from './onboarding.registries';
import type { ActivationMilestoneDef, OnboardingStepDef } from './onboarding.types';
import { ONBOARDING_DATA, type OnboardingDataPort } from './ports';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The statement {@link buildOnboardingMetricsSql} builds.
 *
 * @stability experimental
 */
export interface OnboardingMetricsQuery {
  /** The SQL text with positional parameters. */
  text: string;
  /** The parameter values, in order. */
  values: unknown[];
  /** Column alias per milestone and funnel step, in order. */
  columns: { milestones: string[]; steps: string[] };
}

/**
 * Builds the one aggregate statement for a cohort window.
 *
 * @param input - the cohort bounds, the milestones and the funnel steps.
 * @returns the statement, its values and its column aliases.
 *
 * @stability experimental
 */
export function buildOnboardingMetricsSql(input: {
  cohortStart: Date;
  now: Date;
  milestones: readonly ActivationMilestoneDef[];
  funnelSteps: readonly OnboardingStepDef[];
}): OnboardingMetricsQuery {
  const values: unknown[] = [input.cohortStart, input.now];
  const reached = input.milestones.map((m, i) => `(${m.firstReachedAtSql}) AS m${i}_at`);
  const done = input.funnelSteps.map((s, i) => `(${s.funnelSql}) AS f${i}_done`);

  const aggregates = ['count(*)::int AS cohort_size'];
  input.milestones.forEach((m, i) => {
    const days = Math.trunc(m.windowDays);
    const window = `make_interval(days => ${days})`;
    aggregates.push(`(count(*) FILTER (WHERE r.created_at <= $2::timestamptz - ${window}))::int AS m${i}_eligible`);
    aggregates.push(
      `(count(*) FILTER (WHERE r.created_at <= $2::timestamptz - ${window} AND r.m${i}_at IS NOT NULL ` +
        `AND r.m${i}_at <= r.created_at + ${window}))::int AS m${i}_activated`,
    );
    aggregates.push(
      `percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(EXTRACT(EPOCH FROM (r.m${i}_at - r.created_at)), 0)::double precision / 3600.0) ` +
        `FILTER (WHERE r.m${i}_at IS NOT NULL) AS m${i}_median`,
    );
  });
  input.funnelSteps.forEach((_s, i) => {
    aggregates.push(`(count(*) FILTER (WHERE r.f${i}_done))::int AS f${i}_completed`);
  });

  const text = [
    'WITH cohort AS (',
    '  SELECT u.id, u.created_at FROM users u',
    '  WHERE u.created_at >= $1::timestamptz AND u.created_at <= $2::timestamptz',
    '), reached AS (',
    `  SELECT ${['c.id', 'c.created_at', ...reached, ...done].join(', ')} FROM cohort c`,
    ')',
    `SELECT ${aggregates.join(', ')} FROM reached r`,
  ].join('\n');

  return {
    text,
    values,
    columns: {
      milestones: input.milestones.map((_m, i) => `m${i}`),
      steps: input.funnelSteps.map((_s, i) => `f${i}`),
    },
  };
}

function toInt(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function ratio(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

/**
 * Computes `GET /api/admin/onboarding/metrics`: one statement through
 * `ONBOARDING_DATA.queryAggregate`. An on-demand read bounded by the cohort
 * (at most a year of sign-ups), not a queue job.
 *
 * @stability experimental
 */
@Injectable()
export class OnboardingMetricsService {
  /** @param data - the app's data port. */
  constructor(@Inject(ONBOARDING_DATA) private readonly data: OnboardingDataPort) {}

  /**
   * The metrics for the users created in the last `days` days.
   *
   * @param days - the cohort window (1 to 365; validated by the route).
   * @param now - the window's end (tests pin it).
   * @returns the aggregates.
   */
  async metrics(days: number, now: Date = new Date()): Promise<OnboardingMetricsResponse> {
    const milestones = activationMilestoneRegistry.list();
    const funnelSteps = onboardingStepRegistry
      .list()
      .filter((step) => step.audience === 'user' && step.funnelSql !== undefined)
      .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
    const query = buildOnboardingMetricsSql({
      cohortStart: new Date(now.getTime() - days * DAY_MS),
      now,
      milestones,
      funnelSteps,
    });

    const rows = await this.data.queryAggregate<Record<string, unknown>>(query.text, query.values);
    const row = rows[0] ?? {};
    const cohortSize = toInt(row['cohort_size']);

    return {
      windowDays: days,
      cohortSize,
      milestones: milestones.map((m, i) => {
        const eligible = toInt(row[`m${i}_eligible`]);
        const activated = toInt(row[`m${i}_activated`]);
        const median = row[`m${i}_median`];
        return {
          id: m.id,
          label: m.label,
          windowDays: m.windowDays,
          eligible,
          activated,
          activationRate: ratio(activated, eligible),
          medianHours: median === null || median === undefined ? null : Math.round(Number(median) * 10) / 10,
        };
      }),
      steps: funnelSteps.map((s, i) => {
        const completed = toInt(row[`f${i}_completed`]);
        return { id: s.id, title: s.title, completed, rate: ratio(completed, cohortSize) };
      }),
    };
  }
}
