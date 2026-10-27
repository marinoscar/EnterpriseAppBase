/**
 * The Telemetry Explorer's data — issue #537, epic #528.
 *
 * - `useTelemetrySchema`: `GET /admin/telemetry/schema`, once on mount.
 * - `useTelemetryQuery`: `POST /admin/telemetry/query` with cancel. A newer
 *   run aborts the one in flight; an aborted run leaves the previous result
 *   on screen and reports nothing.
 *
 * Whether a statement is allowed is the API's decision (its SQL guard); the
 * browser sends the text verbatim and shows the refusal's message and code.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isPlatformApiError } from '../../../core/index.js';
import type { PlatformApiError } from '../../../core/index.js';
import {
  telemetryErrorReason,
  type TelemetryQueryResult,
  type TelemetrySchemaTable,
} from '../services/telemetry.js';
import { useTelemetryClient } from '../services/client.js';
import { useIsMounted } from '../../internal/useIsMounted.js';

/**
 * A failed telemetry call, as the pages show it: the message plus the envelope code, `details.reason`, the status and the query-specific details.
 *
 * @stability experimental
 */
export interface TelemetryErrorInfo {
  /** What to show. */
  message: string;
  /** The envelope `code` — derived from the HTTP status. */
  code: string | null;
  /** `details.reason` — the telemetry-specific reason (`TELEMETRY_QUERY_REJECTED`, …). */
  reason: string | null;
  /** The HTTP status, or `null` for a network failure. */
  status: number | null;
  /** `details.sqlState` for `TELEMETRY_QUERY_FAILED`. */
  sqlState: string | null;
  /** `details.timeoutMs` for `TELEMETRY_QUERY_TIMEOUT`. */
  timeoutMs: number | null;
}

function detail<T>(err: PlatformApiError, key: string, kind: 'string' | 'number'): T | null {
  const details = err.details;
  if (typeof details !== 'object' || details === null) return null;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === kind ? (value as T) : null;
}

/**
 * A rejection as a {@link TelemetryErrorInfo}: a `PlatformApiError`'s status, code and details, or any other error's message.
 *
 * @param err - whatever a {@link TelemetryClient} call rejected with.
 * @param fallback - the message when `err` carries none.
 * @returns the error as the pages show it.
 *
 * @stability experimental
 */
export function toTelemetryError(err: unknown, fallback: string): TelemetryErrorInfo {
  if (isPlatformApiError(err)) {
    return {
      message: err.message || fallback,
      code: err.code ?? null,
      reason: telemetryErrorReason(err),
      status: err.status,
      sqlState: detail<string>(err, 'sqlState', 'string'),
      timeoutMs: detail<number>(err, 'timeoutMs', 'number'),
    };
  }
  return {
    message: err instanceof Error ? err.message : fallback,
    code: null,
    reason: null,
    status: null,
    sqlState: null,
    timeoutMs: null,
  };
}

/**
 * A short human heading for a telemetry error, branching on `details.reason`.
 *
 * @stability experimental
 */
export function telemetryErrorTitle(error: TelemetryErrorInfo): string {
  switch (error.reason) {
    case 'TELEMETRY_QUERY_REJECTED':
      return 'Query not allowed';
    case 'TELEMETRY_QUERY_FAILED':
      return error.sqlState ? `Query failed (SQLSTATE ${error.sqlState})` : 'Query failed';
    case 'TELEMETRY_QUERY_TIMEOUT':
      return error.timeoutMs !== null
        ? `Query timed out after ${Math.round(error.timeoutMs / 1000)} s`
        : 'Query timed out';
    case 'TELEMETRY_DISABLED':
      return 'Telemetry is switched off';
    case 'TELEMETRY_NOT_CONFIGURED':
      return 'Telemetry store not configured';
    case 'TELEMETRY_UNREACHABLE':
      return 'Telemetry store unreachable';
    case 'TELEMETRY_ASSISTANT_DISABLED':
      return 'Assistant is switched off';
    default:
      return 'Request failed';
  }
}

