import HealthAndSafetyOutlinedIcon from '@mui/icons-material/HealthAndSafetyOutlined';

import type { PlatformSettingsPage } from '../../core/index.js';
import { DOCTOR_PAGE_DESCRIPTION, DOCTOR_PAGE_TITLE } from './copy.js';
import { DoctorPage } from './doctor-page.js';

/**
 * The Doctor as a packaged settings page: the app appends
 * `{ ...doctorSettingsPage.card, Icon: doctorSettingsPage.Icon }` to its admin
 * registry and routes `card.path` to `Page` behind its permission gate for
 * `card.permission` (`system_settings:read`, the exact string
 * `@marinoscar/platform-api/doctor` enforces by default). No `feature`: the
 * Doctor reports on AI and telemetry while they are off.
 *
 * @example
 * ```tsx
 * // apps/web/src/config/adminSections.tsx (Observability, last card)
 * { ...doctorSettingsPage.card, Icon: doctorSettingsPage.Icon },
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export const doctorSettingsPage: PlatformSettingsPage<never> = {
  id: 'doctor',
  card: {
    title: DOCTOR_PAGE_TITLE,
    description: DOCTOR_PAGE_DESCRIPTION,
    path: '/admin/settings/doctor',
    permission: 'system_settings:read',
  },
  Icon: HealthAndSafetyOutlinedIcon,
  Page: DoctorPage,
};
