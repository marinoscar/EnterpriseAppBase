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
 * What a platform section shows is declared below ({@link SECTION_SPECS}):
 * which tiles, which series go in one chart, which tables with which columns.
 * A group without a spec (an application's own) shows every tile, one chart
 * per series key and every table, in the API's order. Anything the
 * response lacks — a table not collected in this store, a skipped family — is
 * simply left out; a group the store has nothing of (`available: false`) hides
 * the whole section, and the page says so in one line.
 *
 * The API decides every value, threshold and row; this only presents them.
 */
import type { ReactNode } from 'react';
import { Grid, Stack, Typography, useTheme } from '@mui/material';
import type { DashboardResource } from '../../../../hooks/useTelemetryDashboard';
import type {
  DashboardMetricGroup,
  DashboardMetricSeries,
  DashboardMetricTable,
  DashboardMetrics,
  DashboardTile,
} from '../../../../services/telemetryDashboard';
import type { AssistantPanelContext } from '../assistantPrompt';
import { DashboardPanel, type PanelAction } from '../DashboardPanel';
import type { DashboardLayout } from '../DashboardFilterBar';
import { KpiTiles } from '../KpiTiles';
import { MetricSeriesChart } from './MetricSeriesChart';
import {
  MetricTable,
  StatusCell,
  UtilizationBar,
  type MetricTableColumnSpec,
  type MetricTableTopN,
} from './MetricTable';
import { metricPanelId, metricSectionAnchor, type MetricSectionMeta } from './metricSections';
import { telemetryTokens, type TelemetryTokens } from '../../../../theme/telemetryTokens';

type Row = DashboardMetricTable['rows'][number];

interface ChartSpec {
  title: string;
  /** Series keys, in legend order; every series of a key (one per `groupBy`) is drawn. */
  keys: string[];
  /** Fixed colours per `groupBy` value (the settle outcomes), from the telemetry status tokens. */
  colors?: Record<string, (tokens: TelemetryTokens) => string>;
}

interface TableSpec {
  key: string;
  columns?: MetricTableColumnSpec[];
  sortRows?: (a: Row, b: Row) => number;
  /** Offer a "Top N" row limit (applied after `sortRows`). */
  topN?: MetricTableTopN;
}

interface SectionSpec {
  tiles: string[];
  charts: ChartSpec[];
  tables: TableSpec[];
}

/** Failing rows first (`up === false`, `noEligibleNode === true`); stable otherwise. */
const problemsFirst = (a: Row, b: Row) =>
  Number(b.up === false || b.noEligibleNode === true) - Number(a.up === false || a.noEligibleNode === true);

const upStatus: MetricTableColumnSpec = {
  key: 'up',
  requires: ['up'],
  render: (row) => <StatusCell ok={row.up} okText="Up" badText="Down" />,
};

/** The platform groups' presentation. A group not listed here gets {@link sectionSpec}'s default. */
export const SECTION_SPECS: Readonly<Record<string, SectionSpec>> = {
  host: {
    tiles: ['cpuUtilization', 'memoryUtilization', 'load1m', 'filesystemUtilization'],
    charts: [{ title: 'CPU and memory utilization', keys: ['cpuUtilization', 'memoryUtilization'] }],
    tables: [
      {
        key: 'filesystems',
        columns: [
          { key: 'key' },
          {
            key: 'utilizationPct',
            requires: ['utilizationPct'],
            render: (row, column) => (
              <UtilizationBar value={row.utilizationPct} label={`${column?.label ?? 'Used'} on ${String(row.key)}`} />
            ),
          },
          { key: 'usedBytes' },
          { key: 'freeBytes' },
          { key: 'lastSeenAt' },
        ],
      },
    ],
  },
  database: {
    tiles: ['dbConnectionUtilization', 'dbSize', 'dbCommits', 'dbCacheHitRatio'],
    charts: [{ title: 'Connections and the connection limit', keys: ['dbConnections', 'dbConnectionMax'] }],
    tables: [{ key: 'largestTables', topN: { options: [10, 20, 50, 'all'], default: 10 } }],
  },
  queue: {
    tiles: ['queueDepth.pending', 'oldestPendingAge', 'jobFailureRatio', 'jobDurationP95', 'backupAge'],
    charts: [
      {
        title: 'Jobs settled per minute by outcome',
        keys: ['jobsSettled'],
        colors: {
          succeeded: (tokens) => tokens.status.ok,
          failed: (tokens) => tokens.status.crit,
        },
      },
    ],
    tables: [{ key: 'jobTypes' }],
  },
  nodes: {
    tiles: ['nodesByHealth.healthy', 'nodesByHealth.stale', 'nodesByHealth.offline', 'noEligibleNode'],
    charts: [],
    tables: [
      {
        key: 'nodes',
        columns: [
          { key: 'key' },
          { key: 'cpuCores' },
          { key: 'rssBytes' },
          {
            key: 'heapPct',
            requires: ['heapPct'],
            render: (row, column) => (
              <UtilizationBar value={row.heapPct} label={`${column?.label ?? 'Heap used'} on ${String(row.key)}`} />
            ),
          },
          { key: 'stateDirFreePct' },
          {
            key: 'slots',
            label: 'Slots used',
            requires: ['slotsUsed', 'slotsTotal'],
            render: (row) =>
              row.slotsUsed === null && row.slotsTotal === null
                ? '—'
                : `${typeof row.slotsUsed === 'number' ? row.slotsUsed : '—'} / ${typeof row.slotsTotal === 'number' ? row.slotsTotal : '—'}`,
          },
          { key: 'lastSeenAt' },
        ],
      },
      {
        key: 'noEligibleNodeTypes',
        sortRows: problemsFirst,
        columns: [
          { key: 'key' },
          {
            key: 'noEligibleNode',
            label: 'Eligible node',
            requires: ['noEligibleNode'],
            render: (row) => (
              <StatusCell
                ok={typeof row.noEligibleNode === 'boolean' ? !row.noEligibleNode : null}
                okText="Available"
                badText="None eligible"
              />
            ),
          },
          { key: 'lastSeenAt' },
        ],
      },
    ],
  },
  uptime: {
    tiles: ['nginxConnections.active', 'nginxRequests', 'tlsDaysLeft', 'httpDuration'],
    charts: [{ title: 'nginx connections by state', keys: ['nginxConnections'] }],
    tables: [
      {
        key: 'uptimeTargets',
        sortRows: problemsFirst,
        columns: [
          { key: 'key' },
          upStatus,
          { key: 'statusCode' },
          { key: 'durationMs' },
          { key: 'tlsDaysLeft' },
          { key: 'failedChecks' },
          { key: 'checks' },
          { key: 'lastError' },
          { key: 'lastSeenAt' },
        ],
      },
    ],
  },
  pipeline: {
    tiles: ['exporterFailed', 'exporterQueueUtilization', 'receiverRefused', 'scrapeTargetsDown'],
    charts: [],
    tables: [{ key: 'scrapeTargets', sortRows: problemsFirst, columns: [{ key: 'key' }, upStatus, { key: 'lastSeenAt' }] }],
  },
};

/** The series label without its `groupBy` suffix (`Disk IO: read` → `Disk IO`). */
function familyLabel(series: DashboardMetricSeries): string {
  const suffix = series.groupBy === null ? '' : `: ${series.groupBy}`;
  return suffix && series.label.endsWith(suffix) ? series.label.slice(0, -suffix.length) : series.label;
}

/**
 * What a section shows: the platform group's {@link SECTION_SPECS} entry, or,
 * for a group without one (an application's own, #680), every tile, one chart
 * per series key and every table, in the response's order.
 */
export function sectionSpec(group: DashboardMetricGroup, data: DashboardMetrics): SectionSpec {
  const declared = Object.prototype.hasOwnProperty.call(SECTION_SPECS, group) ? SECTION_SPECS[group] : undefined;
  if (declared) return declared;
  const seriesKeys = [...new Set(data.series.map((series) => series.key))];
  return {
    tiles: data.tiles.map((tile) => tile.key),
    charts: seriesKeys.map((key) => ({
      title: familyLabel(data.series.find((series) => series.key === key) as DashboardMetricSeries),
      keys: [key],
    })),
    tables: data.tables.map((table) => ({ key: table.key })),
  };
}

/** The section's tiles, in the spec's order, that the response carries. */
export function sectionTiles(group: DashboardMetricGroup, data: DashboardMetrics): DashboardTile[] {
  const byKey = new Map(data.tiles.map((tile) => [tile.key, tile]));
  return sectionSpec(group, data).tiles.flatMap((key) => {
    const tile = byKey.get(key);
    return tile ? [tile] : [];
  });
}

/** The section's tables, in the spec's order, that the response carries. */
export function sectionTables(group: DashboardMetricGroup, data: DashboardMetrics): DashboardMetricTable[] {
  return sectionSpec(group, data).tables.flatMap((spec) => data.tables.filter((table) => table.key === spec.key));
}

function chartSeries(chart: ChartSpec, data: DashboardMetrics): DashboardMetricSeries[] {
  return chart.keys.flatMap((key) => data.series.filter((series) => series.key === key));
}

/** What "Ask assistant" describes for a section; `title` is the section title the API gives it. */
export function metricsAssistantContext(
  group: DashboardMetricGroup,
  data: DashboardMetrics,
  title: string,
): AssistantPanelContext {
  return {
    kind: 'metrics',
    title,
    group,
    tiles: sectionTiles(group, data),
    tables: sectionTables(group, data),
    skipped: data.skipped,
  };
}

function SectionBody({
  group,
  data,
  layout,
  spanMs,
  now,
}: {
  group: DashboardMetricGroup;
  data: DashboardMetrics;
  layout: DashboardLayout;
  spanMs: number;
  now?: number;
}) {
  const theme = useTheme();
  const spec = sectionSpec(group, data);
  const tiles = sectionTiles(group, data);
  const charts = spec.charts
    .map((chart) => ({ chart, series: chartSeries(chart, data) }))
    .filter(({ series }) => series.length > 0);
  const tables = spec.tables.flatMap((tableSpec) =>
    data.tables.filter((table) => table.key === tableSpec.key).map((table) => ({ table, tableSpec })),
  );
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
      {tiles.length > 0 && <KpiTiles tiles={tiles} now={now} testId={`metric-tiles-${group}`} />}
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
                colorFor={(s) => (s.groupBy && chart.colors?.[s.groupBy] ? chart.colors[s.groupBy](telemetryTokens(theme)) : undefined)}
              />
            </Grid>
          ))}
          {tables.map(({ table, tableSpec }) => (
            <Grid key={table.key} size={{ xs: 12, lg: both ? 7 : 12 }} sx={{ minWidth: 0 }}>
              <MetricTable
                table={table}
                columns={tableSpec.columns}
                sortRows={tableSpec.sortRows}
                topN={tableSpec.topN}
                now={now}
              />
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

/** Whether a section has anything to draw for the response. */
export function sectionHasContent(group: DashboardMetricGroup, data: DashboardMetrics): boolean {
  const spec = sectionSpec(group, data);
  return (
    sectionTiles(group, data).length > 0 ||
    spec.charts.some((chart) => chartSeries(chart, data).length > 0) ||
    sectionTables(group, data).length > 0
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
}

/**
 * One infrastructure section. Hidden entirely once the API says the group is
 * not `available`; until the first answer it shows the panel's skeleton, and a
 * failure is this section's own (Retry refetches it alone).
 */
export function MetricSection({ group, title, resource, actions, layout, spanMs, now }: MetricSectionProps) {
  const { data } = resource;
  if (data && !data.available) return null;
  return (
    <DashboardPanel
      id={metricPanelId(group)}
      anchorId={metricSectionAnchor(group)}
      title={title}
      actions={actions}
      sql={data?.sql}
      isLoading={resource.isLoading}
      isRefreshing={resource.isRefreshing}
      error={resource.error}
      onRetry={resource.reload}
      isEmpty={!!data && !sectionHasContent(group, data)}
      emptyMessage="Nothing collected for this section in this window."
      skeletonHeight={200}
    >
      {data && <SectionBody group={group} data={data} layout={layout} spanMs={spanMs} now={now} />}
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
