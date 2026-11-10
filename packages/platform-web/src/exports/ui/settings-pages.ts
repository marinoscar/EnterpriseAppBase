import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';

import type { PlatformSettingsPage } from '../../core/index.js';
import { DATA_EXPORT_DESCRIPTION, DATA_EXPORT_PATH, DATA_EXPORT_TITLE } from './copy.js';
import { DataExportPage } from './DataExportPage.js';

/**
 * "Download your data" as a packaged user settings page: no permission
 * (every role holds `user_settings:read`, the exact string the API enforces
 * for the `user-data` source).
 *
 * @example
 * ```tsx
 * // apps/web/src/config/userSettingsSections.tsx (the "Your data" group)
 * { ...dataExportSettingsPage.card, Icon: dataExportSettingsPage.Icon },
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export const dataExportSettingsPage: PlatformSettingsPage<never> = {
  id: 'data-export',
  card: {
    title: DATA_EXPORT_TITLE,
    description: DATA_EXPORT_DESCRIPTION,
    path: DATA_EXPORT_PATH,
  },
  Icon: DownloadOutlinedIcon,
  Page: DataExportPage,
};
