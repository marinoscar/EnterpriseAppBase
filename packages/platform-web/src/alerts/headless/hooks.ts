// =============================================================================
// The alerts hooks (issue #1047): reads with a load state, and the writes
// =============================================================================
//
// A failure becomes a sentence in `error` (a stable refusal code mapped to
// words, else the API's message); a write resolves with `null` (or `false`)
// instead of throwing. `useAlertSummary` polls every 30 seconds while the tab
// is visible, for the dashboard banner.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ALERT_ERROR_CODES } from '@marinoscar/platform-contract/alerts';
import type {
  AlertIncident,
  AlertKind,
  AlertRule,
  AlertRuleTestResponse,
  AlertSummary,
  CreateAlertRule,
  UpdateAlertRule,
} from '@marinoscar/platform-contract/alerts';

import { isPlatformApiError, usePlatformApi } from '../../core/index.js';
import {
  createAlertsApi,
  type AlertIncidentsQuery,
  type AlertMetricCatalogEntry,
  type AlertRulesQuery,
  type AlertsApi,
} from './client.js';

const CODE_MESSAGES: Readonly<Record<string, string>> = {
  [ALERT_ERROR_CODES.RULE_NOT_FOUND]: 'That alert rule no longer exists.',
  [ALERT_ERROR_CODES.INCIDENT_NOT_FOUND]: 'That incident no longer exists.',
  [ALERT_ERROR_CODES.UNKNOWN_KIND]: 'That rule kind is not available on this deployment.',
  [ALERT_ERROR_CODES.INVALID_CONFIG]: 'The rule configuration is not valid for its kind.',
  [ALERT_ERROR_CODES.STARTER_RULE_PROTECTED]: 'Built-in rules cannot be deleted. Disable the rule instead.',
};

/** The default poll interval of {@link useAlertSummary}, in milliseconds. */
const SUMMARY_POLL_MS = 30_000;

/**
 * An alerts API failure in words: the refusal code's sentence (`code` or
 * `details.reason`), else the API's message, else `fallback`.
 *
 * @param error - what the call rejected with.
 * @param fallback - the sentence when nothing better is known.
 * @returns the message.
 *
 * @stability experimental
 */
export function alertErrorMessage(error: unknown, fallback: string): string {
  if (isPlatformApiError(error)) {
    const details = error.details as { reason?: unknown } | undefined;
    const reason = typeof details?.reason === 'string' ? details.reason : undefined;
    for (const code of [error.code, reason]) {
      if (typeof code === 'string' && CODE_MESSAGES[code]) return CODE_MESSAGES[code]!;
    }
    if (typeof error.message === 'string' && error.message !== '') return error.message;
  }
  return fallback;
}

function useMounted(): () => boolean {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => mounted.current, []);
}

/** Runs `load` now and on `refresh`, keeping only the newest answer. */
function useLoad<T>(load: (() => Promise<T>) | null, fallback: string) {
  const mounted = useMounted();
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(load !== null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!load) return;
    const ticket = ++seq.current;
    setIsLoading(true);
    try {
      const next = await load();
      if (!mounted() || ticket !== seq.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (mounted() && ticket === seq.current) setError(alertErrorMessage(err, fallback));
    } finally {
      if (mounted() && ticket === seq.current) setIsLoading(false);
    }
  }, [load, fallback, mounted]);

  useEffect(() => {
    if (!load) {
      seq.current += 1;
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    void refresh();
  }, [load, refresh]);

  return { data, isLoading, error, refresh };
}

/** Calls `callback` every `intervalMs` while the document is visible. */
function useVisibleInterval(callback: () => void, intervalMs: number): void {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    if (intervalMs <= 0 || typeof document === 'undefined') return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      if (timer === null) timer = setInterval(() => ref.current(), intervalMs);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stop();
      } else {
        ref.current();
        start();
      }
    };
    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);
}

/**
 * The alerts client over the host's transport, memoised.
 *
 * @returns the client.
 *
 * @stability experimental
 */
export function useAlertsApi(): AlertsApi {
  const api = usePlatformApi();
  return useMemo(() => createAlertsApi(api), [api]);
}

/**
 * What {@link useAlertRules} returns.
 *
 * @stability experimental
 */
export interface AlertRulesState {
  /** The rules, in the API's order. */
  rules: AlertRule[];
  /** Whether a load is in flight. */
  isLoading: boolean;
  /** A load failure, in words. */
  error: string | null;
  /** Reloads now. */
  refresh: () => Promise<void>;
}

