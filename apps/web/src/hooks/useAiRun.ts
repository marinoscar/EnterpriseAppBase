/**
 * One background AI run: start, poll until it settles, cancel — issue #434,
 * epic #419.
 *
 * `POST /ai/runs` enqueues the request as a queue job (CLAUDE.md: every
 * long-running activity is a queue job) and answers 202 with a run id; this
 * hook then reads `GET /ai/runs/:id` every `intervalMs` (2 s by default)
 * until the run is `succeeded`, `failed` or `cancelled`, and stops.
 *
 * POLLING IS A TIMEOUT CHAIN, NOT AN INTERVAL: the next read is scheduled
 * only after the previous one answered, so a slow API can never stack
 * overlapping requests. A failed read stops polling and surfaces the error —
 * a run the caller cannot read (404: not theirs, or gone) will not start
 * answering on its own.
 *
 * `onSettled` fires exactly once per run, when it reaches a terminal state.
 *
 * ANY RUN, NOT ONLY TEXT (#445). `start` queues a text response; `startWith`
 * takes whichever call created the run — `POST /ai/images`,
 * `POST /ai/images/edits`, and the media routes after them all answer the
 * same 202 `{ runId, jobId }` and settle through the same `GET /ai/runs/:id`.
 * Narrow the settled `output` with `isAiResponseRunOutput` /
 * `isAiImageRunOutput`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelAiRun,
  createAiRun,
  getAiRun,
  type AiResponseRequest,
  type AiRun,
  type AiRunStarted,
  type AiRunStatus,
} from '../services/ai';
import { toAiErrorInfo, type AiErrorInfo } from '../services/aiErrors';
import { useIsMounted } from './useIsMounted';

export const AI_RUN_POLL_INTERVAL_MS = 2000;

const TERMINAL: readonly AiRunStatus[] = ['succeeded', 'failed', 'cancelled'];

export function isAiRunTerminal(status: AiRunStatus): boolean {
  return TERMINAL.includes(status);
}

export interface UseAiRunOptions {
  intervalMs?: number;
  onSettled?: (run: AiRun) => void;
}

export interface UseAiRunReturn {
  /** The latest known state of the run, or `null` before the first read. */
  run: AiRun | null;
  runId: string | null;
  /** True from `start()` until the run settles (or cannot be read). */
  isActive: boolean;
  isStarting: boolean;
  isCancelling: boolean;
  error: AiErrorInfo | null;
  /** Start a text run; resolves to its id, or `null` when the API refused it. */
  start: (request: AiResponseRequest) => Promise<string | null>;
  /**
   * Start a run through any call that answers 202 `{ runId, jobId }` (an image
   * generation, say) and poll it like `start`. Resolves to its id, or `null`
   * when the call threw.
   */
  startWith: (create: () => Promise<AiRunStarted>) => Promise<string | null>;
  cancel: () => Promise<void>;
  /** Forget the run (stops polling; does NOT cancel it server-side). */
  clear: () => void;
}

export function useAiRun(options: UseAiRunOptions = {}): UseAiRunReturn {
  const { intervalMs = AI_RUN_POLL_INTERVAL_MS, onSettled } = options;
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<AiRun | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<AiErrorInfo | null>(null);
  const [polling, setPolling] = useState(false);
  const isMounted = useIsMounted();

  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const settledRef = useRef<string | null>(null);

  const accept = useCallback(
    (next: AiRun) => {
      if (!isMounted()) return;
      setRun(next);
      if (isAiRunTerminal(next.status)) {
        setPolling(false);
        if (settledRef.current !== next.id) {
          settledRef.current = next.id;
          onSettledRef.current?.(next);
        }
      }
    },
    [isMounted],
  );

  useEffect(() => {
    if (!runId || !polling) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const next = await getAiRun(runId);
        if (cancelled) return;
        accept(next);
        if (!isAiRunTerminal(next.status)) timer = setTimeout(poll, intervalMs);
      } catch (err) {
        if (cancelled || !isMounted()) return;
        setError(toAiErrorInfo(err, 'Could not read the background run'));
        setPolling(false);
      }
    };

    timer = setTimeout(poll, intervalMs);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [runId, polling, intervalMs, accept, isMounted]);

  const startWith = useCallback(
    async (create: () => Promise<AiRunStarted>) => {
      setIsStarting(true);
      setError(null);
      setRun(null);
      setRunId(null);
      setPolling(false);
      try {
        const started = await create();
        if (!isMounted()) return started.runId;
        setRunId(started.runId);
        setPolling(true);
        return started.runId;
      } catch (err) {
        if (isMounted()) setError(toAiErrorInfo(err, 'Could not start the background run'));
        return null;
      } finally {
        if (isMounted()) setIsStarting(false);
      }
    },
    [isMounted],
  );

  const start = useCallback((request: AiResponseRequest) => startWith(() => createAiRun(request)), [startWith]);

  const cancel = useCallback(async () => {
    if (!runId) return;
    setIsCancelling(true);
    try {
      const next = await cancelAiRun(runId);
      accept(next);
    } catch (err) {
      if (isMounted()) setError(toAiErrorInfo(err, 'Could not cancel the background run'));
    } finally {
      if (isMounted()) setIsCancelling(false);
    }
  }, [runId, accept, isMounted]);

  const clear = useCallback(() => {
    setRunId(null);
    setRun(null);
    setError(null);
    setPolling(false);
  }, []);

  const isActive = isStarting || polling;

  return { run, runId, isActive, isStarting, isCancelling, error, start, startWith, cancel, clear };
}