function isAbort(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

/**
 * What {@link useTelemetrySchema} returns.
 *
 * @stability experimental
 */
export interface UseTelemetrySchemaReturn {
  /** The tables the reader login may query (empty until loaded). */
  tables: TelemetrySchemaTable[];
  /** A (re)load is in flight. */
  isLoading: boolean;
  /** Why the schema could not be loaded, or `null`. */
  error: string | null;
  /** Load the schema again. */
  reload: () => Promise<void>;
}

/**
 * `GET /admin/telemetry/schema`, once on mount: the tables the explorer's schema panel and editor completion read.
 *
 * @returns `tables`, `isLoading`, `error` (a message or `null`) and `reload`.
 * @throws Error outside a `PlatformHostProvider`.
 *
 * @stability experimental
 */
export function useTelemetrySchema(): UseTelemetrySchemaReturn {
  const client = useTelemetryClient();
  const [tables, setTables] = useState<TelemetrySchemaTable[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const schema = await client.getTelemetrySchema();
      if (isMounted()) setTables(schema.tables);
    } catch (err) {
      if (isMounted()) setError(toTelemetryError(err, 'Failed to load the schema').message);
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [client, isMounted]);

  useEffect(() => {
    void load();
  }, [load]);

  return { tables, isLoading, error, reload: load };
}

/**
 * What {@link useTelemetryQuery} returns.
 *
 * @stability experimental
 */
export interface UseTelemetryQueryReturn {
  /** The last result, or `null` before the first. */
  result: TelemetryQueryResult | null;
  /** The last run's error, or `null`. */
  error: TelemetryErrorInfo | null;
  /** A run is in flight. */
  isRunning: boolean;
  /** Resolves `true` when a result arrived. */
  run: (sql: string) => Promise<boolean>;
  /** Abort the run in flight. */
  cancel: () => void;
}

/**
 * `POST /admin/telemetry/query` with cancel. A newer run aborts the one in flight; an aborted run leaves the previous result on screen and reports nothing. Whether a statement is allowed is the API's decision.
 *
 * @returns the result, the error and the run and cancel actions.
 * @throws Error outside a `PlatformHostProvider`.
 *
 * @stability experimental
 */
export function useTelemetryQuery(): UseTelemetryQueryReturn {
  const client = useTelemetryClient();
  const [result, setResult] = useState<TelemetryQueryResult | null>(null);
  const [error, setError] = useState<TelemetryErrorInfo | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const isMounted = useIsMounted();

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    if (isMounted()) setIsRunning(false);
  }, [client, isMounted]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = useCallback(
    async (sql: string) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setIsRunning(true);
      setError(null);
      try {
        const next = await client.runTelemetryQuery(sql, { signal: controller.signal });
        if (!isMounted() || controller.signal.aborted) return false;
        setResult(next);
        return true;
      } catch (err) {
        if (isAbort(err) || controller.signal.aborted) return false;
        if (isMounted()) setError(toTelemetryError(err, 'The query failed'));
        return false;
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          if (isMounted()) setIsRunning(false);
        }
      }
    },
    [isMounted],
  );

  return { result, error, isRunning, run, cancel };
}

/**
 * The assistant's configured provider and model, as a caption — read from the
 * admin config, so only fetched for a holder of `telemetry:read` (`enabled`).
 * Best effort: any failure just means no caption.
 *
 * @stability experimental
 */
export function useTelemetryAssistantModel(enabled: boolean): string | null {
  const client = useTelemetryClient();
  const [caption, setCaption] = useState<string | null>(null);
  const isMounted = useIsMounted();

  useEffect(() => {
    if (!enabled) return;
    client.getTelemetryAdminConfig()
      .then((config) => {
        const { provider, modelId } = config.assistant;
        if (isMounted() && provider && modelId) setCaption(`${provider} · ${modelId}`);
      })
      .catch(() => {
        // No caption.
      });
  }, [client, enabled, isMounted]);

  return caption;
}
