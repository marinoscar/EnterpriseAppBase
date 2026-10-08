/**
 * The deployment-wide settings document, bound to this app (#733).
 *
 * The hook is the settings slice's (`useSystemSettings` of
 * `@marinoscar/platform-web/settings/headless`); this binding supplies the
 * app's document type (`SystemSettings`, every namespace this app registers)
 * and its transport (`appPlatformApi`, so the hook also works outside the
 * platform host provider, as the hook's tests render it).
 */
import { useSystemSettings as usePlatformSystemSettings } from '@marinoscar/platform-web/settings/headless';
import type { UseSystemSettingsResult } from '@marinoscar/platform-web/settings/headless';

import { appPlatformApi } from '../platform/platformHost';
import type { SystemSettings } from '../types';

const OPTIONS = { api: appPlatformApi };

export function useSystemSettings(): UseSystemSettingsResult<SystemSettings> {
  return usePlatformSystemSettings<SystemSettings>(OPTIONS);
}
