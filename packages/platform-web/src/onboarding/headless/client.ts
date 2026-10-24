import {
  ONBOARDING_METRICS_PATH,
  ONBOARDING_PATH,
  ONBOARDING_SETTINGS_KEY,
} from '@marinoscar/platform-contract/onboarding';
import type { OnboardingMetricsResponse, OnboardingResponse } from '@marinoscar/platform-contract/onboarding';

import { isPlatformApiError } from '../../core/index.js';
import type { PlatformApiClient } from '../../core/index.js';

/**
 * A write to the stored `onboarding` namespace: platform fields and any field
 * the app added with `extendOnboardingSettings`. `null` clears a field.
 *
 * @stability experimental
 */
export type OnboardingSettingsWrite = Readonly<Record<string, unknown>>;

/**
 * The onboarding API calls.
 *
 * @stability experimental
 */
export interface OnboardingClient {
  /** `GET /onboarding`; `refresh: true` re-runs the Doctor probes behind the admin steps. */
  get(options?: { refresh?: boolean }): Promise<OnboardingResponse>;
  /** `GET /admin/onboarding/metrics?days=`. */
  metrics(days: number): Promise<OnboardingMetricsResponse>;
  /**
   * Writes the stored state through `PATCH /user-settings` with `If-Match`
   * (the current version, read first), retrying once on a `409`.
   */
  write(patch: OnboardingSettingsWrite): Promise<void>;
}

/**
 * The onboarding client over the app's transport.
 *
 * @param api - the app's transport (`usePlatformApi()`).
 * @returns the client.
 *
 * @example
 * ```ts
 * const client = createOnboardingClient(usePlatformApi());
 * await client.write({ welcomeSeenAt: new Date().toISOString() });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function createOnboardingClient(api: PlatformApiClient): OnboardingClient {
  const patchOnce = async (patch: OnboardingSettingsWrite) => {
    const current = await api.get<{ version: number }>('/user-settings');
    await api.patch('/user-settings', { [ONBOARDING_SETTINGS_KEY]: patch }, { ifMatch: String(current.version) });
  };

  return {
    get(options = {}) {
      return api.get<OnboardingResponse>(options.refresh ? `${ONBOARDING_PATH}?refresh=true` : ONBOARDING_PATH);
    },
    metrics(days) {
      return api.get<OnboardingMetricsResponse>(`${ONBOARDING_METRICS_PATH}?days=${encodeURIComponent(String(days))}`);
    },
    async write(patch) {
      try {
        await patchOnce(patch);
      } catch (error) {
        if (isPlatformApiError(error) && error.status === 409) {
          await patchOnce(patch);
          return;
        }
        throw error;
      }
    },
  };
}
