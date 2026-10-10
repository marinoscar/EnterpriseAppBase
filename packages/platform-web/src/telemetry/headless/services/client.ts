/**
 * The telemetry API client (issues #537, #558, #567, #578, #680; packaged by
 * #704).
 *
 * Every call goes through the app's transport (`PlatformApiClient`, the
 * `@marinoscar/platform-web/core` port): the auth header, the token refresh
 * and the maintenance handling stay in the app. Paths are relative to the API
 * base. The routes and the permission each one enforces:
 *
 *   - `GET  /telemetry/config`                  (any signed-in user)
 *   - `GET  /admin/telemetry/config`            (`telemetry:read`)
 *   - `PUT  /admin/telemetry/config`            (`telemetry:write`, If-Match)
 *   - `GET  /admin/telemetry/status`            (`telemetry:read`)
 *   - `GET|PUT|DELETE /admin/telemetry/connection`, `POST …/connection/test`
 *                                               (`telemetry:read` / `telemetry:write`)
 *   - `GET  /admin/telemetry/stack`, `POST …/stack/deploy`
 *                                               (`system_settings:read` / `system_settings:write`)
 *   - `POST /admin/telemetry/query`, `GET …/schema`, `POST …/export`
 *                                               (`telemetry:query`)
 *   - `POST /admin/telemetry/assistant/stream`  (`telemetry:query` + `ai:use`)
 *   - `GET  /admin/telemetry/dashboard/*`       (`telemetry:query`)
 *
 * The browser only presents and collects. Whether a statement is read-only,
 * how many rows it may return and how long it may run are decided by the API.
 */

import { useMemo } from 'react';

import { usePlatformApi } from '../../../core/index.js';
import type { PlatformApiClient } from '../../../core/index.js';
import {
  downloadBlob,
  filenameFromContentDisposition,
  telemetryExportFilename,
} from './telemetry.js';
import type {
  TelemetryAdminConfig,
  TelemetryAssistantAnswer,
  TelemetryAssistantHandlers,
  TelemetryAssistantRequest,
  TelemetryAssistantReport,
  TelemetryAssistantStep,
  TelemetryConnection,
  TelemetryConnectionInput,
  TelemetryConnectionTestResult,
  TelemetryExportFormat,
  TelemetryExportResult,
  TelemetryPublicConfig,
  TelemetryQueryResult,
  TelemetrySchema,
  TelemetrySettingsUpdate,
  TelemetryStack,
  TelemetryStatus,
} from './telemetry.js';
import { dashboardSearchParams } from './telemetryDashboard.js';
import type {
  DashboardEvents,
  DashboardEventsQuery,
  DashboardFilters,
  DashboardMetricGroup,
  DashboardMetricGroupMeta,
  DashboardMetrics,
  DashboardMetricsQuery,
  DashboardQuery,
  DashboardSummary,
  DashboardTimeseries,
  DashboardTimeseriesPanel,
  DashboardTop,
  DashboardTopKind,
} from './telemetryDashboard.js';

/**
 * Options a dashboard read takes.
 *
 * @stability experimental
 */
export interface TelemetryRequestOptions {
  /** Aborts the request (a superseded range, an unmount). */
  signal?: AbortSignal;
}

/**
 * The telemetry routes as methods. Build one with
 * {@link createTelemetryClient}; inside a page, {@link useTelemetryClient}
 * builds it from the platform host.
 *
 * @stability experimental
 */
