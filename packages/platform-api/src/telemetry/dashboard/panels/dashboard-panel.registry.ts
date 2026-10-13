import {
  DASHBOARD_PANELS,
  DASHBOARD_PANEL_ID_PATTERN,
  type TelemetryDashboardTimeseries,
} from '@marinoscar/platform-contract/telemetry';

import { defineRegistry, type Registry } from '../../../core/index';
import type { TelemetryQueryFacade } from '../../query/telemetry-query-facade';

// =============================================================================
// The dashboard-panel registry (PP-14.18)
// =============================================================================
//
// A dashboard panel is a card of the Telemetry Dashboard with its own data:
// the API registers `{ id, label, order, data }`, the web registers a view for
// the same id (`registerDashboardPanelView`, `@marinoscar/platform-web/telemetry/ui`),
// and the dashboard renders it. The platform's own `api` and `logs` panels are
// registered here through the same function (see ./dashboard-panel.manifest.ts).
//
// `GET /api/admin/telemetry/dashboard/panels` lists the registered panels and
// `GET .../panels/:id` runs one panel's `data` function for the dashboard's
// window, behind the same `telemetry:query` permission as every dashboard
// route. The function receives a CONTEXT, never a client: the window, the
// validated filters, and the guarded query facade (one read-only statement at a
// time through the explorer's SQL guard, row cap, timeout and audit).
//
// ⚠ FRAMEWORK-FREE, like the other static registries of this slice.
// =============================================================================

/**
 * The window a panel is read for: the dashboard's selected range, with the
 * bucket size the platform's own panels use for it.
 *
 * @stability experimental
 */
export interface DashboardPanelWindow {
  /** Window start (inclusive). */
  readonly from: Date;
  /** Window end (exclusive). */
  readonly to: Date;
  /** The previous window of equal length starts here (ends at `from`). */
  readonly previousFrom: Date;
  /** The bucket size the dashboard picked for this window, in seconds. */
  readonly bucketSeconds: number;
}

/**
 * What a panel's `data` function receives. Read-only: it carries no client,
 * pool, connection or store port.
 *
 * @stability experimental
 */
export interface DashboardPanelContext {
  /** The panel being read. */
  readonly id: string;
  /** The dashboard's window. */
  readonly window: DashboardPanelWindow;
  /** The `service` / `instance` filters, each already checked against the values seen in the window. */
  readonly filters: Readonly<{
    /** The selected service (`service.name`), when the viewer filtered by one. */
    service?: string;
    /** The selected instance (`app.instance.id`), when the viewer filtered by one. */
    instance?: string;
  }>;
  /** The guarded way to read the telemetry store. */
  readonly query: TelemetryQueryFacade;
  /** The platform's own series for the same window (`api` or `logs`), for a panel built on them. */
  timeseries(panel: (typeof DASHBOARD_PANELS)[number]): Promise<TelemetryDashboardTimeseries>;
  /** Aborted when the panel's time budget is spent. */
  readonly signal: AbortSignal;
}

/**
 * A dashboard panel: its identity and the function that reads its data.
 *
 * @example
 * ```ts
 * registerDashboardPanel({
 *   id: 'signups', label: 'Sign-ups', order: 100,
 *   data: async (ctx) => {
 *     const rows = await ctx.query.query(`SELECT count(*) AS n FROM app_auth_logins_total WHERE ${ctx.query.sql.between('greptime_timestamp', ctx.window.from, ctx.window.to)}`);
 *     return { total: Number(rows.rows[0]?.[0] ?? 0) };
 *   },
 * });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface DashboardPanelDef {
  /** `signups`. Lowercase letters, digits, `_` and `-`, 2 to 48 characters; permanent (the web registers its view under it). */
  id: string;
  /** The panel title (1 to 80 characters). */
  label: string;
  /** Dashboard order, ascending; ties sort by id. The platform's panels use 10 and 20; an app's go after. */
  order: number;
  /**
   * Reads the panel's data. Return JSON: it is serialised, bounded to
   * `DASHBOARD_PANEL_PAYLOAD_MAX_BYTES` and handed to the panel's web view as
   * `payload`. A failure is logged and answered as a generic 500; throw
   * nothing the viewer should read.
   *
   * @param ctx - the window, filters and guarded query facade.
   * @returns the payload.
   */
  data(ctx: DashboardPanelContext): Promise<unknown> | unknown;
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Every registered dashboard panel, in dashboard order. Frozen once the Nest
 * application has bootstrapped.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const dashboardPanelRegistry: Registry<DashboardPanelDef> = defineRegistry<DashboardPanelDef>({
  name: 'telemetry-dashboard-panels',
  idOf: (panel) => panel.id,
  idPattern: DASHBOARD_PANEL_ID_PATTERN,
  validate: (panel) => {
    if (typeof panel.label !== 'string' || panel.label.trim() === '' || panel.label.length > 80) {
      throw new Error(`Dashboard panel "${panel.id}" label must be 1 to 80 characters.`);
    }
    if (typeof panel.order !== 'number' || !Number.isFinite(panel.order)) {
      throw new Error(`Dashboard panel "${panel.id}" order must be a finite number.`);
    }
    if (typeof panel.data !== 'function') {
      throw new Error(`Dashboard panel "${panel.id}" needs a data function.`);
    }
  },
  describeDuplicate: (_existing, incoming) =>
    `Duplicate dashboard panel id "${incoming.id}": a panel id is registered once (the platform's api and logs first, then the app's).`,
  order: (a, b) => a.order - b.order || compareCodeUnits(a.id, b.id),
});

/**
 * Registers a dashboard panel. Call it at import time (the reference app: from
 * `app-registrations/telemetry.ts`). Register the web view for the same id with
 * `registerDashboardPanelView`; a panel with no view is listed by the API and
 * not drawn by the dashboard.
 *
 * @param panel - the panel.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID`, or `FROZEN`
 *   once the application has bootstrapped.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerDashboardPanel(panel: DashboardPanelDef): void {
  dashboardPanelRegistry.register(panel);
}

/**
 * Whether the platform defines this panel (`api`, `logs`) rather than the app.
 *
 * @param id - a panel id.
 * @returns `true` for the platform's own panels.
 *
 * @stability experimental
 */
export function isBuiltinDashboardPanel(id: string): boolean {
  return (DASHBOARD_PANELS as readonly string[]).includes(id);
}
