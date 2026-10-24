/**
 * The Telemetry services section's data — issue #567.
 *
 * Loads `GET /admin/telemetry/stack` and polls it: every `activeIntervalMs`
 * (3 s) while a deploy job is pending/running, else every `idleIntervalMs`
 * (30 s). Polling pauses with the tab (`useVisiblePolling`) and stops on
 * unmount. `deploy()` POSTs `/admin/telemetry/stack/deploy` and re-reads the
 * stack at once, so the progress indicator appears without waiting a tick.
 *
 * The browser never decides anything here: the API reports the containers and
 * the job, and runs the deployment as a queue job.
 *
 * Writes resolve `true`/`false` and never throw.
 */
import { useCallback, useEffect, useState } from 'react';
import { isPlatformApiError } from '../../../core/index.js';
import {
  type TelemetryStack,
  type TelemetryStackDeploy,
} from '../services/telemetry.js';
import { useTelemetryClient } from '../services/client.js';
import { useIsMounted } from '../../internal/useIsMounted.js';
import { useVisiblePolling } from '../../internal/useVisiblePolling.js';

/**
 * How often {@link useTelemetryStack} polls while a deploy is pending or running.
 *
 * @stability experimental
 */
export const TELEMETRY_STACK_ACTIVE_POLL_MS = 3_000;
/**
 * How often {@link useTelemetryStack} polls otherwise.
 *
 * @stability experimental
 */
export const TELEMETRY_STACK_IDLE_POLL_MS = 30_000;

/**
 * What {@link useTelemetryStack} takes.
 *
 * @stability experimental
 */
export interface UseTelemetryStackOptions {
  /** Poll interval while a deploy is active. Default {@link TELEMETRY_STACK_ACTIVE_POLL_MS}. */
  activeIntervalMs?: number;
  /** Poll interval otherwise. Default {@link TELEMETRY_STACK_IDLE_POLL_MS}. */
  idleIntervalMs?: number;
}

/**
 * What {@link useTelemetryStack} returns.
 *
 * @stability experimental
 */
export interface UseTelemetryStackReturn {
  /** The services and the latest deploy, or `null` before the first load. */
  stack: TelemetryStack | null;
  /** The first load is in flight. */
  isLoading: boolean;
  /** Why the stack could not be loaded, or `null`. */
  loadError: string | null;
  /** The deploy POST is in flight. */
  isRequesting: boolean;
  /** Why the last deploy request failed, or `null`. */
  deployError: string | null;
  /** A deploy is requested or its job is pending/running. */
  isDeploying: boolean;
  /** The job id the last successful POST returned, until the stack reports it settled. */
  requestedJobId: string | null;
  /** Load the stack again. */
  reload: () => Promise<void>;
  /** Ask the API to (re)deploy the telemetry services; resolves `true` when the job was enqueued. */
  deploy: () => Promise<boolean>;
}

/**
 * Whether a deploy job is still pending or running.
 *
 * @param deploy - the latest deploy job, if any.
 * @returns `true` while it is pending or running.
 *
 * @stability experimental
 */
export function isDeployActive(deploy: TelemetryStackDeploy | null | undefined): boolean {
  return deploy?.status === 'pending' || deploy?.status === 'running';
}

function message(err: unknown, fallback: string): string {
  return isPlatformApiError(err) || err instanceof Error ? err.message : fallback;
}

/**
 * The Telemetry services section's data: `GET /admin/telemetry/stack`, polled only while the tab is visible (faster while a deploy runs), and `POST …/stack/deploy` (a queue job runs it server-side).
 *
 * @param options - poll intervals; `0` disables polling.
 * @returns the stack and the deploy action.
 * @throws Error outside a `PlatformHostProvider`.
 *
 * @stability experimental
 */
export function useTelemetryStack(options: UseTelemetryStackOptions = {}): UseTelemetryStackReturn {
  const client = useTelemetryClient();
  const activeIntervalMs = options.activeIntervalMs ?? TELEMETRY_STACK_ACTIVE_POLL_MS;
  const idleIntervalMs = options.idleIntervalMs ?? TELEMETRY_STACK_IDLE_POLL_MS;

  const [stack, setStack] = useState<TelemetryStack | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [requestedJobId, setRequestedJobId] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const reload = useCallback(async () => {
    try {
      const next = await client.getTelemetryStack();
      if (!isMounted()) return;
      setStack(next);
      setLoadError(null);
    } catch (err) {
      if (isMounted()) setLoadError(message(err, 'Failed to load the telemetry services'));
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [client, isMounted]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // The requested job is tracked until the stack reports it settled — the
  // first GET after the POST can still describe the previous deploy.
  useEffect(() => {
    if (
      requestedJobId &&
      stack?.deploy?.jobId === requestedJobId &&
      !isDeployActive(stack.deploy)
    ) {
      setRequestedJobId(null);
    }
  }, [requestedJobId, stack]);

  const isDeploying = isRequesting || !!requestedJobId || isDeployActive(stack?.deploy);

  useVisiblePolling(() => void reload(), isDeploying ? activeIntervalMs : idleIntervalMs);

  const deploy = useCallback(async () => {
    setIsRequesting(true);
    setDeployError(null);
    try {
      const { jobId } = await client.deployTelemetryStack();
      if (isMounted()) setRequestedJobId(jobId);
      await reload();
      return true;
    } catch (err) {
      if (isMounted()) setDeployError(message(err, 'The deployment could not be started'));
      return false;
    } finally {
      if (isMounted()) setIsRequesting(false);
    }
  }, [client, isMounted, reload]);

  return {
    stack,
    isLoading,
    loadError,
    isRequesting,
    deployError,
    isDeploying,
    requestedJobId,
    reload,
    deploy,
  };
}
