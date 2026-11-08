import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useMemo, type ReactNode } from 'react';

import { ApiClient, resolveApiBaseUrl } from '../../api-client.js';
import { resolveConfig } from '../../config.js';
import { formatDuration } from '../../node/node-dashboard-source.js';
import { fetchJobsInsights, jobsInsightsReducer, type JobsDashboardData, type JobsPollResult } from '../dashboard/jobs-insights.js';
import { DashboardSource, pollFeed, type DashboardConnection } from '../dashboard/source.js';
import { useDashboard } from '../dashboard/use-dashboard.js';
import { useTuiTheme } from '../context.js';
import { ErrorNotice, Field, Frame } from '../layout.js';
import type { TuiScreenProps } from '../screen-registry.js';
import { ScrollBox } from '../scroll-box.js';
import { textColor } from '../theme.js';

// =============================================================================
// The jobs-queue screen  (RETRO-G1.3, epic #1064)
// =============================================================================
//
// A server-side dashboard on the same pattern as the worker screen: a pure
// reducer (`jobsInsightsReducer`) fed by `pollFeed` over the platform's admin
// jobs API. It uses the caller's own credential, so the SERVER decides who may
// see it (`jobs:read`): a 403 renders a notice here, never a crash, and the
// poll keeps going so a grant takes effect without reopening the screen.
//
// Read-only: it shows the queue and sends nothing but GETs.
// =============================================================================

/** How often the queue is re-read. */
export const JOBS_POLL_INTERVAL_MS = 5_000;

type JobsSource = DashboardSource<JobsDashboardData, JobsPollResult>;

/** Builds the screen's source for a server and token. Exported for tests. */
export function createJobsSource(serverUrl: string, token: string, intervalMs: number = JOBS_POLL_INTERVAL_MS): JobsSource {
  const api = new ApiClient({ baseUrl: resolveApiBaseUrl(serverUrl), token });
  return new DashboardSource(jobsInsightsReducer, pollFeed(fetchJobsInsights(api), { intervalMs }));
}

export function JobsScreen({ onDone }: TuiScreenProps): ReactNode {
  const theme = useTuiTheme();

  const source = useMemo<JobsSource | undefined>(() => {
    try {
      const { serverUrl, token } = resolveConfig();
      return serverUrl === undefined || token === undefined ? undefined : createJobsSource(serverUrl, token);
    } catch {
      return undefined;
    }
  }, []);

  const state = useDashboard(source) as (JobsDashboardData & DashboardConnection) | undefined;

  useInput((_input, key) => {
    if (key.escape) onDone();
  });

  const lines = useMemo(() => {
    const eta = state?.insights?.eta ?? [];
    return eta.map(
      (row) =>
        `${row.label.padEnd(28)} ${String(row.pending).padStart(6)} pending ${String(row.running).padStart(4)} running` +
        `  ${row.remaining === 0 ? 'done' : `~${formatDuration(row.estimatedMs)}`}`,
    );
  }, [state?.insights]);

  if (source === undefined || state === undefined) {
    return (
      <Frame title="Jobs queue" hints={['esc back']}>
        <ErrorNotice message="Not logged in." hint="Choose Login from the menu first." />
      </Frame>
    );
  }

  if (state.forbidden !== undefined) {
    return (
      <Frame title="Jobs queue" hints={['esc back']}>
        <Text {...textColor(theme.warning)}>{state.forbidden}</Text>
      </Frame>
    );
  }

  if (state.stats === undefined || state.insights === undefined) {
    return (
      <Frame title="Jobs queue" hints={['esc back']}>
        <Box flexDirection="column" gap={1}>
          <Text>
            <Spinner type="dots" /> {state.error ?? 'Reading the queue…'}
          </Text>
          {state.error !== undefined ? <ErrorNotice message={state.error} /> : null}
        </Box>
      </Frame>
    );
  }

  const { stats, insights } = state;
  const overall = insights.history.overall;

  return (
    <Frame title="Jobs queue" hints={['↑↓ scroll', 'esc back']}>
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Field
            label="Status"
            value={
              `${stats.byStatus.pending} pending · ${stats.byStatus.running} running · ` +
              `${stats.byStatus.succeeded} succeeded · ${stats.byStatus.failed} failed`
            }
          />
          <Field label="Backing off" value={String(stats.scheduled)} />
          <Field
            label="Stuck"
            value={`${stats.stuckRunning} (over ${stats.stuckThresholdMinutes} min)`}
            {...(stats.stuckRunning > 0 ? textColor(theme.error) : {})}
          />
          <Field
            label="Throughput"
            value={`${overall.throughputPerMin.toFixed(1)}/min · p50 ${ms(overall.p50Ms)} · p95 ${ms(overall.p95Ms)} (${insights.windowDays}d)`}
          />
          <Field label="Updated" value={state.updatedAt ?? '—'} dim />
        </Box>
        {state.error !== undefined ? <Text {...textColor(theme.warning)}>Last refresh failed: {state.error}</Text> : null}
        <Box flexDirection="column">
          <Text bold>Estimated completion</Text>
          {lines.length === 0 ? <Text dimColor>Nothing queued.</Text> : <ScrollBox lines={lines} reservedRows={16} isActive />}
        </Box>
      </Box>
    </Frame>
  );
}

function ms(value: number | null): string {
  return value === null ? '—' : formatDuration(value);
}