/**
 * The rules (`GET /admin/alerts/rules`), reloaded when a filter changes.
 *
 * @param query - optional filters.
 * @returns the rules and the load state.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useAlertRules(query: AlertRulesQuery = {}): AlertRulesState {
  const client = useAlertsApi();
  const { kind, severity, enabled } = query;
  const load = useCallback(
    () =>
      client.listRules({
        ...(kind ? { kind } : {}),
        ...(severity ? { severity } : {}),
        ...(enabled === undefined ? {} : { enabled }),
      }),
    [client, kind, severity, enabled],
  );
  const { data, isLoading, error, refresh } = useLoad(load, 'Could not load the alert rules.');
  return { rules: data ?? [], isLoading, error, refresh };
}

/**
 * What {@link useAlertRule} returns.
 *
 * @stability experimental
 */
export interface AlertRuleState {
  /** The rule, once loaded. */
  rule: AlertRule | null;
  /** Whether a load is in flight. */
  isLoading: boolean;
  /** A load failure, in words. */
  error: string | null;
  /** Reloads now. */
  refresh: () => Promise<void>;
}

/**
 * One rule (`GET /admin/alerts/rules/:id`).
 *
 * @param id - the rule id, or `null` for none.
 * @returns the rule and the load state.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useAlertRule(id: string | null): AlertRuleState {
  const client = useAlertsApi();
  const load = useMemo(() => (id ? () => client.getRule(id) : null), [client, id]);
  const { data, isLoading, error, refresh } = useLoad(load, 'Could not load the alert rule.');
  return { rule: data, isLoading, error, refresh };
}

/**
 * What {@link useAlertKinds} returns.
 *
 * @stability experimental
 */
export interface AlertKindsState {
  /** The registered kinds. */
  kinds: AlertKind[];
  /** Whether the load is in flight. */
  isLoading: boolean;
  /** A load failure, in words. */
  error: string | null;
}

/**
 * The registered rule kinds (`GET /admin/alerts/kinds`).
 *
 * @param options - `enabled: false` skips the request.
 * @returns the kinds and the load state.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useAlertKinds(options: { enabled?: boolean } = {}): AlertKindsState {
  const enabled = options.enabled ?? true;
  const client = useAlertsApi();
  const load = useMemo(() => (enabled ? () => client.listKinds() : null), [client, enabled]);
  const { data, isLoading, error } = useLoad(load, 'Could not load the rule kinds.');
  return { kinds: data ?? [], isLoading, error };
}

/**
 * What {@link useAlertIncidents} returns.
 *
 * @stability experimental
 */
export interface AlertIncidentsState {
  /** The page of incidents. */
  incidents: AlertIncident[];
  /** Incidents matching the filters, across every page. */
  total: number;
  /** Pages at the requested page size. */
  totalPages: number;
  /** Whether a load is in flight. */
  isLoading: boolean;
  /** A load failure, in words. */
  error: string | null;
  /** Reloads the current page now. */
  refresh: () => Promise<void>;
}

/**
 * One page of incidents (`GET /admin/alerts/incidents`), reloaded when the
 * page or a filter changes.
 *
 * @param query - the one-based page, the page size and the filters.
 * @returns the page and the load state.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useAlertIncidents(query: AlertIncidentsQuery = {}): AlertIncidentsState {
  const client = useAlertsApi();
  const { state, severity, ruleId, page, pageSize } = query;
  const load = useCallback(
    () =>
      client.listIncidents({
        ...(state ? { state } : {}),
        ...(severity ? { severity } : {}),
        ...(ruleId ? { ruleId } : {}),
        ...(page === undefined ? {} : { page }),
        ...(pageSize === undefined ? {} : { pageSize }),
      }),
    [client, state, severity, ruleId, page, pageSize],
  );
  const { data, isLoading, error, refresh } = useLoad(load, 'Could not load the incidents.');
  return {
    incidents: data?.items ?? [],
    total: data?.total ?? 0,
    totalPages: data?.totalPages ?? 0,
    isLoading,
    error,
    refresh,
  };
}

/**
 * What {@link useAlertIncident} returns.
 *
 * @stability experimental
 */
export interface AlertIncidentState {
  /** The incident, once loaded. */
  incident: AlertIncident | null;
  /** Whether a load is in flight. */
  isLoading: boolean;
  /** A load failure, in words. */
  error: string | null;
  /** Reloads now. */
  refresh: () => Promise<void>;
}

/**
 * One incident (`GET /admin/alerts/incidents/:id`).
 *
 * @param id - the incident id, or `null` for none.
 * @returns the incident and the load state.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useAlertIncident(id: string | null): AlertIncidentState {
  const client = useAlertsApi();
  const load = useMemo(() => (id ? () => client.getIncident(id) : null), [client, id]);
  const { data, isLoading, error, refresh } = useLoad(load, 'Could not load the incident.');
  return { incident: data, isLoading, error, refresh };
}

/**
 * What {@link useAlertSummary} returns.
 *
 * @stability experimental
 */
export interface AlertSummaryState {
  /** The firing counts, once loaded. */
  summary: AlertSummary | null;
  /** Whether a load is in flight. */
  isLoading: boolean;
  /** A load failure, in words. */
  error: string | null;
  /** Reloads now. */
  refresh: () => Promise<void>;
}

