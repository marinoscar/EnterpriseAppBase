/**
 * The Telemetry Dashboard's infrastructure sections — issue #602, epic #576.
 *
 * One first-class section per `/metrics` group (#601), as `/metric-groups`
 * lists them (#680): the platform's six — Infrastructure (host), Database, Job
 * queue, Worker nodes, Uptime & dependencies and Telemetry pipeline — and any
 * group the application registers. The section TITLE is the API's. Each is its
 * own `DashboardPanel` over its own request (`useDashboardMetrics`), so it
 * loads, fails and retries alone, and carries the same header actions as every
 * other panel ("Ask assistant", "Open in Explorer" with the group's FIRST
 * statement — loaded, never run).
 *
 * What a section shows is the group's PRESENTATION (PP-14.18), data the API
 * serves with `/metric-groups` and `headless/lib/metrics/presentation.ts`
 * resolves into a plan: which tiles (with their label, unit and colour), which
 * series go in one chart, which tables with which columns, row order and Top N,
 * and which computed columns. The six platform groups declare theirs in their own
 * group files (the contract's `PLATFORM_METRIC_PRESENTATIONS`, used here when an
 * API does not serve one); a part a group's presentation leaves out takes the
 * default: every tile, one chart per series key, every table, in the API's
 * order. Anything the response lacks — a table not collected in this store, a
 * skipped family — is simply left out; a group the store has nothing of
 * (`available: false`) hides the whole section, and the page says so in one line.
 *
 * The API decides every value, threshold and row; this only presents them.
 */
import type { ReactNode } from 'react';
import { Grid, Stack, Typography, useTheme } from '@mui/material';
import type { MetricGroupPresentation, PresentationColumn } from '@marinoscar/platform-contract/telemetry';
import type { DashboardResource } from '../../../../headless/hooks/useTelemetryDashboard.js';
import type {
  DashboardMetricGroup,
  DashboardMetricSeries,
  DashboardMetricTable,
  DashboardMetrics,
  DashboardTile,
} from '../../../../headless/services/telemetryDashboard.js';
import type { AssistantPanelContext } from '../../../../headless/lib/dashboard/assistantPrompt.js';
import { DashboardPanel, type PanelAction } from '../DashboardPanel.js';
import type { DashboardLayout } from '../DashboardFilterBar.js';
import { KpiTiles } from '../KpiTiles.js';
import { MetricSeriesChart } from './MetricSeriesChart.js';
import {
  MetricTable,
  StatusCell,
  UtilizationBar,
  type MetricTableColumnSpec,
  type MetricTableProps,
} from './MetricTable.js';
import { metricPanelId, metricSectionAnchor, type MetricSectionMeta } from '../../../../headless/lib/metrics/metricSections.js';
import {
  colorOfToken,
  planTiles,
  presentationFor,
  sectionPlan,
  withVirtualColumns,
  type ChartPlan,
  type SectionPlan,
  type TablePlan,
} from '../../../../headless/lib/metrics/presentation.js';
import { telemetryTokens } from '../../../../theme/telemetryTokens.js';

type Row = DashboardMetricTable['rows'][number];

/** Failing rows first (`up === false`, `noEligibleNode === true`); stable otherwise. */
const problemsFirst = (a: Row, b: Row) =>
  Number(b.up === false || b.noEligibleNode === true) - Number(a.up === false || a.noEligibleNode === true);

/**
 * A presentation column as the table component's column spec: a bar, a
 * status or a fraction replaces the unit-formatted cell, and a column the
 * response lacks is skipped (`requires`).
 */
function columnSpec(column: PresentationColumn): MetricTableColumnSpec {
  const display = column.display;
  if (!display) return { key: column.key, ...(column.label !== undefined ? { label: column.label } : {}) };
  const label = column.label !== undefined ? { label: column.label } : {};
  switch (display.kind) {
    case 'utilization-bar':
      return {
        key: column.key,
        ...label,
        requires: [column.key],
        render: (row, responseColumn) => (
          <UtilizationBar
            value={row[column.key] ?? null}
            label={`${responseColumn?.label ?? column.label ?? column.key} on ${String(row.key)}`}
            {...(display.warnAt !== undefined ? { warnAt: display.warnAt } : {})}
            {...(display.criticalAt !== undefined ? { criticalAt: display.criticalAt } : {})}
          />
        ),
      };
    case 'status':
      return {
        key: column.key,
        ...label,
        requires: [column.key],
        render: (row) => {
          const value = row[column.key];
          return (
            <StatusCell
              ok={display.invert ? (typeof value === 'boolean' ? !value : null) : (value ?? null)}
              okText={display.okText}
              badText={display.badText}
            />
          );
        },
      };
    case 'fraction': {
      const [used, total] = display.of;
      return {
        key: column.key,
        ...label,
        requires: [used, total],
        render: (row) =>
          row[used] === null && row[total] === null
            ? '—'
            : `${typeof row[used] === 'number' ? row[used] : '—'} / ${typeof row[total] === 'number' ? row[total] : '—'}`,
      };
    }
  }
}