export interface TelemetryClient {
  /** `GET /telemetry/config`: the feature flag every signed-in client reads. */
  getTelemetryConfig(): Promise<TelemetryPublicConfig>;
  /** `GET /admin/telemetry/config`: the settings plus provenance. */
  getTelemetryAdminConfig(): Promise<TelemetryAdminConfig>;
  /**
   * `PUT /admin/telemetry/config`. `expectedVersion` travels as `If-Match`; a
   * stale version answers 409.
   */
  updateTelemetryAdminConfig(settings: TelemetrySettingsUpdate, expectedVersion?: number): Promise<TelemetryAdminConfig>;
  /** `GET /admin/telemetry/status`: a diagnosis, always 200. */
  getTelemetryStatus(): Promise<TelemetryStatus>;
  /** `GET /admin/telemetry/connection`. */
  getTelemetryConnection(): Promise<TelemetryConnection>;
  /** `PUT /admin/telemetry/connection`, `If-Match` from `expectedVersion`. */
  updateTelemetryConnection(input: TelemetryConnectionInput, expectedVersion?: number): Promise<TelemetryConnection>;
  /** `DELETE /admin/telemetry/connection`: the deployment default (or none) is in force again. */
  resetTelemetryConnection(expectedVersion?: number): Promise<TelemetryConnection>;
  /** `POST /admin/telemetry/connection/test`: a diagnosis, always 200. */
  testTelemetryConnection(input: TelemetryConnectionInput): Promise<TelemetryConnectionTestResult>;
  /** `GET /admin/telemetry/stack`. */
  getTelemetryStack(): Promise<TelemetryStack>;
  /** `POST /admin/telemetry/stack/deploy`: enqueue a (re)deploy of the telemetry services. */
  deployTelemetryStack(): Promise<TelemetryStackDeployAccepted>;
  /** `POST /admin/telemetry/query`. */
  runTelemetryQuery(sql: string, options?: { maxRows?: number; signal?: AbortSignal }): Promise<TelemetryQueryResult>;
  /** `GET /admin/telemetry/schema`. */
  getTelemetrySchema(): Promise<TelemetrySchema>;
  /**
   * `POST /admin/telemetry/export`: fetched as a Blob through the app's
   * transport, then handed to the browser as a download named by
   * `Content-Disposition`. Resolves with the filename and the
   * row-count/truncation headers. Rejects when the transport has no
   * `postBlob`.
   */
  exportTelemetry(sql: string, format: TelemetryExportFormat): Promise<TelemetryExportResult>;
  /**
   * Stream one assistant turn. Resolves when the stream ends (or quietly on
   * abort). Rejects with a `PlatformApiError` when a gate refused the request
   * before the first byte (`TELEMETRY_ASSISTANT_DISABLED`, `AI_DISABLED`, ...),
   * and when the transport has no `postSse`.
   */
  streamTelemetryAssistant(request: TelemetryAssistantRequest, handlers?: TelemetryAssistantHandlers): Promise<void>;
  /** `GET …/dashboard/summary`. */
  getDashboardSummary(query: DashboardQuery, options?: TelemetryRequestOptions): Promise<DashboardSummary>;
  /** `GET …/dashboard/timeseries?panel=…`. */
  getDashboardTimeseries<P extends DashboardTimeseriesPanel>(
    panel: P,
    query: DashboardQuery,
    options?: TelemetryRequestOptions,
  ): Promise<DashboardTimeseries<P>>;
  /** `GET …/dashboard/top?kind=…`. */
  getDashboardTop<K extends DashboardTopKind>(
    kind: K,
    query: DashboardQuery,
    options?: TelemetryRequestOptions,
  ): Promise<DashboardTop<K>>;
  /** `GET …/dashboard/events`. */
  getDashboardEvents(query: DashboardEventsQuery, options?: TelemetryRequestOptions): Promise<DashboardEvents>;
  /** `GET …/dashboard/filters`. */
  getDashboardFilters(query: DashboardQuery, options?: TelemetryRequestOptions): Promise<DashboardFilters>;
  /** `GET …/dashboard/metrics?group=…`: one metric group's tiles, series and tables. */
  getDashboardMetrics(
    group: DashboardMetricGroup,
    query: DashboardMetricsQuery,
    options?: TelemetryRequestOptions,
  ): Promise<DashboardMetrics>;
  /**
   * `GET …/dashboard/metric-groups`: every registered metric group, in
   * dashboard order (the platform's and the app's own).
   */
  getDashboardMetricGroups(options?: TelemetryRequestOptions): Promise<DashboardMetricGroupMeta[]>;
}

/**
 * What `POST /admin/telemetry/stack/deploy` answers (202).
 *
 * @stability experimental
 */
export interface TelemetryStackDeployAccepted {
  /** The queued `telemetry.stack.deploy` job. */
  jobId: string;
}

const DASHBOARD = '/admin/telemetry/dashboard';

function ifMatch(expectedVersion: number | undefined): { ifMatch?: string } {
  return expectedVersion === undefined ? {} : { ifMatch: String(expectedVersion) };
}

function signalOf(options: TelemetryRequestOptions | undefined): { signal?: AbortSignal } {
  return options?.signal === undefined ? {} : { signal: options.signal };
}

/** An older API sends no `report`; a newer one may send `null`. Both read as `null`. */
function normalizeAssistantAnswer(payload: Record<string, unknown>): TelemetryAssistantAnswer {
  const answer = payload as unknown as TelemetryAssistantAnswer;
  const report = answer.report;
  return {
    ...answer,
    report: report && typeof report === 'object' ? (report as TelemetryAssistantReport) : null,
  };
}

/**
 * The telemetry routes over the app's transport.
 *
 * @param api - the app's transport (`usePlatformApi()`, or any `PlatformApiClient`).
 * @returns a {@link TelemetryClient}.
 *
 * @example
 * ```ts
 * const telemetry = createTelemetryClient(host.api);
 * const status = await telemetry.getTelemetryStatus();
 * ```
 *
 * @stability experimental
 */
