import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  DASHBOARD_PANELS,
  DASHBOARD_PANEL_ID_PATTERN,
  DASHBOARD_PANEL_PAYLOAD_MAX_BYTES,
  type TelemetryDashboardPanelData,
  type TelemetryDashboardPanels,
  type TelemetryDashboardQuery,
} from '@marinoscar/platform-contract/telemetry';

import { TELEMETRY_ERROR_REASONS, TelemetryHttpError } from '../../query/telemetry-query.errors';
import { createQueryFacade } from '../../query/telemetry-query-facade';
import { TelemetryQueryService } from '../../query/telemetry-query.service';
import { TELEMETRY_SQL_DIALECT, type TelemetrySqlDialect } from '../../stores/telemetry-store';
import { TelemetryDashboardService } from '../telemetry-dashboard.service';
import { dashboardPanelRegistry, isBuiltinDashboardPanel, type DashboardPanelContext } from './dashboard-panels';

// =============================================================================
// TelemetryDashboardPanelService (PP-14.18)
// =============================================================================
//
// Lists the registered dashboard panels and reads one. The panel's `data`
// function is APP CODE running inside the request, so everything around it is
// defensive:
//
//   - it receives a frozen context: the window, the filters (validated against
//     the values the store has seen), and the guarded query facade. No client,
//     pool, connection or store port, and no user object;
//   - its statements go through the facade: one read-only statement at a time
//     (the SQL guard), a row cap, the policy timeout, an audit row naming the
//     user and the source `panel`, and at most `FACADE_MAX_STATEMENTS`;
//   - it has a time budget (`PANEL_TIME_BUDGET_MS`): the facade's signal is
//     aborted when it is spent and the read fails;
//   - what it returns is serialised, bounded to
//     `DASHBOARD_PANEL_PAYLOAD_MAX_BYTES` and parsed back, so the answer is
//     plain JSON whatever it returned (a function, a class instance, a cycle
//     and a BigInt are refused or flattened);
//   - what it throws is logged with the panel id and answered as a generic
//     `TELEMETRY_PANEL_FAILED`: the viewer never reads app internals. A
//     `TelemetryHttpError` (the store is off, a statement was refused) passes
//     through unchanged: it is about the store, and says so.
//
// NOT A QUEUE JOB (CLAUDE.md): bounded by the time budget and the facade's
// statement budget, it cannot outlive the request that asked for it.
// =============================================================================

/**
 * How long a panel's `data` function may run before its signal aborts and the
 * read fails, in milliseconds.
 *
 * @stability experimental
 */
export const PANEL_TIME_BUDGET_MS = 30_000;

/** The generic message of a failed panel; the cause goes to the log. */
const PANEL_FAILED_MESSAGE = 'The dashboard panel could not be read.';

@Injectable()
export class TelemetryDashboardPanelService {
  private readonly logger = new Logger(TelemetryDashboardPanelService.name);

  constructor(
    private readonly dashboard: TelemetryDashboardService,
    private readonly queries: TelemetryQueryService,
    @Inject(TELEMETRY_SQL_DIALECT) private readonly dialect: TelemetrySqlDialect,
  ) {}

  /** Every registered panel in dashboard order. No store read. */
  list(): TelemetryDashboardPanels {
    return {
      data: dashboardPanelRegistry
        .list()
        .map((panel) => ({ id: panel.id, label: panel.label, order: panel.order, builtin: isBuiltinDashboardPanel(panel.id) })),
    };
  }

  /**
   * Reads one panel for the dashboard's window.
   *
   * @param userId - who is asking (the facade's audit rows name them).
   * @param id - the panel id.
   * @param query - the dashboard window and filters.
   * @returns the panel's bounded JSON payload.
   * @throws NotFoundException for an id nothing registered.
   * @throws TelemetryHttpError for a store failure, or `TELEMETRY_PANEL_FAILED`.
   */
  async read(userId: string, id: string, query: TelemetryDashboardQuery): Promise<TelemetryDashboardPanelData> {
    const panel = DASHBOARD_PANEL_ID_PATTERN.test(id) ? dashboardPanelRegistry.get(id) : undefined;
    if (!panel) throw new NotFoundException('There is no such dashboard panel.');

    const { window, filters } = await this.dashboard.panelScope(userId, query);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('panel time budget spent')), PANEL_TIME_BUDGET_MS);
    timer.unref?.();

    const context: DashboardPanelContext = Object.freeze({
      id: panel.id,
      window: Object.freeze(window),
      filters: Object.freeze(filters),
      query: createQueryFacade(this.queries, userId, { source: 'panel', dialect: this.dialect, signal: controller.signal }),
      timeseries: (name: (typeof DASHBOARD_PANELS)[number]) => this.dashboard.timeseries(userId, { ...query, panel: name }),
      signal: controller.signal,
    });

    try {
      const raw = await Promise.race([
        Promise.resolve().then(() => panel.data(context)),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
        }),
      ]);
      return { id: panel.id, generatedAt: new Date().toISOString(), payload: this.bounded(panel.id, raw) };
    } catch (error) {
      if (error instanceof TelemetryHttpError) throw error;
      this.logger.error(
        `Dashboard panel "${panel.id}" failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new TelemetryHttpError(TELEMETRY_ERROR_REASONS.PANEL_FAILED, PANEL_FAILED_MESSAGE);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The value as plain JSON, or a thrown error (logged by the caller) when it is not, or too large. */
  private bounded(id: string, value: unknown): unknown {
    if (value === undefined) return null;
    const text = JSON.stringify(value);
    if (text === undefined) throw new Error(`panel "${id}" returned something JSON cannot carry`);
    if (Buffer.byteLength(text, 'utf8') > DASHBOARD_PANEL_PAYLOAD_MAX_BYTES) {
      throw new Error(`panel "${id}" returned more than ${DASHBOARD_PANEL_PAYLOAD_MAX_BYTES} bytes`);
    }
    return JSON.parse(text) as unknown;
  }
}
