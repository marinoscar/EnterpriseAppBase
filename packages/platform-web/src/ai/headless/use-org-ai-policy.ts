// The organization's EFFECTIVE AI policy (issue #739), read-only: the `ai`
// value of `GET /api/org-settings`' `effective` map, i.e. the deployment's
// policy tightened by the organization's own overrides.

import type { SystemAiValue } from '@marinoscar/platform-contract/ai';
import { useEffect, useState } from 'react';

import { useOptionalPlatformHost } from '../../core/index.js';
import type { PlatformApiClient } from '../../core/index.js';

/**
 * Options of {@link useOrgAiPolicy}.
 *
 * @stability experimental
 */
export interface UseOrgAiPolicyOptions {
  /** The transport. Default: the `PlatformHostProvider`'s. */
  api?: PlatformApiClient;
}

/**
 * What {@link useOrgAiPolicy} returns.
 *
 * @stability experimental
 */
export interface UseOrgAiPolicyResult {
  /** The effective policy, `null` while loading or when the caller may not read it. */
  policy: SystemAiValue | null;
  /** True while loading. */
  isLoading: boolean;
  /** True when the read failed (no org layer, or no `org_ai_config:read`). */
  unavailable: boolean;
}

/**
 * The active organization's effective `ai` policy, from `GET /api/org-settings`.
 *
 * @param options - the transport.
 *
 * @stability experimental
 */
export function useOrgAiPolicy(options: UseOrgAiPolicyOptions = {}): UseOrgAiPolicyResult {
  const host = useOptionalPlatformHost();
  const api = options.api ?? host?.api;
  const [state, setState] = useState<UseOrgAiPolicyResult>({ policy: null, isLoading: true, unavailable: false });

  useEffect(() => {
    let alive = true;
    if (!api) {
      setState({ policy: null, isLoading: false, unavailable: true });
      return undefined;
    }
    api
      .get<{ effective?: Record<string, unknown> }>('/org-settings')
      .then((response) => {
        if (!alive) return;
        const policy = (response.effective?.ai as SystemAiValue | undefined) ?? null;
        setState({ policy, isLoading: false, unavailable: policy === null });
      })
      .catch(() => {
        if (alive) setState({ policy: null, isLoading: false, unavailable: true });
      });
    return () => {
      alive = false;
    };
  }, [api]);

  return state;
}
