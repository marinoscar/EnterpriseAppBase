/**
 * The GreptimeDB connection section's data — issue #558, epic #528.
 *
 * Loads `GET /admin/telemetry/connection`; saves (`PUT`) and reverts
 * (`DELETE`) with `If-Match: <the connection's version>` — its own counter,
 * not `/config`'s. A stale version answers 409, surfaced as `conflict` so the
 * page can offer a reload. `test` probes a candidate connection: the route
 * always answers 200 with a diagnosis, so a refused login lands in
 * `testResult`, and only a failed CALL lands in `testError`.
 *
 * Writes resolve `true`/`false` and never throw.
 */
import { useCallback, useEffect, useState } from 'react';
import { isPlatformApiError } from '../../../core/index.js';
import {
  type TelemetryConnection,
  type TelemetryConnectionInput,
  type TelemetryConnectionTestResult,
} from '../services/telemetry.js';
import { useTelemetryClient } from '../services/client.js';
import { useIsMounted } from '../../internal/useIsMounted.js';

/**
 * What {@link useTelemetryConnection} returns.
 *
 * @stability experimental
 */
export interface UseTelemetryConnectionReturn {
  /** The connection in force, or `null` before the first load. */
  connection: TelemetryConnection | null;
  /** A (re)load is in flight. */
  isLoading: boolean;
  /** Why the connection could not be loaded, or `null`. */
  loadError: string | null;
  /** A save or revert is in flight. */
  isSaving: boolean;
  /** Why the last save or revert failed (other than a 409), or `null`. */
  saveError: string | null;
  /** True after a write was refused with 409 — someone else changed it first. */
  conflict: boolean;
  /** A connection test is in flight. */
  isTesting: boolean;
  /** The last test's diagnosis, or `null`. */
  testResult: TelemetryConnectionTestResult | null;
  /** Why the last test could not be run, or `null`. */
  testError: string | null;
  /** Load the connection again. */
  reload: () => Promise<void>;
  /** Store a connection; resolves `true` on success. */
  save: (input: TelemetryConnectionInput) => Promise<boolean>;
  /** Forget the stored connection (the deployment default is in force again); resolves `true` on success. */
  revert: () => Promise<boolean>;
  /** Test a candidate connection without storing it. */
  test: (input: TelemetryConnectionInput) => Promise<void>;
  /** Forget the last test's result and error. */
  clearTestResult: () => void;
}

function message(err: unknown, fallback: string): string {
  return isPlatformApiError(err) || err instanceof Error ? err.message : fallback;
}

/**
 * The GreptimeDB connection section's data: `GET`, `PUT` and `DELETE /admin/telemetry/connection` (with `If-Match`; a 409 sets `conflict`) and `POST …/connection/test`. Passwords are write-only: they are sent, never read back.
 *
 * @returns the connection and its actions.
 * @throws Error outside a `PlatformHostProvider`.
 *
 * @stability experimental
 */
export function useTelemetryConnection(): UseTelemetryConnectionReturn {
  const client = useTelemetryClient();
  const [connection, setConnection] = useState<TelemetryConnection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TelemetryConnectionTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const reload = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    setSaveError(null);
    setConflict(false);
    try {
      const next = await client.getTelemetryConnection();
      if (isMounted()) setConnection(next);
    } catch (err) {
      if (isMounted()) setLoadError(message(err, 'Failed to load the telemetry connection'));
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [client, isMounted]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const write = useCallback(
    async (run: () => Promise<TelemetryConnection>, fallback: string) => {
      setIsSaving(true);
      setSaveError(null);
      setConflict(false);
      try {
        const next = await run();
        if (isMounted()) {
          setConnection(next);
          setTestResult(null);
          setTestError(null);
        }
        return true;
      } catch (err) {
        if (isMounted()) {
          if (isPlatformApiError(err) && err.status === 409) {
            setConflict(true);
          } else {
            setSaveError(message(err, fallback));
          }
        }
        return false;
      } finally {
        if (isMounted()) setIsSaving(false);
      }
    },
    [isMounted],
  );

  const version = connection?.version;

  const save = useCallback(
    (input: TelemetryConnectionInput) =>
      write(
        () => client.updateTelemetryConnection(input, version),
        'Failed to save the telemetry connection',
      ),
    [client, write, version],
  );

  const revert = useCallback(
    () =>
      write(
        () => client.resetTelemetryConnection(version),
        'Failed to revert the telemetry connection',
      ),
    [client, write, version],
  );

  const test = useCallback(
    async (input: TelemetryConnectionInput) => {
      setIsTesting(true);
      setTestResult(null);
      setTestError(null);
      try {
        const result = await client.testTelemetryConnection(input);
        if (isMounted()) setTestResult(result);
      } catch (err) {
        if (isMounted()) setTestError(message(err, 'The connection test could not be run'));
      } finally {
        if (isMounted()) setIsTesting(false);
      }
    },
    [client, isMounted],
  );

  const clearTestResult = useCallback(() => {
    setTestResult(null);
    setTestError(null);
  }, []);

  return {
    connection,
    isLoading,
    loadError,
    isSaving,
    saveError,
    conflict,
    isTesting,
    testResult,
    testError,
    reload,
    save,
    revert,
    test,
    clearTestResult,
  };
}
