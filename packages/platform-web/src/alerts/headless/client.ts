// =============================================================================
// The alerts client (issue #1047): the `/api/admin/alerts` routes
// =============================================================================
//
// Every route is a SYSTEM route: reads need `alerts:read`, writes (create,
// edit, delete, test, acknowledge) need `alerts:write` (`ALERT_PERMISSIONS` of
// `@marinoscar/platform-contract/alerts`). The transport (`PlatformApiClient`)
// prefixes `/api` and unwraps the `{ data }` envelope. The API decides who may
// do what; the client only builds paths.
//
// One route here is not the alerts slice's: the metric picker of the rule
// editor reads the telemetry store's table list (`GET /admin/telemetry/schema`,
// `telemetry:query`), the same list the telemetry explorer's schema panel
// reads. It is read through the contract's wire type only, so the alerts web
// slice does not depend on the telemetry web slice.
// =============================================================================

import type {
  AlertIncident,
  AlertIncidentState,
  AlertKind,
  AlertRule,
  AlertRuleTestResponse,
  AlertSeverity,
  AlertSummary,
  CreateAlertRule,
  UpdateAlertRule,
} from '@marinoscar/platform-contract/alerts';
import type { TelemetrySchema } from '@marinoscar/platform-contract/telemetry';

import type { PlatformApiClient } from '../../core/index.js';

/**
 * The route base of the alerts slice, relative to the API root (`/api`).
 *
 * @stability experimental
 */
export const ALERTS_BASE_PATH = '/admin/alerts';

/**
 * The telemetry route the metric picker reads (relative to `/api`).
 *
 * @stability experimental
 */
export const ALERTS_METRIC_CATALOG_PATH = '/admin/telemetry/schema';

/**
 * The filters of a rule list request.
 *
 * @stability experimental
 */
export interface AlertRulesQuery {
  /** Only rules of this kind. */
  kind?: string;
  /** Only rules of this severity. */
  severity?: AlertSeverity;
  /** Only enabled (`true`) or disabled (`false`) rules. */
  enabled?: boolean;
}

/**
 * The filters and page of an incident list request. `page` is one-based, as
 * on the wire.
 *
 * @stability experimental
 */
export interface AlertIncidentsQuery {
  /** Only incidents in this state. */
  state?: AlertIncidentState;
  /** Only incidents of this severity. */
  severity?: AlertSeverity;
  /** Only incidents of this rule. */
  ruleId?: string;
  /** One-based page; default 1. */
  page?: number;
  /** Rows per page; default the API's (20). */
  pageSize?: number;
}

/**
 * One page of incidents as `GET /admin/alerts/incidents` returns it.
 *
 * @stability experimental
 */
export interface AlertIncidentPage {
  /** The incidents of the page. */
  items: AlertIncident[];
  /** Incidents matching the filters, across every page. */
  total: number;
  /** The one-based page. */
  page: number;
  /** Rows per page. */
  pageSize: number;
  /** Pages at this page size. */
  totalPages: number;
}

/**
 * One metric the rule editor can pick: a telemetry store table and its
 * attribute columns (the `groupBy` and filter candidates).
 *
 * @stability experimental
 */
export interface AlertMetricCatalogEntry {
  /** The table name, accepted as `metric` by `metric_threshold` (`app_jobs_settled`). */
  name: string;
  /** The columns other than the value and the timestamp. */
  attributes: string[];
}

/**
 * The alerts API calls.
 *
 * @stability experimental
 */