/**
 * The firing summary (`GET /admin/alerts/summary`), polled every 30 seconds
 * while the tab is visible.
 *
 * @param options - `enabled: false` skips the request (a viewer without
 *   `alerts:read`); `intervalMs` changes the poll (0 turns it off).
 * @returns the summary and the load state.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useAlertSummary(options: { enabled?: boolean; intervalMs?: number } = {}): AlertSummaryState {
  const enabled = options.enabled ?? true;
  const intervalMs = options.intervalMs ?? SUMMARY_POLL_MS;
  const client = useAlertsApi();
  const load = useMemo(() => (enabled ? () => client.summary() : null), [client, enabled]);
  const { data, isLoading, error, refresh } = useLoad(load, 'Could not load the alert summary.');
  useVisibleInterval(() => void refresh(), enabled ? intervalMs : 0);
  return { summary: data, isLoading, error, refresh };
}

/**
 * What {@link useAlertMetricCatalog} returns.
 *
 * @stability experimental
 */
export interface AlertMetricCatalogState {
  /** The metric tables and their attributes. */
  metrics: AlertMetricCatalogEntry[];
  /** Whether the load is in flight. */
  isLoading: boolean;
  /**
   * A load failure, in words (telemetry off, store unreachable, or no
   * `telemetry:query`). The picker then takes a typed name instead.
   */
  error: string | null;
}

/**
 * The metrics the rule editor offers (`GET /admin/telemetry/schema`).
 *
 * @param options - `enabled: false` skips the request.
 * @returns the metrics and the load state.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useAlertMetricCatalog(options: { enabled?: boolean } = {}): AlertMetricCatalogState {
  const enabled = options.enabled ?? true;
  const client = useAlertsApi();
  const load = useMemo(() => (enabled ? () => client.metricCatalog() : null), [client, enabled]);
  const { data, isLoading, error } = useLoad(load, 'The metric list is not available; type a metric name.');
  return { metrics: data ?? [], isLoading, error };
}

/**
 * What {@link useAlertMutations} returns. Each action resolves with the API's
 * answer, or `null` (`false`) when it refused (see `error`).
 *
 * @stability experimental
 */
export interface AlertMutations {
  /** `POST /admin/alerts/rules`. */
  create: (input: CreateAlertRule) => Promise<AlertRule | null>;
  /** `PATCH /admin/alerts/rules/:id`. */
  update: (id: string, patch: UpdateAlertRule) => Promise<AlertRule | null>;
  /** `PATCH /admin/alerts/rules/:id` with `{ enabled }`. */
  toggle: (id: string, enabled: boolean) => Promise<AlertRule | null>;
  /** `DELETE /admin/alerts/rules/:id`; resolves `true` on success. */
  remove: (id: string) => Promise<boolean>;
  /** `POST /admin/alerts/rules/:id/test`: the dry run's observations. */
  test: (id: string) => Promise<AlertRuleTestResponse | null>;
  /** `POST /admin/alerts/incidents/:id/acknowledge`. */
  acknowledge: (id: string) => Promise<AlertIncident | null>;
  /** Whether a write is in flight. */
  pending: boolean;
  /** The last refusal, in words. */
  error: string | null;
  /** Clears `error`. */
  reset: () => void;
}

/**
 * The alerts writes, with one shared pending flag and error.
 *
 * @returns the actions and their state.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useAlertMutations(): AlertMutations {
  const client = useAlertsApi();
  const mounted = useMounted();
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T,>(call: () => Promise<T>, fallback: string): Promise<T | null> => {
      setPendingCount((count) => count + 1);
      setError(null);
      try {
        return await call();
      } catch (err) {
        if (mounted()) setError(alertErrorMessage(err, fallback));
        return null;
      } finally {
        if (mounted()) setPendingCount((count) => count - 1);
      }
    },
    [mounted],
  );

  return {
    create: useCallback((input) => run(() => client.createRule(input), 'The rule could not be created.'), [client, run]),
    update: useCallback((id, patch) => run(() => client.updateRule(id, patch), 'The rule could not be saved.'), [client, run]),
    toggle: useCallback(
      (id, enabled) =>
        run(() => client.updateRule(id, { enabled }), enabled ? 'The rule could not be enabled.' : 'The rule could not be disabled.'),
      [client, run],
    ),
    remove: useCallback(
      async (id) => (await run(async () => (await client.deleteRule(id), true), 'The rule could not be deleted.')) === true,
      [client, run],
    ),
    test: useCallback((id) => run(() => client.testRule(id), 'The rule could not be tested.'), [client, run]),
    acknowledge: useCallback(
      (id) => run(() => client.acknowledge(id), 'The incident could not be acknowledged.'),
      [client, run],
    ),
    pending: pendingCount > 0,
    error,
    reset: useCallback(() => setError(null), []),
  };
}
