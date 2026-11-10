/**
 * The platform's own dashboard panels, `api` and `logs`, as views (PP-14.18).
 *
 * Each is the JSX the dashboard page used to hold inline, moved here unchanged:
 * a `DashboardPanel` frame around the timeline chart, with the panel's own data
 * hook, its "Open in Explorer" / "Ask assistant" actions from the page's
 * `host` and its empty message. They register through the same
 * `registerPlatformDashboardPanelView` an app's view uses, so the dashboard
 * draws its two headline panels the way it draws any panel.
 */
import { useMemo } from 'react';

import { useDashboardTimeseries } from '../../../../headless/hooks/useTelemetryDashboard.js';
import type { DashboardLogsBucket, DashboardSeverity } from '../../../../headless/services/telemetryDashboard.js';
import { ApiTimelineChart } from '../ApiTimelineChart.js';
import { DashboardPanel } from '../DashboardPanel.js';
import type { DashboardLayout } from '../DashboardFilterBar.js';
import { LogSeverityChart } from '../LogSeverityChart.js';
import { SeverityChips } from '../severity.js';
import { timelineHeight } from '../timelineAxis.js';
import {
  getDashboardPanelView,
  registerPlatformDashboardPanelView,
  type DashboardPanelViewProps,
} from './dashboardPanelViews.js';

/** Zoom gestures per layout: drag on desktop, drag or tap on tablet, tap on phones. */
const ZOOM_MODES: Record<DashboardLayout, { drag: boolean; tap: boolean }> = {
  desktop: { drag: true, tap: false },
  tablet: { drag: true, tap: true },
  phone: { drag: false, tap: true },
};

/** Whether any bucket holds a record of a selected band (`other` rides with `info`). */
function hasSelectedLogs(buckets: DashboardLogsBucket[], sev: DashboardSeverity[]): boolean {
  return buckets.some(
    (bucket) =>
      (sev.includes('error') && bucket.error > 0) ||
      (sev.includes('warn') && bucket.warn > 0) ||
      (sev.includes('info') && bucket.info + bucket.other > 0),
  );
}

/** The platform's `api` panel: requests per bucket by status class, and p95. */
export function ApiPanelView({ query, tick, layout, spanMs, host }: DashboardPanelViewProps<undefined>) {
  const series = useDashboardTimeseries('api', query, tick);
  const isPhone = layout === 'phone';
  return (
    <DashboardPanel
      id="panel-api"
      title="API requests"
      actions={host.actionsFor(
        'panel-api',
        series.data?.sql,
        series.data ? { kind: 'api', title: 'API requests', buckets: series.data.buckets } : null,
      )}
      sql={series.data?.sql}
      isLoading={series.isLoading}
      isRefreshing={series.isRefreshing}
      error={series.error}
      onRetry={series.reload}
      isEmpty={!!series.data && series.data.buckets.length === 0}
      emptyMessage="No requests in this window."
      skeletonHeight={timelineHeight(layout)}
    >
      {series.data && (
        <ApiTimelineChart
          buckets={series.data.buckets}
          height={timelineHeight(layout)}
          spanMs={spanMs}
          compact={isPhone}
          zoom={ZOOM_MODES[layout]}
          onZoomBuckets={host.zoomTo(
            series.data.buckets.map((bucket) => bucket.t),
            series.data.range.bucketSeconds,
          )}
        />
      )}
    </DashboardPanel>
  );
}

/** The platform's `logs` panel: log records per bucket by severity, with the severity filter. */
export function LogsPanelView({ query, tick, layout, spanMs, host }: DashboardPanelViewProps<undefined>) {
  const series = useDashboardTimeseries('logs', query, tick);
  const isPhone = layout === 'phone';
  const { state, update } = host;
  const headerExtra = useMemo(
    () => (
      <SeverityChips
        value={state.sev}
        onChange={(sev) => update({ sev })}
        large={isPhone}
        label="Log severity filter"
      />
    ),
    [state.sev, update, isPhone],
  );
  return (
    <DashboardPanel
      id="panel-logs"
      title="Log severity"
      headerExtra={headerExtra}
      actions={host.actionsFor(
        'panel-logs',
        series.data?.sql,
        series.data
          ? { kind: 'logs', title: 'Log severity', buckets: series.data.buckets, severities: state.sev }
          : null,
      )}
      sql={series.data?.sql}
      isLoading={series.isLoading}
      isRefreshing={series.isRefreshing}
      error={series.error}
      onRetry={series.reload}
      isEmpty={!!series.data && !hasSelectedLogs(series.data.buckets, state.sev)}
      emptyMessage="No log records of the selected severities in this window."
      skeletonHeight={timelineHeight(layout)}
    >
      {series.data && (
        <LogSeverityChart
          buckets={series.data.buckets}
          severities={state.sev}
          height={timelineHeight(layout)}
          spanMs={spanMs}
          compact={isPhone}
          zoom={ZOOM_MODES[layout]}
          onZoomBuckets={host.zoomTo(
            series.data.buckets.map((bucket) => bucket.t),
            series.data.range.bucketSeconds,
          )}
        />
      )}
    </DashboardPanel>
  );
}

/**
 * Registers the `api` and `logs` views, once. The dashboard page calls it at
 * module scope (a bare import for the side effect would be dropped by a
 * bundler that honours `sideEffects: false`).
 */
export function registerPlatformDashboardPanelViews(): void {
  if (!getDashboardPanelView('api')) registerPlatformDashboardPanelView('api', ApiPanelView as never);
  if (!getDashboardPanelView('logs')) registerPlatformDashboardPanelView('logs', LogsPanelView as never);
}
