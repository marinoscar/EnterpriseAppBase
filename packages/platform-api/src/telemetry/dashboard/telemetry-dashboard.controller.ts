import { Controller, Get, Inject, Query, Type } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';

import { ErrorDto } from '../../core/index';
import {
  DASHBOARD_BUCKET_COUNTS,
  DASHBOARD_PANELS,
  DASHBOARD_RANGES,
  DASHBOARD_TOP_KINDS,
  TelemetryDashboardEventsDto,
  TelemetryDashboardEventsQueryDto,
  TelemetryDashboardFiltersDto,
  TelemetryDashboardMetricGroupsDto,
  createTelemetryDashboardMetricsDtoSchema,
  createTelemetryDashboardMetricsQueryDtoSchema,
  TelemetryDashboardQueryDto,
  TelemetryDashboardSummaryDto,
  TelemetryDashboardTimeseriesDto,
  TelemetryDashboardTimeseriesQueryDto,
  TelemetryDashboardTopDto,
  TelemetryDashboardTopQueryDto,
  type TelemetryDashboardMetricGroups,
} from '../dto/telemetry-dashboard.dto';
import { metricGroupIds, metricGroups, type MetricGroup } from '../metrics/metric-catalog';
import { TelemetryDashboardService } from './telemetry-dashboard.service';
import type { ResolvedTelemetryModuleOptions } from '../telemetry.options';
import { TELEMETRY_PERMISSIONS } from '../telemetry.permissions';

// =============================================================================
// TelemetryDashboardController (issue #577, epic #576)
// =============================================================================
//
//   GET /api/admin/telemetry/dashboard/summary      telemetry:query
//   GET /api/admin/telemetry/dashboard/timeseries   telemetry:query
//   GET /api/admin/telemetry/dashboard/top          telemetry:query
//   GET /api/admin/telemetry/dashboard/events       telemetry:query
//   GET /api/admin/telemetry/dashboard/filters      telemetry:query
//   GET /api/admin/telemetry/dashboard/metrics      telemetry:query   (#601)
//   GET /api/admin/telemetry/dashboard/metric-groups telemetry:query  (#680)
//
// Same permission as the explorer: these read telemetry DATA. Every statement
// is a server-authored template (`telemetry-dashboard.sql.ts`); the exact SQL
// run is returned in `sql` so the UI can offer "open in explorer".
// `metric-groups` is the exception: it reads only the in-memory metric-group
// registry (no store query, no audit row), so the dashboard can render one
// section per registered group, the app's included.
// =============================================================================

const COMMON_DOC =
  'Window: `range` (`15m`, `1h`, `6h`, `24h`, `7d`; default `1h`) or `from` + `to` (ISO 8601; ' +
  '`from` < `to`, `to` at most 1 minute ahead, span at most 30 days; not both). `buckets` (30 or ' +
  '60) sets the bucket size: span / buckets rounded up to 10s, 30s, 1m, 5m, 10m, 15m, 30m, 1h, 3h ' +
  'or 6h. `service` and `instance` must be values `/filters` reports for the same window. Every ' +
  'response carries `range`, `generatedAt`, `truncated` and `sql` (the statement(s) run, primary ' +
  'first). Results are cached for 15 seconds. Each store read is audited as `telemetry:dashboard`.\n\n' +
  'Failures carry `details.reason`: `TELEMETRY_DASHBOARD_BAD_FILTER` (400, unknown service or ' +
  'instance for the window), `TELEMETRY_NOT_CONFIGURED` (503), `TELEMETRY_UNREACHABLE` (503), ' +
  '`TELEMETRY_DISABLED` (409), `TELEMETRY_QUERY_FAILED` (400) and `TELEMETRY_QUERY_TIMEOUT` (504).';

function CommonQueries(): MethodDecorator {
  return (target, key, descriptor) => {
    const decorators = [
      ApiQuery({ name: 'range', required: false, enum: DASHBOARD_RANGES, description: 'Default `1h`. Not with `from`/`to`.' }),
      ApiQuery({ name: 'from', required: false, type: String, description: 'ISO 8601 window start; requires `to`.' }),
      ApiQuery({ name: 'to', required: false, type: String, description: 'ISO 8601 window end; requires `from`.' }),
      ApiQuery({ name: 'service', required: false, type: String, description: 'Only this service (<= 200 chars).' }),
      ApiQuery({ name: 'instance', required: false, type: String, description: 'Only this instance id (<= 200 chars).' }),
      ApiQuery({ name: 'buckets', required: false, enum: DASHBOARD_BUCKET_COUNTS, description: 'Default `60`.' }),
      ApiResponse({ status: 400, description: 'Invalid parameters, or an unknown service/instance', type: ErrorDto }),
      ApiResponse({ status: 409, description: 'Telemetry is disabled', type: ErrorDto }),
      ApiResponse({ status: 503, description: 'No telemetry store, or it did not answer', type: ErrorDto }),
      ApiResponse({ status: 504, description: 'A statement timed out', type: ErrorDto }),
    ];
    for (const decorate of decorators) decorate(target, key, descriptor);
    return descriptor;
  };
}