export function createTelemetryClient(api: PlatformApiClient): TelemetryClient {
  return {
    getTelemetryConfig: () => api.get<TelemetryPublicConfig>('/telemetry/config'),
    getTelemetryAdminConfig: () => api.get<TelemetryAdminConfig>('/admin/telemetry/config'),
    updateTelemetryAdminConfig: (settings, expectedVersion) =>
      api.put<TelemetryAdminConfig>('/admin/telemetry/config', settings, ifMatch(expectedVersion)),
    getTelemetryStatus: () => api.get<TelemetryStatus>('/admin/telemetry/status'),

    getTelemetryConnection: () => api.get<TelemetryConnection>('/admin/telemetry/connection'),
    updateTelemetryConnection: (input, expectedVersion) =>
      api.put<TelemetryConnection>('/admin/telemetry/connection', input, ifMatch(expectedVersion)),
    resetTelemetryConnection: (expectedVersion) =>
      api.delete<TelemetryConnection>('/admin/telemetry/connection', ifMatch(expectedVersion)),
    testTelemetryConnection: (input) =>
      api.post<TelemetryConnectionTestResult>('/admin/telemetry/connection/test', input),

    getTelemetryStack: () => api.get<TelemetryStack>('/admin/telemetry/stack'),
    deployTelemetryStack: () => api.post<TelemetryStackDeployAccepted>('/admin/telemetry/stack/deploy'),

    runTelemetryQuery: (sql, options = {}) => {
      const body: { sql: string; maxRows?: number } = { sql };
      if (options.maxRows !== undefined) body.maxRows = options.maxRows;
      return api.post<TelemetryQueryResult>('/admin/telemetry/query', body, signalOf(options));
    },
    getTelemetrySchema: () => api.get<TelemetrySchema>('/admin/telemetry/schema'),

    exportTelemetry: async (sql, format) => {
      if (!api.postBlob) {
        throw new Error('The platform host transport has no postBlob, so the telemetry export cannot download.');
      }
      const { blob, headers } = await api.postBlob('/admin/telemetry/export', { sql, format });
      const filename =
        filenameFromContentDisposition(headers.get('Content-Disposition')) ?? telemetryExportFilename(format);
      downloadBlob(blob, filename);
      const rawCount = headers.get('X-Telemetry-Row-Count');
      const rowCount = rawCount !== null && rawCount.trim() !== '' ? Number(rawCount) : null;
      return {
        filename,
        rowCount: rowCount !== null && Number.isFinite(rowCount) ? rowCount : null,
        truncated: (headers.get('X-Telemetry-Truncated') ?? '').toLowerCase() === 'true',
      };
    },

    streamTelemetryAssistant: async (request, handlers = {}) => {
      if (!api.postSse) {
        throw new Error('The platform host transport has no postSse, so the telemetry assistant cannot stream.');
      }
      await api.postSse('/admin/telemetry/assistant/stream', request, {
        ...signalOf(handlers),
        onFrame: (eventName, data) => {
          const payload = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
          switch (eventName) {
            case 'step':
              handlers.onStep?.(payload as unknown as TelemetryAssistantStep);
              break;
            case 'answer':
              handlers.onAnswer?.(normalizeAssistantAnswer(payload));
              break;
            case 'error':
              handlers.onError?.({
                code: String(payload.code ?? 'ERROR'),
                message: String(payload.message ?? 'The assistant failed'),
              });
              break;
            default:
              break;
          }
        },
      });
    },

    getDashboardSummary: (query, options) =>
      api.get<DashboardSummary>(`${DASHBOARD}/summary?${dashboardSearchParams(query)}`, signalOf(options)),
    getDashboardTimeseries: (panel, query, options) =>
      api.get(`${DASHBOARD}/timeseries?${dashboardSearchParams(query, { panel })}`, signalOf(options)),
    getDashboardTop: (kind, query, options) =>
      api.get(`${DASHBOARD}/top?${dashboardSearchParams(query, { kind })}`, signalOf(options)),
    getDashboardEvents: (query, options) =>
      api.get<DashboardEvents>(`${DASHBOARD}/events?${dashboardSearchParams(query)}`, signalOf(options)),
    getDashboardFilters: (query, options) =>
      api.get<DashboardFilters>(`${DASHBOARD}/filters?${dashboardSearchParams(query)}`, signalOf(options)),
    getDashboardMetrics: (group, query, options) =>
      api.get<DashboardMetrics>(`${DASHBOARD}/metrics?${dashboardSearchParams(query, { group })}`, signalOf(options)),
    getDashboardMetricGroups: (options) =>
      api.get<DashboardMetricGroupMeta[]>(`${DASHBOARD}/metric-groups`, signalOf(options)),
  };
}

/**
 * The telemetry client over the platform host's transport, memoised on it (a
 * stable transport gives a stable client, so hooks keyed on it never refetch
 * on a re-render).
 *
 * @returns a {@link TelemetryClient}.
 * @throws Error outside a `PlatformHostProvider`.
 *
 * @stability experimental
 */
export function useTelemetryClient(): TelemetryClient {
  const api = usePlatformApi();
  return useMemo(() => createTelemetryClient(api), [api]);
}
