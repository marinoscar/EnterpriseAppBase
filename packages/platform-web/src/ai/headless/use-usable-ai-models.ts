/**
 * The models the caller can actually call right now (`GET /api/ai/models`) —
 * issue #430, epic #419.
 *
 * "Usable" is decided entirely server-side: admin-enabled ∩ reachable with the
 * caller's key, or every enabled model when the organisation's key covers the
 * provider (`keySource: 'org'`). This hook only fetches it; the page calls
 * `refresh` after anything that can change it (saving, testing or removing a
 * key).
 */
import { useCallback, useEffect, useState } from 'react';
import { isPlatformApiError } from '../../core/index.js';
import { type UsableAiModel } from './types.js';
import { listUsableAiModels } from './client.js';
import { useIsMounted } from '../internal/use-is-mounted.js';
import { useAiApi } from './use-ai-api.js';
import type { AiHookOptions } from './use-ai-api.js';

/**
 * The use usable AI models return wire shape.
 *
 * @stability experimental
 */
export interface UseUsableAiModelsReturn {
  /** The models. */
  models: UsableAiModel[];
  /** Whether loading. */
  isLoading: boolean;
  /** The error. */
  error: string | null;
  /** The refresh. */
  refresh: () => Promise<void>;
}

/**
 * Use usable AI models.
 *
 * @stability experimental
 */
export function useUsableAiModels(options: AiHookOptions = {}): UseUsableAiModelsReturn {
  const api = useAiApi(options.api);
  const [models, setModels] = useState<UsableAiModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await listUsableAiModels(api);
      if (isMounted()) setModels(data);
    } catch (err) {
      if (isMounted()) {
        setError(isPlatformApiError(err) ? err.message : 'Failed to load available models');
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { models, isLoading, error, refresh };
}
