// The slice's read-hook core: load on mount and whenever `key` changes, abort
// the superseded request, keep the previous data while a refresh runs, and
// never set state after unmount. Not exported; every `use*` read hook of
// `sharing/headless` is a thin binding over it.

import { useCallback, useEffect, useRef, useState } from 'react';

import { toSharingError } from '../headless/errors.js';
import type { SharingError, SharingResource } from '../headless/types.js';
import { useIsMounted } from './use-is-mounted.js';

export function useAsyncResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  key: string,
  options: { enabled?: boolean; fallbackMessage?: string } = {},
): SharingResource<T> {
  const enabled = options.enabled ?? true;
  const fallback = options.fallbackMessage ?? 'Could not load this. Try again.';
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<SharingError | null>(null);
  const isMounted = useIsMounted();
  const loadRef = useRef(load);
  loadRef.current = load;
  const controllerRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    try {
      const value = await loadRef.current(controller.signal);
      if (!isMounted() || controller.signal.aborted) return;
      setData(value);
      setError(null);
    } catch (err) {
      if (!isMounted() || controller.signal.aborted) return;
      setError(toSharingError(err, fallback));
    } finally {
      if (isMounted() && controllerRef.current === controller) setLoading(false);
    }
  }, [isMounted, fallback]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    void run();
    return () => controllerRef.current?.abort();
    // `key` stands for everything `load` closes over (read through a ref).
  }, [enabled, key, run]);

  const refresh = useCallback(() => (enabled ? run() : Promise.resolve()), [enabled, run]);

  return { data, loading, error, refresh };
}
