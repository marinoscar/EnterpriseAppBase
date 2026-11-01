/**
 * Admin → Settings → Maintenance (`/admin/settings/maintenance`).
 *
 * The page is `@marinoscar/platform-web/host/ui`'s (#891): the switch, the
 * message, `allowAdmins` and every contributing layer. This file is the app's
 * binding, nothing more. The registry card (`config/adminSections.tsx`) and the
 * route (`App.tsx`, gated on `system_settings:read`) stay here, as the
 * Settings UI Pattern requires.
 */

import { MaintenancePage } from '@marinoscar/platform-web/host/ui';

export default function AdminMaintenancePage() {
  return <MaintenancePage />;
}
