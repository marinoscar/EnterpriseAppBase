/**
 * The deployment record — issue #392, epic #388.
 *
 * One hook, one read, no writes: nothing about a deployment is settable from a
 * browser, so this module has no `save` and no action group. It follows the
 * house contract the surrounding hooks state (`useStorageConfig`,
 * `useMaintenance`, `useDbBackup`): an error is a STRING the page renders
 * rather than an exception a component has to catch, and every `setState` past
 * an `await` is guarded by `useIsMounted()`.
 *
 * =============================================================================
 * ⚠ "NOT CONFIGURED" IS NOT A LOAD FAILURE, AND THIS HOOK NEVER CONFLATES THEM
 * =============================================================================
 *
 * `GET /api/admin/deployment` ALWAYS answers 200. A deployment with no state
 * file comes back as `configured: false` with a `source.reason`, which is data
 * — it lands in `deployment` like any other successful response and the page
 * draws its explanatory panel. `loadError` is set only when the request itself
 * failed: a 403 from a session that lost the permission, a 500, a dropped
 * connection.
 *
 * Getting that backwards is the one thing that would make this page useless:
 * an administrator opening it on a development stack would be told the page is
 * broken, and would go looking for a fault that does not exist.
 *
 * =============================================================================
 * NO POLLING, DELIBERATELY
 * =============================================================================
 *
 * `JobsPage`, `WorkersPage` and `DbBackupPage` all poll, because what they show
 * moves with nobody touching it. A deployment record changes when somebody runs
 * `appctl deploy` on the server — minutes of work, days or weeks apart — and a
 * timer over a file that changes monthly is load with no information in it. The
 * page offers an explicit refresh instead, which is also the honest affordance:
 * it says "re-read it now" rather than implying the screen is live.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../services/api';
import { getDeployment } from '../services/deployment';
import type { DeploymentResponse } from '../services/deployment';
import { useIsMounted } from './useIsMounted';

/**
 * 403 is named explicitly because its remedy is a permission rather than a
 * retry — the treatment `useDbBackup`, `useWorkerNodes` and `useStorageConfig`
 * all give it. The sentence names `deployment:read` rather than "settings",
 * because the API reserves a permission of its own for this surface and
 * telling an administrator to ask for the wrong one is worse than telling them
 * nothing.
 */
function messageFor(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 403) {
      return 'You do not have permission to view this deployment’s record';
    }
    // The API's own sentence wins; `fallback` covers a body with no message at
    // all, which is what a proxy-generated error looks like.
    return err.message || fallback;
  }
  return fallback;
}

export interface UseDeploymentReturn {
  /** The whole response, INCLUDING an unconfigured one. `null` before the first successful read. */
  deployment: DeploymentResponse | null;
  isLoading: boolean;
  /**
   * Failure to LOAD, and nothing else. `configured: false` is a successful
   * read — see the file header for why that distinction is the point.
   */
  loadError: string | null;
  refresh: () => Promise<void>;
}

export function useDeployment(): UseDeploymentReturn {
  const [deployment, setDeployment] = useState<DeploymentResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const isMounted = useIsMounted();

  const fetchDeployment = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const data = await getDeployment();
      if (isMounted()) setDeployment(data);
    } catch (err) {
      if (isMounted()) {
        setLoadError(messageFor(err, 'Failed to load the deployment record'));
        // The previous answer is DROPPED rather than left on screen. A record
        // that could not be re-read is a record nobody can vouch for, and a
        // deploy that happened since would make the stale one actively wrong.
        setDeployment(null);
      }
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [isMounted]);

  useEffect(() => {
    void fetchDeployment();
  }, [fetchDeployment]);

  return { deployment, isLoading, loadError, refresh: fetchDeployment };
}