/**
 * Creates the `TelemetryDashboardController` class for one set of module options: its routes
 * guarded by the app's access decorators (`options.host.access`), the caller
 * resolved by `options.actorId`. `TelemetryModule.forRoot()` calls it.
 *
 * @param options - the resolved module options.
 * @returns the controller class.
 *
 * @stability experimental
 */
export function createTelemetryDashboardController(options: ResolvedTelemetryModuleOptions): Type<unknown> {
  const access = options.host.access;
  const ActorId = options.actorIdParam;

  // The metric groups registered when `forRoot` runs: the six platform groups
  // and the app's `metricGroups` (#703). They are the documented `group` enum;
  // validation still reads the live registry, so a group an app registers
  // later (from its own `onModuleInit`) is served, only not documented.
  const groups = metricGroupIds() as [MetricGroup, ...MetricGroup[]];
  class TelemetryDashboardMetricsQueryDto extends createZodDto(createTelemetryDashboardMetricsQueryDtoSchema(groups)) {}
  class TelemetryDashboardMetricsDto extends createZodDto(createTelemetryDashboardMetricsDtoSchema(groups)) {}

  @ApiTags('Telemetry')
  @Controller('admin/telemetry/dashboard')
  class TelemetryDashboardController {
    constructor(@Inject(TelemetryDashboardService) private readonly dashboard: TelemetryDashboardService) {}

    @Get('summary')
    @(access.requirePermissions([TELEMETRY_PERMISSIONS.QUERY]))
    @ApiOperation({
      summary: 'Telemetry health verdict and headline tiles (Admin only)',
      description:
        'The verdict (`healthy`, `degraded`, `critical`, `no_data`) with one reason per fired rule, ' +
        'and tiles for requests/min, 5xx rate, p95 latency, error and warning logs and the latest ' +
        'data timestamp — each with the previous window of equal length and a per-bucket sparkline. ' +
        '`runtime` (heap used, event-loop delay p99) appears when those metrics are collected; it is ' +
        'not filtered by instance. Routes are request paths with id-like segments normalized to `:id`. ' +
        '`unknownRoutes` (tile and block) counts requests to API routes that do not exist — 404s from ' +
        'the not-found handler, split by whether a bearer was sent; any with a bearer degrades the ' +
        'verdict. It is absent (tile value null) until the store has recorded one.\n\n' +
        COMMON_DOC,
    })
    @CommonQueries()
    @ApiResponse({ status: 200, description: 'The summary', type: TelemetryDashboardSummaryDto })
    async summary(@Query() query: TelemetryDashboardQueryDto, @ActorId() userId: string) {
      return this.dashboard.summary(userId, query);
    }

    @Get('timeseries')
    @(access.requirePermissions([TELEMETRY_PERMISSIONS.QUERY]))
    @ApiOperation({
      summary: 'Telemetry time series for one dashboard panel (Admin only)',
      description:
        '`panel=api`: server requests per bucket by status class (2xx–5xx) and p95 latency (ms). ' +
        '`panel=logs`: log records per bucket by severity (error >= 17, warn 13–16, info 9–12, ' +
        'other). Empty buckets are zero-filled.\n\n' +
        COMMON_DOC,
    })
    @ApiQuery({ name: 'panel', required: true, enum: DASHBOARD_PANELS })
    @CommonQueries()
    @ApiResponse({ status: 200, description: 'The series', type: TelemetryDashboardTimeseriesDto })
    async timeseries(@Query() query: TelemetryDashboardTimeseriesQueryDto, @ActorId() userId: string) {
      return this.dashboard.timeseries(userId, query);
    }

    @Get('top')
    @(access.requirePermissions([TELEMETRY_PERMISSIONS.QUERY]))
    @ApiOperation({
      summary: 'Top routes or top error messages (Admin only)',
      description:
        '`kind=routes`: the ten request paths (normalized) with the most 5xx responses, then the most ' +
        '4xx except 401 (`clientErrors`), then the highest p95; `unknown` marks a method + path no API ' +
        'route matches. `kind=errors`: the ten most frequent error log messages (first 200 ' +
        'characters) with first/last seen, a sample trace id and the service.\n\n' +
        COMMON_DOC,
    })
    @ApiQuery({ name: 'kind', required: true, enum: DASHBOARD_TOP_KINDS })
    @CommonQueries()
    @ApiResponse({ status: 200, description: 'The top list', type: TelemetryDashboardTopDto })
    async top(@Query() query: TelemetryDashboardTopQueryDto, @ActorId() userId: string) {
      return this.dashboard.top(userId, query);
    }

    @Get('events')
    @(access.requirePermissions([TELEMETRY_PERMISSIONS.QUERY]))
    @ApiOperation({
      summary: 'Recent log events, newest first (Admin only)',
      description:
        'At most 50 log records per page, newest first, filtered by `severity` (default ' +
        '`error,warn`) and an optional case-insensitive body substring `q` (at most 200 characters; ' +
        '`%` and `_` match literally). Pass `nextCursor` back as `cursor` for the next page; it is ' +
        'null on the last page. A malformed cursor is refused with **400** (`details.reason: ' +
        '"TELEMETRY_DASHBOARD_BAD_CURSOR"`).\n\n' +
        COMMON_DOC,
    })
    @ApiQuery({ name: 'severity', required: false, type: String, description: 'Comma-separated: error, warn, info.' })
    @ApiQuery({ name: 'q', required: false, type: String, description: 'Body substring, <= 200 characters.' })
    @ApiQuery({ name: 'cursor', required: false, type: String, description: '`nextCursor` of the previous page.' })
    @CommonQueries()
    @ApiResponse({ status: 200, description: 'A page of events', type: TelemetryDashboardEventsDto })
    async events(@Query() query: TelemetryDashboardEventsQueryDto, @ActorId() userId: string) {
      return this.dashboard.events(userId, query);
    }

    @Get('filters')
    @(access.requirePermissions([TELEMETRY_PERMISSIONS.QUERY]))
    @ApiOperation({
      summary: 'Services and instances seen in a window (Admin only)',
      description:
        'The distinct service names and instance ids (at most 200 each) in traces and logs over the ' +
        'window — the values `service` and `instance` accept — and the host names (`hosts`, at most ' +
        '200) the host metrics report, the values `/metrics` `host` accepts. Cached for 60 seconds.\n\n' +
        COMMON_DOC,
    })
    @CommonQueries()
    @ApiResponse({ status: 200, description: 'The filter values', type: TelemetryDashboardFiltersDto })
    async filters(@Query() query: TelemetryDashboardQueryDto, @ActorId() userId: string) {
      return this.dashboard.filters(userId, query);
    }

    @Get('metrics')
    @(access.requirePermissions([TELEMETRY_PERMISSIONS.QUERY]))
    @ApiOperation({
      summary: 'One metric group of the dashboard catalog (Admin only)',
      description:
        'Tiles, series and per-key tables for one `group` of the metric catalog: `host` (CPU, memory, ' +
        'load, filesystems, disk and network IO), `database` (connections against the maximum, size, ' +
        'commits, rollbacks, deadlocks, cache hit ratio, largest tables), `queue` (queue depth, oldest ' +
        'pending job, settle rate, failure ratio, duration p95, last backup), `nodes` (fleet health, ' +
        'per-node vitals, job types without an eligible node), `uptime` (status, duration and TLS ' +
        'expiry per URL, nginx traffic) or `pipeline` (collector points sent/failed, exporter queue, ' +
        'refused points, GreptimeDB write stalls, scrape targets). Counters are reset-aware increases ' +
        'over the window; tiles compare with the previous window of equal length. Buckets are at least ' +
        'one minute. A family whose table or column is absent is listed in `skipped`, never an error; ' +
        '`available` is false when nothing of the group exists yet. `host` must be a value `/filters` ' +
        'reports in `hosts`; it applies to collector-scraped metrics only, while `service` and ' +
        '`instance` apply to the API\'s own metrics (`queue`, `nodes`). `sql` lists every statement run.\n\n' +
        COMMON_DOC.replace('`service` and `instance` must', '`service`, `instance` and `host` must'),
    })
    @ApiQuery({ name: 'group', required: true, enum: groups })
    @ApiQuery({ name: 'host', required: false, type: String, description: 'Only this host (<= 200 chars).' })
    @CommonQueries()
    @ApiResponse({ status: 200, description: 'The metric group', type: TelemetryDashboardMetricsDto })
    async metrics(@Query() query: TelemetryDashboardMetricsQueryDto, @ActorId() userId: string) {
      return this.dashboard.metrics(userId, query);
    }

    @Get('metric-groups')
    @(access.requirePermissions([TELEMETRY_PERMISSIONS.QUERY]))
    @ApiOperation({
      summary: 'The metric groups the dashboard renders (Admin only)',
      description:
        'Every registered metric group (the six platform groups and any the application registers), in ' +
        'dashboard order: `id` (the `/metrics` `group` value), `label`, the dashboard section `title` and ' +
        '`order`. Read from the in-memory metric-group registry: no telemetry store query, so it answers ' +
        'even while the store is unconfigured or unreachable, and it is not audited.',
    })
    @ApiResponse({ status: 200, description: 'The metric groups', type: TelemetryDashboardMetricGroupsDto })
    metricGroups(): TelemetryDashboardMetricGroups {
      return {
        data: metricGroups().map(({ id, label, title, order }) => ({ id, label, title, order })),
      };
    }
  }

  return TelemetryDashboardController;
}