/** What the table component needs for a table plan. */
function tableProps(plan: TablePlan): Pick<MetricTableProps, 'columns' | 'sortRows' | 'topN'> {
  return {
    columns: plan.columns?.map(columnSpec),
    sortRows: plan.sort === 'problems-first' ? problemsFirst : undefined,
    topN: plan.topN,
  };
}

/** The tables of the plan that the response carries, virtual columns applied, in the plan's order. */
function planTables(
  data: DashboardMetrics,
  plan: SectionPlan,
  spanMs: number,
): Array<{ table: DashboardMetricTable; tablePlan: TablePlan }> {
  return plan.tables.flatMap((tablePlan) =>
    data.tables
      .filter((table) => table.key === tablePlan.key)
      .map((table) => {
        const withColumns = withVirtualColumns(table, plan.virtualColumns, spanMs);
        return {
          table: tablePlan.label !== undefined ? { ...withColumns, label: tablePlan.label } : withColumns,
          tablePlan,
        };
      }),
  );
}

/**
 * The section's tiles, in the presentation's order, that the response carries.
 *
 * @param group - the group id.
 * @param data - the group's `/metrics` response.
 * @param presentation - the group's served presentation; a platform group falls back to its own.
 * @returns the tiles to draw.
 */
export function sectionTiles(
  group: DashboardMetricGroup,
  data: DashboardMetrics,
  presentation?: MetricGroupPresentation | null,
): DashboardTile[] {
  return planTiles(data, sectionPlan(data, presentationFor(group, presentation)));
}

/** The section's tables, in the presentation's order, that the response carries. */
export function sectionTables(
  group: DashboardMetricGroup,
  data: DashboardMetrics,
  presentation?: MetricGroupPresentation | null,
): DashboardMetricTable[] {
  return planTables(data, sectionPlan(data, presentationFor(group, presentation)), 0).map(({ table }) => table);
}

function chartSeries(chart: ChartPlan, data: DashboardMetrics): DashboardMetricSeries[] {
  return chart.keys.flatMap((key) => data.series.filter((series) => series.key === key));
}

/** What "Ask assistant" describes for a section; `title` is the section title the API gives it. */
export function metricsAssistantContext(
  group: DashboardMetricGroup,
  data: DashboardMetrics,
  title: string,
  presentation?: MetricGroupPresentation | null,
): AssistantPanelContext {
  return {
    kind: 'metrics',
    title,
    group,
    tiles: sectionTiles(group, data, presentation),
    tables: sectionTables(group, data, presentation),
    skipped: data.skipped,
  };
}

function SectionBody({
  group,
  data,
  layout,
  spanMs,
  now,
  presentation,
}: {
  group: DashboardMetricGroup;
  data: DashboardMetrics;
  layout: DashboardLayout;
  spanMs: number;
  now?: number;
  presentation?: MetricGroupPresentation | null;
}) {
  const theme = useTheme();
  const plan = sectionPlan(data, presentationFor(group, presentation));
  const tiles = planTiles(data, plan);
  const tokens = telemetryTokens(theme);
  // A tile asks for a theme colour by token; the web resolves it (it never receives a CSS colour).
  const tileColors = Object.fromEntries(
    plan.tiles.flatMap((spec) => (spec.color ? [[spec.metric, colorOfToken(spec.color, tokens)] as const] : [])),
  );
  const charts = plan.charts
    .map((chart) => ({ chart, series: chartSeries(chart, data) }))
    .filter(({ series }) => series.length > 0);
  const tables = planTables(data, plan, spanMs);
  const both = charts.length > 0 && tables.length > 0;
  const compact = layout === 'phone';

  const notes: ReactNode[] = [];
  if (data.skipped.length > 0) {
    notes.push(
      <span key="skipped" title={data.skipped.join(', ')}>
        {data.skipped.length === 1
          ? '1 metric of this section is not collected in this store.'
          : `${data.skipped.length} metrics of this section are not collected in this store.`}
      </span>,
    );
  }
  if (data.truncated) notes.push(<span key="truncated">Some lists were cut short.</span>);

  return (
    <Stack spacing={{ xs: 1.5, sm: 2 }} sx={{ minWidth: 0 }}>
      {tiles.length > 0 && (
        <KpiTiles
          tiles={tiles}
          now={now}
          testId={`metric-tiles-${group}`}
          {...(Object.keys(tileColors).length > 0 ? { colors: tileColors } : {})}
        />
      )}
      {(charts.length > 0 || tables.length > 0) && (
        <Grid container spacing={{ xs: 1.5, sm: 2 }}>
          {charts.map(({ chart, series }) => (
            <Grid key={chart.title} size={{ xs: 12, lg: both ? 5 : 12 }} sx={{ minWidth: 0 }}>
              <MetricSeriesChart
                title={chart.title}
                series={series}
                height={compact ? 200 : 240}
                spanMs={spanMs}
                compact={compact}
                testId={`metric-chart-${group}`}
                colorFor={(s) => (s.groupBy && chart.colors?.[s.groupBy] ? colorOfToken(chart.colors[s.groupBy]!, tokens) : undefined)}
              />
            </Grid>
          ))}
          {tables.map(({ table, tablePlan }) => (
            <Grid key={table.key} size={{ xs: 12, lg: both ? 7 : 12 }} sx={{ minWidth: 0 }}>
              <MetricTable table={table} {...tableProps(tablePlan)} now={now} />
            </Grid>
          ))}
        </Grid>
      )}
      {notes.length > 0 && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {notes}
        </Typography>
      )}
    </Stack>
  );
}

