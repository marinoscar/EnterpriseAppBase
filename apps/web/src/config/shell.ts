/**
 * This app's binding of the packaged app shell (`@marinoscar/platform-web/shell`,
 * issue #868): the ONE navigation object every shell surface reads.
 *
 *   - `destinations` / `destinationRoutes`: the destination model
 *     (`config/destinations.ts`), so the rail, the bottom bar and the user menu
 *     draw the same table with the same gates;
 *   - `settingsSurfaces`: what the compact AppBar drills into, in resolution
 *     order (admin first, as #95 declared it). Adding a third settings surface
 *     is adding a row here;
 *   - `console`: the rail's Console mode on `/admin/*` (#94), listing
 *     `ADMIN_SECTIONS` with the same permission and feature filter the hub uses;
 *   - `useRailPreference`: `hooks/useNavigationPrefs` (the `navigation`
 *     user-settings namespace through this app's transport).
 *
 * The feature map the surfaces read is `useSettingsFeatures()` of the settings
 * slice; importing `hooks/useSettingsFeatures` registers this app's resolvers
 * (`ai`, `telemetry`, `orgs`) before any shell surface renders.
 */
import type { ShellNavigation } from '@marinoscar/platform-web/shell/headless';

import '../hooks/useSettingsFeatures';
import { useNavigationPrefs } from '../hooks/useNavigationPrefs';
import { ADMIN_HUB_PATH, ADMIN_HUB_TITLE, ADMIN_SECTIONS } from './adminSections';
import { DESTINATIONS, DESTINATION_ROUTES } from './destinations';
import type { DestinationKey } from './destinations';
import { USER_HUB_PATH, USER_HUB_TITLE, USER_SETTINGS_SECTIONS } from './userSettingsSections';

export const APP_NAVIGATION: ShellNavigation<DestinationKey> = {
  destinations: DESTINATIONS,
  destinationRoutes: DESTINATION_ROUTES,
  settingsSurfaces: [
    { sections: ADMIN_SECTIONS, hubPath: ADMIN_HUB_PATH, hubTitle: ADMIN_HUB_TITLE },
    { sections: USER_SETTINGS_SECTIONS, hubPath: USER_HUB_PATH, hubTitle: USER_HUB_TITLE },
  ],
  console: { prefix: '/admin', sections: ADMIN_SECTIONS },
  useRailPreference: useNavigationPrefs,
};
