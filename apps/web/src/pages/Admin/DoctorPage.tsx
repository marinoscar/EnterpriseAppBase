/**
 * Admin → Observability → Doctor (`/admin/settings/doctor`) — issue #634.
 *
 * Since #696 the page itself is packaged: `DoctorPage` and its descriptor
 * `doctorSettingsPage` come from `@marinoscar/platform-web/doctor/ui`, and they
 * reach the app through the platform host (`platform/platformHost.tsx`). This
 * file is the app's binding and nothing else.
 *
 * A REGISTRY CARD and nothing else, per CLAUDE.md's MANDATORY Settings UI
 * Pattern: one entry in `ADMIN_SECTIONS` (`config/adminSections.tsx`, built
 * from `doctorSettingsPage.card`), one route in `App.tsx` gated on
 * `system_settings:read` (the string `@marinoscar/platform-api/doctor` enforces
 * by default, `DEFAULT_DOCTOR_PERMISSION`, bound in
 * `apps/api/src/doctor/doctor.config.ts`), and no tab anywhere.
 */

import { Navigate } from 'react-router-dom';
import { categoryLabel } from '@marinoscar/platform-web/doctor/headless';
import { doctorSettingsPage } from '@marinoscar/platform-web/doctor/ui';
import { usePermissions } from '../../hooks/usePermissions';

export { categoryLabel };

const { Page } = doctorSettingsPage;

export default function DoctorPage() {
  const { hasPermission } = usePermissions();

  // Defence, not the gate — `App.tsx` wraps the route in `RequirePermission`
  // with this same string. The packaged page checks no permission itself.
  if (!hasPermission(doctorSettingsPage.card.permission!)) {
    return <Navigate to="/" replace />;
  }

  return <Page />;
}