/**
 * A freshness window as words: `150000` → "2 min 30 s", `300000` → "5 min",
 * `45000` → "45 s".
 */
export function formatFreshWindow(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} s`;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

/**
 * The section header's freshness note, or `undefined`: shown when the API
 * reports its window (`freshMs`) and the section has a table, the only place
 * the window applies.
 */
function freshWindowNote(
  group: DashboardMetricGroup,
  data: DashboardMetrics | null | undefined,
  presentation?: MetricGroupPresentation | null,
): ReactNode {
  if (!data || data.freshMs === undefined || sectionTables(group, data, presentation).length === 0) return undefined;
  const window = formatFreshWindow(data.freshMs);
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      data-testid={`metric-fresh-window-${group}`}
      title={`A table reading more than ${window} older than its table's newest reading is not shown as current.`}
      sx={{ whiteSpace: 'nowrap' }}
    >
      Current within {window}
    </Typography>
  );
}

/** Whether a section has anything to draw for the response. */
export function sectionHasContent(
  group: DashboardMetricGroup,
  data: DashboardMetrics,
  presentation?: MetricGroupPresentation | null,
): boolean {
  const plan = sectionPlan(data, presentationFor(group, presentation));
  return (
    planTiles(data, plan).length > 0 ||
    plan.charts.some((chart) => chartSeries(chart, data).length > 0) ||
    planTables(data, plan, 0).length > 0
  );
}

export interface MetricSectionProps {
  group: DashboardMetricGroup;
  /** The section title, from `/metric-groups` (#680). */
  title: string;
  resource: DashboardResource<DashboardMetrics>;
  actions: PanelAction[];
  layout: DashboardLayout;
  spanMs: number;
  /** For relative times; the page's clock. */
  now?: number;
  /** The group's `presentation` from `/metric-groups`; a platform group falls back to its own, any other to the defaults. */
  presentation?: MetricGroupPresentation | null;
}

/**
 * One infrastructure section. Hidden entirely once the API says the group is
 * not `available`; until the first answer it shows the panel's skeleton, and a
 * failure is this section's own (Retry refetches it alone).
 */
export function MetricSection({ group, title, resource, actions, layout, spanMs, now, presentation }: MetricSectionProps) {
  const { data } = resource;
  if (data && !data.available) return null;
  return (
    <DashboardPanel
      id={metricPanelId(group)}
      anchorId={metricSectionAnchor(group)}
      title={title}
      headerExtra={freshWindowNote(group, data, presentation)}
      actions={actions}
      sql={data?.sql}
      isLoading={resource.isLoading}
      isRefreshing={resource.isRefreshing}
      error={resource.error}
      onRetry={resource.reload}
      isEmpty={!!data && !sectionHasContent(group, data, presentation)}
      emptyMessage="Nothing collected for this section in this window."
      skeletonHeight={200}
    >
      {data && <SectionBody group={group} data={data} layout={layout} spanMs={spanMs} now={now} presentation={presentation} />}
    </DashboardPanel>
  );
}

/**
 * The one-line hint for the groups the store has nothing of (#602): their
 * sections are hidden, so say which, rather than leave the reader wondering.
 */
export function MetricsNotCollected({ groups }: { groups: readonly Pick<MetricSectionMeta, 'title'>[] }) {
  if (groups.length === 0) return null;
  return (
    <Typography variant="caption" color="text.secondary" component="p" data-testid="metrics-not-collected" sx={{ m: 0 }}>
      Not collected in this telemetry store: {groups.map((group) => group.title).join(', ')}.
    </Typography>
  );
}