export interface AlertsApi {
  /** `GET /admin/alerts/rules`. */
  listRules(query?: AlertRulesQuery): Promise<AlertRule[]>;
  /** `GET /admin/alerts/rules/:id`. */
  getRule(id: string): Promise<AlertRule>;
  /** `POST /admin/alerts/rules`. */
  createRule(input: CreateAlertRule): Promise<AlertRule>;
  /** `PATCH /admin/alerts/rules/:id` (the kind cannot change). */
  updateRule(id: string, patch: UpdateAlertRule): Promise<AlertRule>;
  /** `DELETE /admin/alerts/rules/:id` (a starter rule answers 409). */
  deleteRule(id: string): Promise<void>;
  /** `POST /admin/alerts/rules/:id/test`: a dry run, nothing stored or sent. */
  testRule(id: string): Promise<AlertRuleTestResponse>;
  /** `GET /admin/alerts/kinds`. */
  listKinds(): Promise<AlertKind[]>;
  /** `GET /admin/alerts/incidents?state&severity&ruleId&page&pageSize`. */
  listIncidents(query?: AlertIncidentsQuery): Promise<AlertIncidentPage>;
  /** `GET /admin/alerts/incidents/:id`. */
  getIncident(id: string): Promise<AlertIncident>;
  /** `POST /admin/alerts/incidents/:id/acknowledge`. */
  acknowledge(id: string): Promise<AlertIncident>;
  /** `GET /admin/alerts/summary`: firing counts by severity. */
  summary(): Promise<AlertSummary>;
  /** `GET /admin/telemetry/schema`, reduced to the metric tables and their attributes. */
  metricCatalog(): Promise<AlertMetricCatalogEntry[]>;
}

/** Columns of a metric table that are never a `groupBy` or filter candidate. */
const NON_ATTRIBUTE_COLUMNS = new Set(['greptime_value', 'greptime_timestamp', 'val', 'ts', 'timestamp']);

/** Tables of the store that are traces or logs, not metrics. */
function isMetricTable(name: string): boolean {
  return !name.startsWith('opentelemetry_') && !name.startsWith('information_schema');
}

/**
 * The store's table list as the metric picker's entries: the metric tables
 * (not the trace and log tables), each with its attribute columns, sorted by
 * name.
 *
 * @param schema - what `GET /admin/telemetry/schema` returned.
 * @returns the entries.
 *
 * @stability experimental
 */
export function metricCatalogFromSchema(schema: Pick<TelemetrySchema, 'tables'>): AlertMetricCatalogEntry[] {
  return schema.tables
    .filter((table) => isMetricTable(table.name))
    .map((table) => ({
      name: table.name,
      attributes: table.columns.map((column) => column.name).filter((name) => !NON_ATTRIBUTE_COLUMNS.has(name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

/**
 * The alerts client over the app's transport.
 *
 * @param api - the app's transport (`usePlatformApi()`).
 * @returns the client.
 *
 * @example
 * ```ts
 * const alerts = createAlertsApi(usePlatformApi());
 * const { firing } = await alerts.summary();
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function createAlertsApi(api: PlatformApiClient): AlertsApi {
  const rule = (id: string) => `${ALERTS_BASE_PATH}/rules/${encodeURIComponent(id)}`;
  const incident = (id: string) => `${ALERTS_BASE_PATH}/incidents/${encodeURIComponent(id)}`;
  return {
    listRules: (query = {}) =>
      api.get<AlertRule[]>(
        `${ALERTS_BASE_PATH}/rules${queryString({ kind: query.kind, severity: query.severity, enabled: query.enabled })}`,
      ),
    getRule: (id) => api.get<AlertRule>(rule(id)),
    createRule: (input) => api.post<AlertRule>(`${ALERTS_BASE_PATH}/rules`, input),
    updateRule: (id, patch) => api.patch<AlertRule>(rule(id), patch),
    deleteRule: async (id) => {
      await api.delete<unknown>(rule(id));
    },
    testRule: (id) => api.post<AlertRuleTestResponse>(`${rule(id)}/test`),
    listKinds: () => api.get<AlertKind[]>(`${ALERTS_BASE_PATH}/kinds`),
    listIncidents: (query = {}) =>
      api.get<AlertIncidentPage>(
        `${ALERTS_BASE_PATH}/incidents${queryString({
          state: query.state,
          severity: query.severity,
          ruleId: query.ruleId,
          page: query.page,
          pageSize: query.pageSize,
        })}`,
      ),
    getIncident: (id) => api.get<AlertIncident>(incident(id)),
    acknowledge: (id) => api.post<AlertIncident>(`${incident(id)}/acknowledge`),
    summary: () => api.get<AlertSummary>(`${ALERTS_BASE_PATH}/summary`),
    metricCatalog: async () => metricCatalogFromSchema(await api.get<TelemetrySchema>(ALERTS_METRIC_CATALOG_PATH)),
  };
}
