/**
 * The deployment's open capability and operation vocabularies
 * (`GET /api/admin/ai/capabilities`, `ai_config:read`) — PP-14.17, issue #935.
 *
 * The admin Models page draws its capability filter and the override dialog's
 * checkboxes from it, so a capability an app registered (`registerAiCapability`
 * on the API) appears with its label and no web change. Fetched once per mount;
 * the vocabularies are static for the life of the API process.
 *
 * It also records the labels (`registerAiCapabilityLabels`), so every chip on
 * the page reads them. A failure is not an error state worth blocking on: the
 * built-in capabilities are known without the API, and an app capability is
 * drawn as its id until the labels arrive.
 */
import { useEffect, useState } from 'react';
import { isPlatformApiError } from '../../core/index.js';
import { registerAiCapabilityLabels } from './capability-labels.js';
import { getAiCapabilities } from './client.js';
import type { AiCapabilitiesResponse } from './types.js';
import { useIsMounted } from '../internal/use-is-mounted.js';
import { useAiApi } from './use-ai-api.js';
import type { AiHookOptions } from './use-ai-api.js';

/**
 * What `useAiCapabilities` returns.
 *
 * @stability experimental
 */
export interface UseAiCapabilitiesReturn extends AiCapabilitiesResponse {
  /** Whether the first fetch is in flight. */
  isLoading: boolean;
  /** Why the fetch failed, or `null`. */
  error: string | null;
}

/**
 * The capability and operation vocabularies the API serves.
 *
 * @param options - the transport.
 * @returns both lists (empty until loaded), loading and error state.
 *
 * @stability experimental
 */
export function useAiCapabilities(options: AiHookOptions = {}): UseAiCapabilitiesReturn {
  const api = useAiApi(options.api);
  const isMounted = useIsMounted();
  const [state, setState] = useState<UseAiCapabilitiesReturn>({
    capabilities: [],
    operations: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    getAiCapabilities(api)
      .then((data) => {
        registerAiCapabilityLabels(data.capabilities);
        if (!cancelled && isMounted()) setState({ ...data, isLoading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled || !isMounted()) return;
        setState({
          capabilities: [],
          operations: [],
          isLoading: false,
          error: isPlatformApiError(err) ? err.message : 'Failed to load the AI capabilities',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [api, isMounted]);

  return state;
}
