// =============================================================================
// The `telemetry` support-bundle section (issue #772, PP-13.1)
// =============================================================================
//
// Telemetry HEALTH, never telemetry DATA. Registered by the telemetry module
// with `SupportBundleRegistry` (`@marinoscar/platform-api/doctor`); it stays
// in the app until the telemetry slice is packaged.
//
// AGGREGATES ONLY (the owner's rule: no personal data beyond counts). Raw
// logs, spans, traces and explorer query results carry log bodies, routes
// with ids and user agents, so none of them is read here. What is:
//   - `TelemetryStatusService.getStatus()`: reachability, the store version,
//     the TTL, retention, and each table's name (platform-defined) and row
//     count; NOT the database name;
//   - `TelemetryStackService.getStatus()`: the agent state and each
//     container's state and health; NOT `agentError` (it names the agent's
//     origin) or the last deploy's output;
//   - `TelemetryDashboardService.summary(actor, { range: '24h' })`: the
//     verdict level and reasons, and the fixed and runtime tiles' key, label,
//     value, previous value and unit. NOT `sql`, `sparkline` or
//     `unknownRoutes` (its `topRoutes` are request paths);
//   - the registered metric group ids.
//
// GATED on `telemetry:query` on top of the bundle route's own permission: a
// caller without it gets `omitted`. When no store is configured, or
// telemetry is switched off, the section is `omitted` as well.
//
// The summary read is audited by the dashboard service as
// `telemetry:dashboard`, exactly as when an administrator opens the
// dashboard, and served from its 15-second result cache. That audit row is
// the dashboard's existing behaviour, not a new write.
// =============================================================================

import { Injectable, OnModuleInit } from '@nestjs/common';
import { SupportBundleRegistry, omitSupportBundleSection } from '../doctor/index';
import type {
  SupportBundleOmission,
  SupportBundleSection,
  SupportBundleSectionContext,
} from '../doctor/index';
import { z } from 'zod';

import { TELEMETRY_PERMISSIONS } from './telemetry.permissions';
import { TelemetryDashboardService } from './dashboard/telemetry-dashboard.service';
import { VERDICT_LEVELS } from './dashboard/telemetry-dashboard.verdict';
import { GreptimeClient } from './greptime/greptime.client';
import { metricGroupIds } from './metrics/metric-catalog';
import { STACK_SERVICE_HEALTH, STACK_SERVICE_STATES } from './stack/stack-agent.client';
import { TELEMETRY_STACK_AGENT_STATES } from './stack/dto/telemetry-stack.dto';
import { TelemetryStackService } from './stack/telemetry-stack.service';
import { TelemetrySettingsService } from './telemetry-settings.service';
import { TelemetryStatusService } from './telemetry-status.service';

/** The window of the summary the bundle carries. */
export const TELEMETRY_SUPPORT_BUNDLE_RANGE = '24h' as const;

const tileSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    value: z.union([z.number(), z.string()]).nullable(),
    previous: z.union([z.number(), z.string()]).nullable(),
    unit: z.string(),
  })
  .strict();

export const telemetrySectionSchema = z
  .object({
    status: z
      .object({
        configured: z.boolean(),
        reachable: z.boolean(),
        version: z.string().nullable(),
        ttlDays: z.number().int().nullable(),
        retentionDays: z.number().int(),
        tableCount: z.number().int(),
        tables: z.array(z.object({ name: z.string(), rows: z.number().nullable() }).strict()),
        error: z.string().nullable(),
      })
      .strict(),
    stack: z
      .object({
        agent: z.enum(TELEMETRY_STACK_AGENT_STATES),
        services: z
          .array(
            z
              .object({ name: z.string(), state: z.enum(STACK_SERVICE_STATES), health: z.enum(STACK_SERVICE_HEALTH).nullable() })
              .strict(),
          )
          .describe('One entry per telemetry container.'),
      })
      .strict(),
    summary: z
      .object({
        range: z.literal(TELEMETRY_SUPPORT_BUNDLE_RANGE),
        verdict: z.object({ level: z.enum(VERDICT_LEVELS), reasons: z.array(z.string()) }).strict(),
        tiles: z.array(tileSchema),
        runtime: z.array(tileSchema),
      })
      .strict()
      .nullable(),
    summaryError: z.string().nullable(),
    metricGroups: z.array(z.string()),
  })
  .strict();

export type TelemetrySectionData = z.infer<typeof telemetrySectionSchema>;

type Tile = { key: string; label: string; value: number | string | null; previous: number | string | null; unit: string };

function pickTile(tile: Tile): Tile {
  return { key: tile.key, label: tile.label, value: tile.value, previous: tile.previous, unit: tile.unit };
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (message.split(/\r?\n/)[0] ?? '').slice(0, 300);
}

@Injectable()
export class TelemetrySupportBundleSection implements SupportBundleSection<TelemetrySectionData>, OnModuleInit {
  readonly id = 'telemetry';
  readonly label = 'Telemetry health';
  readonly permission = TELEMETRY_PERMISSIONS.QUERY;
  readonly schema = telemetrySectionSchema;

  constructor(
    private readonly registry: SupportBundleRegistry,
    private readonly greptime: GreptimeClient,
    private readonly settings: TelemetrySettingsService,
    private readonly status: TelemetryStatusService,
    private readonly stack: TelemetryStackService,
    private readonly dashboard: TelemetryDashboardService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async collect(ctx: SupportBundleSectionContext): Promise<TelemetrySectionData | SupportBundleOmission> {
    if (!this.greptime.isConfigured()) return omitSupportBundleSection('no telemetry store is configured');
    const policy = await this.settings.getPolicy();
    if (!policy.enabled) return omitSupportBundleSection('telemetry is switched off');

    const [status, stack, summary] = await Promise.all([
      this.status.getStatus(),
      this.stack.getStatus(),
      this.dashboard
        .summary(ctx.actorUserId, { range: TELEMETRY_SUPPORT_BUNDLE_RANGE })
        .then((value) => ({ value, error: null }))
        .catch((error: unknown) => ({ value: null, error: firstLine(error) })),
    ]);

    return {
      status: {
        configured: status.configured,
        reachable: status.reachable,
        version: status.version,
        ttlDays: status.ttl?.days ?? null,
        retentionDays: status.retentionDays,
        tableCount: status.tables.length,
        tables: status.tables.map((table) => ({ name: table.name, rows: table.rows })),
        error: status.error,
      },
      stack: {
        agent: stack.agent,
        services: stack.services.map((service) => ({ name: service.name, state: service.state, health: service.health })),
      },
      summary: summary.value
        ? {
            range: TELEMETRY_SUPPORT_BUNDLE_RANGE,
            verdict: { level: summary.value.verdict.level, reasons: [...summary.value.verdict.reasons] },
            tiles: summary.value.tiles.map(pickTile),
            runtime: (summary.value.runtime ?? []).map(pickTile),
          }
        : null,
      summaryError: summary.error,
      metricGroups: metricGroupIds(),
    };
  }
}
