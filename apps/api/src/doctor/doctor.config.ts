// =============================================================================
// /api/admin/doctor — is every capability configured and healthy? (issue #634)
// =============================================================================
//
// The Doctor itself lives in `@marinoscar/platform-api/doctor` (#696): the
// check contract, the registry, the service, the DTOs and the controller. This
// file is the app's whole binding: ONE `DoctorModule.forRoot()` call. The checks
// stay in their owning feature modules, under `<module>/doctor/`, and register
// themselves with `DoctorCheckRegistry` from their own `onModuleInit`.
//
// ⚠ IT GATES ON THE EXISTING `system_settings:read` (the package default,
// `DEFAULT_DOCTOR_PERMISSION`; see docs/specs/doctor.md §2.6), exactly like
// the host slice's `about.controller.ts` and for the same reason: the report describes the
// deployment's configuration, which is precisely the blast radius
// `system_settings:read` already covers, and every check is read-only, so
// there is no new capability to grant. No `doctor:read` is invented, and no
// `permission` is passed below.
//
// ⚠ THE STRING IS HALF OF A CROSS-APP CONTRACT (CLAUDE.md, Settings UI Pattern
// rule 3): the web Doctor card reaching this route declares the same literal
// `system_settings:read` (`doctorSettingsPage.card.permission` in
// `@marinoscar/platform-web/doctor/ui`), and
// `apps/web/src/__tests__/config/settingsCards.test.ts` reads both sides.
//
// The access check is the app's own `@Auth()`, applied through the platform
// host (`../platform/platform-host.ts`): same guards, same RBAC metadata, same
// `x-rbac` OpenAPI extension as any controller of the app.
//
// Mounted under `admin/` (the package default path) for the reason
// `AboutController` gives: an administrative surface belongs outside the `nod_`
// allowlist by construction.
//
// Not `@AllowDuringMaintenance()`: unlike About, the doctor performs network
// I/O (object storage, GreptimeDB, the stack agent). An administrator still
// reaches it during a window whenever the window allows admins (the default).
// =============================================================================

import { APP_SLUG } from '@app/shared';
import { DoctorModule } from '@marinoscar/platform-api/doctor';

import { platformHost } from '../platform/platform-host';

/**
 * GET /api/admin/doctor gates on the existing system_settings:read (DEFAULT_DOCTOR_PERMISSION; see docs/specs/doctor.md §2.6);
 * the web Doctor card declares the same literal (CLAUDE.md Settings UI Pattern rule 3).
 *
 * GET /api/admin/doctor/support-bundle (#772) rides on the same permission.
 * Its file is named after the app's slug; the caller is resolved by the
 * package default (`request.requestUser`, which the app's `PermissionsGuard`
 * sets). Sections register themselves: `versions` from the host slice's about module, `telemetry`
 * from `telemetry/`.
 */
export const doctorModule = DoctorModule.forRoot({ host: platformHost, supportBundle: { appSlug: APP_SLUG } });
