import type { RoleDeclaration, RoleGrantDeclaration } from '@marinoscar/platform-api/core';

// =============================================================================
// Two app roles, assignable end to end, one holding a platform permission
// (PP-14.15)
// =============================================================================
//
// An app adds a ROLE without touching a package:
//
//   - `coach` is an ORG role: an organization administrator can invite someone
//     as a coach, move a member to coach and see "Coach" in the dialogs, because
//     it is registered (it is listed at `GET /api/roles?scope=org`) and
//     assignable (the default).
//   - `support` is a SYSTEM role: an administrator can give it to a user on the
//     Users page. It holds one PLATFORM permission, `users:read`, granted with
//     `app.grants` (a platform permission's `defaultGrants` are the platform's
//     and cannot name an app role). A support user can list users and nothing
//     else: no write, no settings, no organization surface.
//   - `service-bot` shows `assignable: false`: a role the application manages
//     itself. It is registered (so it can hold permissions and be seeded), but
//     the invite, member and user-role routes refuse it with
//     400 `ROLE_NOT_ASSIGNABLE` and the dialogs do not offer it.
//
// WHERE THEY GO. These arrays are NOT registered here: registering a role adds a
// row to the seed catalog (`prisma/catalog/permissions.json`), so the reference
// app keeps `APP_ROLES` and `APP_GRANTS` empty. A fork copies what it needs into
// `app-registrations/permissions.ts`:
//
//   export const APP_ROLES = [COACH_ROLE, SUPPORT_ROLE];
//   export const APP_GRANTS = [{ role: 'support', permissions: ['users:read'] }];
//
// then runs `npm run catalog:permissions --workspace=api` and re-seeds. The grant
// is validated when the manifest runs: the role and the permission must exist,
// have the same scope, and the permission must not already be granted to the role
// by default. `test/examples/manifest/coach-support.example.spec.ts` drives all of
// it through the real application.
// =============================================================================

/** An org role: reviews the workouts of assigned athletes. */
export const COACH_ROLE: RoleDeclaration = {
  id: 'coach',
  description: 'Reviews the workouts of assigned athletes',
  scope: 'org',
  label: 'Coach',
};

/** A system role: reads the user list to help people, changes nothing. */
export const SUPPORT_ROLE: RoleDeclaration = {
  id: 'support',
  description: 'Reads the user list to help people; changes nothing',
  scope: 'system',
  label: 'Support',
};

/** A role the application manages itself: registered, never assignable through the routes. */
export const SERVICE_BOT_ROLE: RoleDeclaration = {
  id: 'service-bot',
  description: 'Held by the application itself; never handed out through the invite, member or user routes',
  scope: 'org',
  label: 'Service bot',
  assignable: false,
};

/** The roles of the example, in registration order. */
export const COACH_SUPPORT_ROLES: readonly RoleDeclaration[] = [COACH_ROLE, SUPPORT_ROLE, SERVICE_BOT_ROLE];

/** `support` receives the PLATFORM permission `users:read`. */
export const COACH_SUPPORT_GRANTS: readonly RoleGrantDeclaration[] = [{ role: 'support', permissions: ['users:read'] }];
