// =============================================================================
// User settings namespace manifest (issue #677)
// =============================================================================
//
// The explicit, grep-able list of the OPTIONAL user settings namespaces.
// Registers every platform declaration IN TODAY'S KEY ORDER (dataTables,
// navigation, notifications, ai), then the app-owned file. Order is the key
// order of every composed user-settings schema and of the OpenAPI document
// (pinned by `test/settings/settings-catalog.spec.ts`). Append a new platform
// namespace; never insert one between existing entries.
//
// Imported for its side effect by `composed.ts`, never by a declaration file.
// =============================================================================

import {
  APP_USER_SETTINGS_EXTENSIONS,
  APP_USER_SETTINGS_NAMESPACES,
} from '../../app-registrations/settings';
import { AI_USER_SETTINGS } from '../../ai/ai.user-settings';
import { NOTIFICATIONS_USER_SETTINGS } from '../../notifications/notifications.user-settings';
import { DATA_TABLES_USER_SETTINGS, NAVIGATION_USER_SETTINGS } from '../user-settings/core.user-settings';
import { extendUserSettingsNamespace, foldSettingsExtensions } from './extend';
import { registerUserSettingsNamespaces, type UserSettingsNamespace } from './user-settings-namespace';

const PLATFORM_NAMESPACES: readonly UserSettingsNamespace[] = [
  DATA_TABLES_USER_SETTINGS,
  NAVIGATION_USER_SETTINGS,
  NOTIFICATIONS_USER_SETTINGS,
  AI_USER_SETTINGS,
];

// The app's extensions (`ai.training`, say) fold into the namespaces they name
// before anything is registered.
const { platform, app } = foldSettingsExtensions(
  { platform: PLATFORM_NAMESPACES, app: APP_USER_SETTINGS_NAMESPACES },
  APP_USER_SETTINGS_EXTENSIONS,
  extendUserSettingsNamespace,
  'user settings',
);

registerUserSettingsNamespaces(platform);

// App-owned namespaces last, so a collision with a platform key names the app.
registerUserSettingsNamespaces(app);
